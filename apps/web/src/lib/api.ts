import type { ClusterView, FlowFilters, TimelineBucket } from '@gw/shared';
import { DEMO, demoApi } from './demo';

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return (await res.json()) as T;
}

const liveApi = {
  cluster: (id: string) => get<ClusterView>(`/api/cluster/${encodeURIComponent(id)}`),
  clusters: (from: Date, to: Date, minImportance = 0) =>
    get<ClusterView[]>(`/api/clusters?from=${from.toISOString()}&to=${to.toISOString()}&limit=150&minImportance=${minImportance}`),
  timeline: (hours = 24, bucketMin = 15) => get<{ bucketMs: number; buckets: TimelineBucket[] }>(`/api/timeline?hours=${hours}&bucketMin=${bucketMin}`),
  density: (hours: number) => get<{ hours: number; points: [number, number, number][] }>(`/api/density?hours=${hours}`),
  outlets: () => get<{ outlet: string; sourceType: string; count: number }[]>('/api/outlets'),
  search: (q: string) => get<ClusterView[]>(`/api/search?q=${encodeURIComponent(q)}`),
  setFilters: (sessionId: string, filters: FlowFilters) =>
    fetch(`/api/session/${encodeURIComponent(sessionId)}/filters`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(filters),
    }).then((r) => r.ok),
};

export const api: typeof liveApi = DEMO ? (demoApi as unknown as typeof liveApi) : liveApi;
