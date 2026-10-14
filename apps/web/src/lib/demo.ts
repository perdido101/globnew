import type { Category, ClusterView, StatsView, TimelineBucket } from '@gw/shared';
import { inRegion, regionByKey } from '@gw/shared';
import { passesClient, useStore } from '../store/useStore';

/** True for the static GitHub Pages build: no server, a recorded snapshot replayed in the browser. */
export const DEMO = import.meta.env.VITE_DEMO === '1';

interface Snapshot {
  takenAt: string;
  clusters: ClusterView[];
}

const FLOW = { cadenceMs: 4500, jitter: 0.35, maxVisibleCards: 12, dotTtlMinMs: 1_200_000, dotTtlMaxMs: 10_800_000, cardHoldMs: 45_000, initialSeed: 14 };

let pool: ClusterView[] | null = null;
let loading: Promise<ClusterView[]> | null = null;

function shift(iso: string, offset: number): string {
  return new Date(Date.parse(iso) + offset).toISOString();
}

/** Load the snapshot and move its timestamps so the recording looks like it is happening now. */
export function demoPool(): Promise<ClusterView[]> {
  if (pool) return Promise.resolve(pool);
  if (!loading) {
    loading = fetch(`${import.meta.env.BASE_URL}demo/snapshot.json`)
      .then((r) => r.json() as Promise<Snapshot>)
      .then((snap) => {
        const offset = Date.now() - Date.parse(snap.takenAt);
        pool = snap.clusters.map((c) => ({
          ...c,
          firstSeenAt: shift(c.firstSeenAt, offset),
          publishedAt: shift(c.publishedAt, offset),
          updatedAt: shift(c.updatedAt, offset),
          sources: c.sources.map((s) => ({ ...s, publishedAt: shift(s.publishedAt, offset) })),
        }));
        return pool;
      });
  }
  return loading;
}

const ttlFor = (importance: number) => Math.round(FLOW.dotTtlMinMs + ((FLOW.dotTtlMaxMs - FLOW.dotTtlMinMs) * importance) / 100);

function stats(p: ClusterView[]): StatsView {
  const hourAgo = Date.now() - 3600_000;
  const recent = p.filter((c) => Date.parse(c.firstSeenAt) > hourAgo);
  return {
    itemsLastHour: recent.reduce((s, c) => s + c.sources.length, 0),
    clustersLastHour: recent.length,
    totalClusters: p.length,
    queued: 0,
    sourcesOk: 0,
    sourcesTotal: 0,
    llmEnabled: false,
    serverTime: new Date().toISOString(),
  };
}

/** In-browser port of the server's release queue: highest score first, jittered cadence, filters & focus respected. */
export function connectDemo(): () => void {
  let timer: number | null = null;
  let closed = false;
  const released = new Set<string>();

  const eligible = (c: ClusterView) => {
    const s = useStore.getState().settings;
    if (!passesClient({ ...c, firstSeenAt: new Date().toISOString() }, s, Date.now())) return false;
    if (s.focusRegion) {
      const r = regionByKey(s.focusRegion);
      return !!(r && c.geo && inRegion(r, c.geo.lat, c.geo.lon));
    }
    return true;
  };

  const tick = () => {
    if (closed || !pool) return;
    const st = useStore.getState();
    if (!st.settings.paused) {
      let next = pool.filter((c) => !released.has(c.id) && eligible(c)).sort((a, b) => b.importance - a.importance)[0];
      if (!next) {
        // The recording ran out: start over with anything no longer on screen.
        for (const id of [...released]) if (!st.clusters[id]) released.delete(id);
        next = pool.filter((c) => !released.has(c.id) && eligible(c)).sort((a, b) => b.importance - a.importance)[0];
      }
      if (next) {
        released.add(next.id);
        st.release({ ...next, releasedAt: new Date().toISOString(), ttlMs: ttlFor(next.importance) });
      }
    }
    const cadence = st.settings.cadenceSec * 1000;
    timer = window.setTimeout(tick, cadence * (1 - FLOW.jitter + Math.random() * 2 * FLOW.jitter));
  };

  void demoPool().then((p) => {
    if (closed) return;
    const now = Date.now();
    const seed = [...p].sort((a, b) => b.importance - a.importance).filter((c) => c.geo).slice(0, FLOW.initialSeed);
    seed.forEach((c) => released.add(c.id));
    useStore.getState().init(
      seed.reverse().map((c, i) => ({ ...c, releasedAt: new Date(now - (seed.length - i) * FLOW.cadenceMs).toISOString(), ttlMs: ttlFor(c.importance) })),
      { cadenceMs: FLOW.cadenceMs, maxVisibleCards: FLOW.maxVisibleCards, dotTtlMinMs: FLOW.dotTtlMinMs, dotTtlMaxMs: FLOW.dotTtlMaxMs, cardHoldMs: FLOW.cardHoldMs },
      stats(p),
      'demo',
    );
    timer = window.setTimeout(tick, 2500);
  });
  const statsTimer = window.setInterval(() => pool && useStore.getState().setStats(stats(pool)), 10_000);

  // Filter changes take effect on the next tick; make focus feel responsive.
  const unsub = useStore.subscribe((s, p) => {
    if (s.settings.focusRegion !== p.settings.focusRegion && timer) {
      clearTimeout(timer);
      timer = window.setTimeout(tick, 800);
    }
  });

  return () => {
    closed = true;
    if (timer) clearTimeout(timer);
    clearInterval(statsTimer);
    unsub();
  };
}

/** The same answers the server's /api routes give, computed from the snapshot. */
export const demoApi = {
  async cluster(id: string): Promise<ClusterView> {
    const c = (await demoPool()).find((x) => x.id === id);
    if (!c) throw new Error('not found');
    return c;
  },
  async clusters(from: Date, to: Date, minImportance = 0): Promise<ClusterView[]> {
    return (await demoPool())
      .filter((c) => {
        const t = Date.parse(c.firstSeenAt);
        return t >= from.getTime() && t < to.getTime() && c.importance >= minImportance;
      })
      .sort((a, b) => b.importance - a.importance)
      .slice(0, 150);
  },
  async timeline(hours = 24, bucketMin = 15): Promise<{ bucketMs: number; buckets: TimelineBucket[] }> {
    const bucketMs = bucketMin * 60_000;
    const now = Date.now();
    const start = Math.floor((now - hours * 3600_000) / bucketMs) * bucketMs;
    const buckets: TimelineBucket[] = Array.from({ length: Math.ceil((now - start) / bucketMs) }, (_, i) => ({ t: new Date(start + i * bucketMs).toISOString(), count: 0, byCategory: {} }));
    for (const c of await demoPool()) {
      const b = buckets[Math.floor((Date.parse(c.firstSeenAt) - start) / bucketMs)];
      if (!b) continue;
      b.count++;
      b.byCategory[c.category as Category] = (b.byCategory[c.category] ?? 0) + 1;
    }
    return { bucketMs, buckets };
  },
  async density(hours: number) {
    const since = Date.now() - hours * 3600_000;
    const points = (await demoPool()).filter((c) => c.geo && Date.parse(c.firstSeenAt) > since).map((c) => [c.geo!.lat, c.geo!.lon, c.sourceCount] as [number, number, number]);
    return { hours, points };
  },
  async outlets() {
    const m = new Map<string, { outlet: string; sourceType: string; count: number }>();
    for (const c of await demoPool())
      for (const s of c.sources) {
        const e = m.get(s.outlet) ?? { outlet: s.outlet, sourceType: s.sourceType, count: 0 };
        e.count++;
        m.set(s.outlet, e);
      }
    return [...m.values()].sort((a, b) => b.count - a.count);
  },
  async search(q: string): Promise<ClusterView[]> {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    return (await demoPool())
      .filter((c) => {
        const hay = `${c.title} ${c.outlet} ${c.geo?.place ?? ''} ${c.geo?.country ?? ''} ${c.snippet}`.toLowerCase();
        return terms.every((t) => hay.includes(t));
      })
      .slice(0, 40);
  },
  async setFilters() {
    return true;
  },
};

