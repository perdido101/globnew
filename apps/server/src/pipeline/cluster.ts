import type { Category, GeoLocation } from '@gw/shared';
import { config } from '../config.js';
import { contentTokens } from '../util/text.js';
import { haversineKm } from './geo-util.js';

export interface ClusterMember {
  id: string;
  title: string;
  tokens: Set<string>;
  geo: GeoLocation | null;
  time: number;
}

export interface ClusterCore {
  id: string;
  members: ClusterMember[];
  lastTime: number;
}

export function tokenSet(title: string): Set<string> {
  const toks = contentTokens(title);
  const set = new Set(toks);
  // Bigrams capture phrases ("death toll", "interest rates") and make matches stricter.
  for (let i = 0; i + 1 < toks.length; i++) set.add(`${toks[i]}_${toks[i + 1]}`);
  return set;
}

/** Blend of Jaccard and overlap coefficient over unigram+bigram sets. */
export function similarity(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  const [small, big] = a.size < b.size ? [a, b] : [b, a];
  for (const t of small) if (big.has(t)) inter++;
  if (inter === 0) return 0;
  const jaccard = inter / (a.size + b.size - inter);
  const overlap = inter / small.size;
  return 0.5 * jaccard + 0.5 * overlap * Math.min(1, small.size / 4);
}

export interface Match {
  cluster: ClusterCore;
  score: number;
}

/** In-memory incremental clusterer with an inverted token index. */
export class Clusterer {
  private clusters = new Map<string, ClusterCore>();
  private index = new Map<string, Set<string>>();

  get size(): number {
    return this.clusters.size;
  }

  get(id: string): ClusterCore | undefined {
    return this.clusters.get(id);
  }

  findMatch(m: ClusterMember): Match | null {
    const windowMs = config.cluster.windowHours * 3600_000;
    const counts = new Map<string, number>();
    for (const t of m.tokens) {
      if (t.includes('_')) continue;
      for (const cid of this.index.get(t) ?? []) counts.set(cid, (counts.get(cid) ?? 0) + 1);
    }
    let best: Match | null = null;
    for (const [cid, shared] of counts) {
      if (shared < 2) continue;
      const c = this.clusters.get(cid);
      if (!c || Math.abs(m.time - c.lastTime) > windowMs) continue;
      let s = 0;
      for (const other of c.members) s = Math.max(s, similarity(m.tokens, other.tokens));
      const near = nearest(m, c);
      // Similar words, far-apart places → different events ("earthquake strikes …").
      if (near !== null && near > 1500) continue;
      const threshold = near !== null && near <= config.cluster.nearKm ? config.cluster.nearSimilarity : config.cluster.similarity;
      if (s >= threshold && (!best || s > best.score)) best = { cluster: c, score: s };
    }
    return best;
  }

  add(clusterId: string, m: ClusterMember): ClusterCore {
    let c = this.clusters.get(clusterId);
    if (!c) {
      c = { id: clusterId, members: [], lastTime: m.time };
      this.clusters.set(clusterId, c);
    }
    if (!c.members.some((x) => x.id === m.id)) c.members.push(m);
    c.lastTime = Math.max(c.lastTime, m.time);
    for (const t of m.tokens) {
      if (t.includes('_')) continue;
      (this.index.get(t) ?? this.index.set(t, new Set()).get(t)!).add(clusterId);
    }
    return c;
  }

  remove(clusterId: string): void {
    const c = this.clusters.get(clusterId);
    if (!c) return;
    for (const m of c.members) for (const t of m.tokens) this.index.get(t)?.delete(clusterId);
    this.clusters.delete(clusterId);
  }
}

function nearest(m: ClusterMember, c: ClusterCore): number | null {
  if (!m.geo) return null;
  let best: number | null = null;
  for (const o of c.members) {
    if (!o.geo) continue;
    const d = haversineKm(m.geo.lat, m.geo.lon, o.geo.lat, o.geo.lon);
    if (best === null || d < best) best = d;
  }
  return best;
}

/** Weighted vote for the cluster category. */
export function voteCategory(items: { category?: Category | null; weight: number }[]): Category {
  const votes = new Map<Category, number>();
  for (const it of items) if (it.category) votes.set(it.category, (votes.get(it.category) ?? 0) + it.weight);
  return [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'society';
}
