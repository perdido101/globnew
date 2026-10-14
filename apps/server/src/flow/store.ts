import { EventEmitter } from 'node:events';
import type { Category, ClusterSource, ClusterView, GeoLocation, Item } from '@gw/shared';
import { config, env } from '../config.js';
import { Clusterer, tokenSet, voteCategory, type ClusterMember } from '../pipeline/cluster.js';
import { importance } from '../pipeline/score.js';
import { hmac, shortHash } from '../util/hash.js';

export interface ClusterState {
  id: string;
  itemIds: string[];
  leadId: string;
  firstSeenAt: number;
  updatedAt: number;
  category: Category;
  breaking: boolean;
  geo: GeoLocation | null;
  importance: number;
  outletCount: number;
}

export type ClusterChange = { cluster: ClusterState; kind: 'new' | 'grew' | 'changed' };

export function thumbPath(url: string | null | undefined): string | null {
  if (!url) return null;
  return `/img/${hmac(env.imageSecret, url)}?u=${encodeURIComponent(url)}`;
}

/** Hot, in-memory view of recent items and their clusters. Postgres is the durable copy. */
export class Store extends EventEmitter<{ change: [ClusterChange] }> {
  readonly items = new Map<string, Item>();
  readonly clusters = new Map<string, ClusterState>();
  /** LLM importance hints per item (not part of the public Item type). */
  readonly llmImportance = new Map<string, number>();
  private clusterer = new Clusterer();
  private urlIndex = new Map<string, string>();

  hasItem(id: string): boolean {
    return this.items.has(id);
  }

  itemByUrl(url: string): Item | undefined {
    const id = this.urlIndex.get(url);
    return id ? this.items.get(id) : undefined;
  }

  /** Insert a fully processed item and assign it to a cluster. */
  addItem(item: Item, opts: { silent?: boolean } = {}): ClusterState {
    const sameUrlId = this.urlIndex.get(item.url);
    const sameUrl = sameUrlId && sameUrlId !== item.id ? this.items.get(sameUrlId) : undefined;
    this.items.set(item.id, item);
    if (!sameUrl) this.urlIndex.set(item.url, item.id);
    const member: ClusterMember = {
      id: item.id,
      title: item.title,
      tokens: tokenSet(item.title),
      geo: item.geo ?? null,
      time: Date.parse(item.publishedAt),
    };
    // Same URL already clustered (e.g. a Reddit post linking to an outlet article we have).
    let clusterId = item.clusterId ?? sameUrl?.clusterId ?? this.clusterer.findMatch(member)?.cluster.id ?? null;
    if (clusterId && !this.clusters.has(clusterId)) clusterId = item.clusterId ?? null;
    const isNew = !clusterId || !this.clusters.has(clusterId);
    if (!clusterId) clusterId = 'c' + shortHash(item.id + item.firstSeenAt, 14);
    item.clusterId = clusterId;
    this.clusterer.add(clusterId, member);

    let c = this.clusters.get(clusterId);
    const prevOutlets = c?.outletCount ?? 0;
    if (!c) {
      c = {
        id: clusterId,
        itemIds: [],
        leadId: item.id,
        firstSeenAt: Date.parse(item.firstSeenAt),
        updatedAt: Date.now(),
        category: item.category ?? 'society',
        breaking: !!item.breaking,
        geo: item.geo ?? null,
        importance: 0,
        outletCount: 1,
      };
      this.clusters.set(clusterId, c);
    }
    if (!c.itemIds.includes(item.id)) c.itemIds.push(item.id);
    c.firstSeenAt = Math.min(c.firstSeenAt, Date.parse(item.firstSeenAt));
    this.recompute(c);
    if (!opts.silent) this.emit('change', { cluster: c, kind: isNew ? 'new' : c.outletCount > prevOutlets ? 'grew' : 'changed' });
    return c;
  }

  /** Update engagement of an existing item (reddit/telegram re-polls). */
  updateEngagement(id: string, engagement: Item['engagement']): void {
    const it = this.items.get(id);
    if (!it || !it.clusterId) return;
    it.engagement = engagement;
    const c = this.clusters.get(it.clusterId);
    if (!c) return;
    const before = c.importance;
    this.recompute(c);
    if (Math.abs(c.importance - before) >= 3) this.emit('change', { cluster: c, kind: 'changed' });
  }

  members(c: ClusterState): Item[] {
    return c.itemIds.map((id) => this.items.get(id)).filter((x): x is Item => !!x);
  }

  recompute(c: ClusterState, now = Date.now()): void {
    const its = this.members(c);
    if (!its.length) return;
    // Lead = highest-weight outlet; verified beats unverified; earlier wins ties.
    its.sort((a, b) => Number(b.verified) - Number(a.verified) || b.weight - a.weight || Date.parse(a.publishedAt) - Date.parse(b.publishedAt));
    const lead = its[0]!;
    c.leadId = lead.id;
    const outlets = new Set(its.map((i) => i.outlet.toLowerCase()));
    c.outletCount = outlets.size;
    c.category = voteCategory(its.map((i) => ({ category: i.category, weight: i.weight + (this.llmImportance.has(i.id) ? 0.5 : 0) })));
    c.breaking = its.some((i) => i.breaking) && now - c.firstSeenAt < 3 * 3600_000;
    const geos = its.map((i) => i.geo).filter((g): g is GeoLocation => !!g);
    const precisionRank = { city: 3, region: 2, country: 1 } as const;
    c.geo =
      lead.geo ??
      geos.sort((a, b) => b.confidence - a.confidence || precisionRank[b.precision] - precisionRank[a.precision])[0] ??
      null;
    const newest = Math.max(...its.map((i) => Date.parse(i.publishedAt)));
    const hints = its.map((i) => this.llmImportance.get(i.id)).filter((x): x is number => x != null);
    c.importance = importance({
      outletCount: c.outletCount,
      leadWeight: lead.weight,
      maxVelocity: Math.max(0, ...its.map((i) => i.engagement?.velocity ?? 0)),
      breaking: c.breaking,
      category: c.category,
      ageMs: now - newest,
      llmImportance: hints.length ? Math.max(...hints) : null,
      unverifiedOnly: its.every((i) => !i.verified),
    });
    c.updatedAt = now;
  }

  view(c: ClusterState): ClusterView {
    const its = this.members(c);
    const lead = this.items.get(c.leadId) ?? its[0]!;
    const withImage = lead.imageUrl ? lead : its.find((i) => i.imageUrl);
    const sources: ClusterSource[] = its
      .slice()
      .sort((a, b) => b.weight - a.weight || Date.parse(a.publishedAt) - Date.parse(b.publishedAt))
      .map((i) => ({
        itemId: i.id,
        outlet: i.outlet,
        sourceType: i.sourceType,
        url: i.url,
        title: i.title,
        publishedAt: i.publishedAt,
        subreddit: i.subreddit,
        verified: i.verified,
        engagement: i.engagement,
      }));
    const vel = Math.max(0, ...its.map((i) => i.engagement?.velocity ?? 0));
    return {
      id: c.id,
      title: lead.title,
      snippet: lead.snippet,
      url: lead.url,
      outlet: lead.outlet,
      sourceType: lead.sourceType,
      subreddit: lead.subreddit ?? its.find((i) => i.subreddit)?.subreddit ?? null,
      verified: its.some((i) => i.verified),
      thumb: thumbPath(withImage?.imageUrl),
      geo: c.geo,
      category: c.category,
      breaking: c.breaking,
      importance: c.importance,
      sourceCount: c.outletCount,
      sources,
      firstSeenAt: new Date(c.firstSeenAt).toISOString(),
      publishedAt: lead.publishedAt,
      updatedAt: new Date(c.updatedAt).toISOString(),
      engagement: vel > 0 ? { velocity: vel, score: lead.engagement?.score, views: lead.engagement?.views, comments: lead.engagement?.comments } : lead.engagement,
    };
  }

  /** Drop items/clusters older than the memory window (or beyond the size cap). */
  evict(now = Date.now()): number {
    const cutoff = now - config.server.memoryWindowHours * 3600_000;
    let removed = 0;
    const overflow = this.items.size - config.server.maxItemsInMemory;
    const byAge = [...this.clusters.values()].sort((a, b) => a.updatedAt - b.updatedAt);
    let toDrop = overflow;
    for (const c of byAge) {
      if (c.firstSeenAt >= cutoff && toDrop <= 0) break;
      if (c.firstSeenAt < cutoff || toDrop > 0) {
        for (const id of c.itemIds) {
          const it = this.items.get(id);
          if (it) this.urlIndex.delete(it.url);
          this.items.delete(id);
          this.llmImportance.delete(id);
          toDrop--;
        }
        this.clusters.delete(c.id);
        this.clusterer.remove(c.id);
        removed++;
      }
    }
    return removed;
  }
}
