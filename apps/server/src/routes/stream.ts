import type { FastifyInstance } from 'fastify';
import type { FlowFilters, StreamEvent } from '@gw/shared';
import type { FlowEngine } from '../flow/engine.js';

export function parseFilters(raw: unknown): FlowFilters {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 500) : undefined);
  return {
    sourceTypes: arr(r.sourceTypes) as FlowFilters['sourceTypes'],
    mutedOutlets: arr(r.mutedOutlets),
    categories: arr(r.categories) as FlowFilters['categories'],
    minImportance: typeof r.minImportance === 'number' ? r.minImportance : undefined,
    mutedRegions: arr(r.mutedRegions),
    focusRegion: typeof r.focusRegion === 'string' ? r.focusRegion : null,
    includeGlobal: typeof r.includeGlobal === 'boolean' ? r.includeGlobal : undefined,
    paused: r.paused === true,
    cadenceMs: typeof r.cadenceMs === 'number' ? Math.max(1000, Math.min(60_000, r.cadenceMs)) : undefined,
  };
}

export function streamRoutes(app: FastifyInstance, flow: FlowEngine) {
  const open = new Set<import('node:http').ServerResponse>();
  // End streams on shutdown so clients reconnect immediately instead of waiting on a dead socket.
  app.addHook('preClose', async () => {
    for (const res of open) res.end();
    open.clear();
  });

  /** Server-Sent Events: `init` (current visible state) then `release` / `update` / `stats`. */
  app.get<{ Querystring: { session?: string; filters?: string } }>('/stream', (req, reply) => {
    let filters: FlowFilters = {};
    if (req.query.filters) {
      try {
        filters = parseFilters(JSON.parse(Buffer.from(req.query.filters, 'base64url').toString('utf8')));
      } catch {
        /* ignore bad filters */
      }
    }
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
      'access-control-allow-origin': '*',
    });
    res.write('retry: 3000\n\n');
    const send = (ev: StreamEvent) => {
      res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
    };
    open.add(res);
    const sessionId = flow.connect(req.query.session ?? null, filters, send);
    // Named heartbeat (visible to EventSource) lets clients detect silently dead connections.
    const ping = setInterval(() => res.write(`event: ping\ndata: ${Date.now()}\n\n`), 15_000);
    req.raw.on('close', () => {
      open.delete(res);
      clearInterval(ping);
      flow.disconnect(sessionId);
    });
  });

  app.post<{ Params: { id: string }; Body: unknown }>('/api/session/:id/filters', async (req, reply) => {
    const ok = flow.setFilters(req.params.id, parseFilters(req.body));
    if (!ok) return reply.code(404).send({ error: 'unknown session' });
    return { ok: true };
  });
}
