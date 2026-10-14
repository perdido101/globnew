import type { FastifyInstance } from 'fastify';
import type { Category, ClusterView, TimelineBucket } from '@gw/shared';
import { config } from '../config.js';
import type { Store } from '../flow/store.js';
import type { SourceScheduler } from '../sources/scheduler.js';
import { normaliseForMatch } from '../util/text.js';

export function apiRoutes(app: FastifyInstance, store: Store, scheduler: SourceScheduler) {
  app.get('/health', async () => ({ ok: true, items: store.items.size, clusters: store.clusters.size, time: new Date().toISOString() }));

  app.get<{ Params: { id: string } }>('/api/cluster/:id', async (req, reply) => {
    const c = store.clusters.get(req.params.id);
    if (!c) return reply.code(404).send({ error: 'not found' });
    return store.view(c);
  });

  /** Clusters first seen in [from, to) — used by the timeline replay. */
  app.get<{ Querystring: { from?: string; to?: string; limit?: string; minImportance?: string } }>('/api/clusters', async (req) => {
    const to = req.query.to ? Date.parse(req.query.to) : Date.now();
    const from = req.query.from ? Date.parse(req.query.from) : to - 3600_000;
    const limit = Math.min(300, Number(req.query.limit ?? 120));
    const minImp = Number(req.query.minImportance ?? 0);
    const out: ClusterView[] = [];
    for (const c of store.clusters.values()) {
      if (c.firstSeenAt >= from && c.firstSeenAt < to && c.importance >= minImp) out.push(store.view(c));
    }
    return out.sort((a, b) => b.importance - a.importance).slice(0, limit);
  });

  app.get<{ Querystring: { hours?: string; bucketMin?: string } }>('/api/timeline', async (req) => {
    const hours = Math.min(48, Number(req.query.hours ?? 24));
    const bucketMs = Math.max(5, Number(req.query.bucketMin ?? 15)) * 60_000;
    const now = Date.now();
    const start = Math.floor((now - hours * 3600_000) / bucketMs) * bucketMs;
    const n = Math.ceil((now - start) / bucketMs);
    const buckets: TimelineBucket[] = Array.from({ length: n }, (_, i) => ({ t: new Date(start + i * bucketMs).toISOString(), count: 0, byCategory: {} }));
    for (const c of store.clusters.values()) {
      const i = Math.floor((c.firstSeenAt - start) / bucketMs);
      const b = buckets[i];
      if (!b) continue;
      b.count++;
      b.byCategory[c.category] = (b.byCategory[c.category] ?? 0) + 1;
    }
    return { bucketMs, buckets };
  });

  /** Geolocated item points for the activity-density hex layer. */
  app.get<{ Querystring: { hours?: string } }>('/api/density', async (req) => {
    const hours = Math.min(48, Number(req.query.hours ?? config.ui.densityHours));
    const since = Date.now() - hours * 3600_000;
    const pts: [number, number, number][] = [];
    for (const c of store.clusters.values()) {
      if (c.firstSeenAt < since || !c.geo) continue;
      pts.push([Math.round(c.geo.lat * 100) / 100, Math.round(c.geo.lon * 100) / 100, c.outletCount]);
    }
    return { hours, points: pts };
  });

  app.get('/api/outlets', async () => {
    const counts = new Map<string, { outlet: string; sourceType: string; count: number }>();
    for (const it of store.items.values()) {
      const k = it.outlet;
      const e = counts.get(k) ?? { outlet: k, sourceType: it.sourceType, count: 0 };
      e.count++;
      counts.set(k, e);
    }
    const configured = scheduler.views().map((s) => ({ outlet: s.name, sourceType: s.type, count: 0 }));
    for (const c of configured) if (!counts.has(c.outlet)) counts.set(c.outlet, c);
    return [...counts.values()].sort((a, b) => b.count - a.count);
  });

  app.get<{ Querystring: { q?: string; limit?: string } }>('/api/search', async (req) => {
    const q = normaliseForMatch(req.query.q ?? '');
    if (q.length < 2) return [];
    const terms = q.split(' ');
    const out: ClusterView[] = [];
    for (const c of store.clusters.values()) {
      const lead = store.items.get(c.leadId);
      if (!lead) continue;
      const hay = normaliseForMatch(`${lead.title} ${lead.outlet} ${c.geo?.place ?? ''} ${c.geo?.country ?? ''} ${lead.snippet}`);
      if (terms.every((t) => hay.includes(t))) out.push(store.view(c));
    }
    return out.sort((a, b) => Date.parse(b.firstSeenAt) - Date.parse(a.firstSeenAt)).slice(0, Number(req.query.limit ?? 40));
  });

  app.get('/api/categories', async () => {
    const counts: Partial<Record<Category, number>> = {};
    for (const c of store.clusters.values()) counts[c.category] = (counts[c.category] ?? 0) + 1;
    return counts;
  });
}
