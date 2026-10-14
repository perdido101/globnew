import { and, gte, inArray, sql as dsql } from 'drizzle-orm';
import type { Item } from '@gw/shared';
import { log } from '../log.js';
import type { HealthState } from '../sources/health.js';
import { db } from './client.js';
import { clusters, items, llmCache, ogCache, sourceHealth } from './schema.js';
import type { OgData } from '../pipeline/og.js';
import type { LlmResult } from '../pipeline/llm.js';

export interface ClusterRow {
  id: string;
  leadItemId: string;
  title: string;
  category: string;
  breaking: boolean;
  importance: number;
  sourceCount: number;
  place: string | null;
  country: string | null;
  lat: number | null;
  lon: number | null;
  firstSeenAt: Date;
  updatedAt: Date;
}

function itemRow(i: Item) {
  return {
    id: i.id,
    sourceId: i.sourceId,
    sourceType: i.sourceType,
    outlet: i.outlet,
    author: i.author ?? null,
    url: i.url,
    title: i.title,
    snippet: i.snippet.slice(0, 220),
    imageUrl: i.imageUrl ?? null,
    publishedAt: new Date(i.publishedAt),
    firstSeenAt: new Date(i.firstSeenAt),
    lang: i.lang ?? null,
    engagement: i.engagement ?? null,
    subreddit: i.subreddit ?? null,
    verified: i.verified,
    weight: i.weight,
    regionHint: i.regionHint ?? null,
    place: i.geo?.place ?? null,
    country: i.geo?.country ?? null,
    lat: i.geo?.lat ?? null,
    lon: i.geo?.lon ?? null,
    geoPrecision: i.geo?.precision ?? null,
    geoConfidence: i.geo?.confidence ?? null,
    geoMethod: i.geo?.method ?? null,
    category: i.category ?? null,
    breaking: i.breaking ?? false,
    importance: i.importance ?? null,
    clusterId: i.clusterId ?? null,
    processed: true,
  };
}

export function rowToItem(r: typeof items.$inferSelect): Item {
  return {
    id: r.id,
    sourceId: r.sourceId,
    sourceType: r.sourceType as Item['sourceType'],
    outlet: r.outlet,
    author: r.author,
    url: r.url,
    title: r.title,
    snippet: r.snippet,
    imageUrl: r.imageUrl,
    publishedAt: r.publishedAt.toISOString(),
    firstSeenAt: r.firstSeenAt.toISOString(),
    lang: r.lang,
    engagement: r.engagement ?? undefined,
    subreddit: r.subreddit,
    verified: r.verified,
    weight: r.weight,
    regionHint: r.regionHint,
    geo:
      r.lat != null && r.lon != null
        ? {
            place: r.place ?? '',
            country: r.country,
            lat: r.lat,
            lon: r.lon,
            precision: (r.geoPrecision ?? 'country') as 'city',
            confidence: r.geoConfidence ?? 0.5,
            method: (r.geoMethod ?? 'gazetteer') as 'gazetteer',
          }
        : null,
    category: r.category as Item['category'],
    breaking: r.breaking,
    importance: r.importance ?? undefined,
    clusterId: r.clusterId,
  };
}

/** Write-behind persistence: coalesces item/cluster upserts and flushes every second. */
export class Repo {
  private pendingItems = new Map<string, Item>();
  private pendingClusters = new Map<string, ClusterRow>();
  private timer: NodeJS.Timeout;
  healthy = true;

  constructor() {
    this.timer = setInterval(() => void this.flush(), 1000);
  }

  saveItem(i: Item) {
    this.pendingItems.set(i.id, i);
  }

  saveCluster(c: ClusterRow) {
    this.pendingClusters.set(c.id, c);
  }

  async flush(): Promise<void> {
    const its = [...this.pendingItems.values()];
    const cls = [...this.pendingClusters.values()];
    this.pendingItems.clear();
    this.pendingClusters.clear();
    try {
      for (let i = 0; i < its.length; i += 200) {
        const rows = its.slice(i, i + 200).map(itemRow);
        await db
          .insert(items)
          .values(rows)
          .onConflictDoUpdate({
            target: items.id,
            set: {
              engagement: dsql`excluded.engagement`,
              imageUrl: dsql`coalesce(excluded.image_url, ${items.imageUrl})`,
              place: dsql`excluded.place`,
              country: dsql`excluded.country`,
              lat: dsql`excluded.lat`,
              lon: dsql`excluded.lon`,
              geoPrecision: dsql`excluded.geo_precision`,
              geoConfidence: dsql`excluded.geo_confidence`,
              geoMethod: dsql`excluded.geo_method`,
              category: dsql`excluded.category`,
              breaking: dsql`excluded.breaking`,
              importance: dsql`excluded.importance`,
              clusterId: dsql`excluded.cluster_id`,
              outlet: dsql`excluded.outlet`,
              processed: dsql`true`,
            },
          });
      }
      for (let i = 0; i < cls.length; i += 200) {
        await db
          .insert(clusters)
          .values(cls.slice(i, i + 200))
          .onConflictDoUpdate({
            target: clusters.id,
            set: {
              leadItemId: dsql`excluded.lead_item_id`,
              title: dsql`excluded.title`,
              category: dsql`excluded.category`,
              breaking: dsql`excluded.breaking`,
              importance: dsql`excluded.importance`,
              sourceCount: dsql`excluded.source_count`,
              place: dsql`excluded.place`,
              country: dsql`excluded.country`,
              lat: dsql`excluded.lat`,
              lon: dsql`excluded.lon`,
              updatedAt: dsql`excluded.updated_at`,
            },
          });
      }
      if (!this.healthy) log.info('database writes recovered');
      this.healthy = true;
    } catch (err) {
      if (this.healthy) log.error({ err: (err as Error).message }, 'database write failed — will retry');
      this.healthy = false;
      // Re-queue (newer versions win).
      for (const it of its) if (!this.pendingItems.has(it.id)) this.pendingItems.set(it.id, it);
      for (const c of cls) if (!this.pendingClusters.has(c.id)) this.pendingClusters.set(c.id, c);
    }
  }

  async close() {
    clearInterval(this.timer);
    await this.flush();
  }

  async recentItems(since: Date, limit: number): Promise<Item[]> {
    const rows = await db
      .select()
      .from(items)
      .where(and(gte(items.firstSeenAt, since), dsql`${items.processed} = true`))
      .orderBy(items.firstSeenAt)
      .limit(limit);
    return rows.map(rowToItem);
  }

  async knownIds(ids: string[]): Promise<Set<string>> {
    if (!ids.length) return new Set();
    const rows = await db.select({ id: items.id }).from(items).where(inArray(items.id, ids));
    return new Set(rows.map((r) => r.id));
  }

  async getLlm(hash: string): Promise<LlmResult | null> {
    const rows = await db.select().from(llmCache).where(dsql`${llmCache.hash} = ${hash}`).limit(1);
    return (rows[0]?.result as LlmResult | undefined) ?? null;
  }

  async putLlm(hash: string, result: LlmResult): Promise<void> {
    await db.insert(llmCache).values({ hash, result }).onConflictDoNothing();
  }

  async getOg(url: string): Promise<OgData | null> {
    const rows = await db.select().from(ogCache).where(dsql`${ogCache.url} = ${url}`).limit(1);
    const r = rows[0];
    if (!r) return null;
    // Failed lookups are retried after 6h.
    if (!r.ok && Date.now() - r.fetchedAt.getTime() > 6 * 3600_000) return null;
    return { image: r.image, title: r.title, siteName: r.siteName, ok: r.ok };
  }

  async putOg(url: string, og: OgData): Promise<void> {
    await db
      .insert(ogCache)
      .values({ url, image: og.image, title: og.title, siteName: og.siteName, ok: og.ok, fetchedAt: new Date() })
      .onConflictDoUpdate({ target: ogCache.url, set: { image: og.image, title: og.title, siteName: og.siteName, ok: og.ok, fetchedAt: new Date() } });
  }

  async loadHealth(): Promise<Map<string, Partial<HealthState>>> {
    const rows = await db.select().from(sourceHealth);
    return new Map(
      rows.map((r) => [
        r.sourceId,
        {
          lastFetchAt: r.lastFetchAt,
          lastSuccessAt: r.lastSuccessAt,
          lastError: r.lastError,
          consecutiveFailures: r.consecutiveFailures,
          itemsTotal: r.itemsTotal,
          itemsLastFetch: r.itemsLastFetch,
        },
      ]),
    );
  }

  async saveHealth(id: string, h: HealthState): Promise<void> {
    const v = {
      sourceId: id,
      lastFetchAt: h.lastFetchAt,
      lastSuccessAt: h.lastSuccessAt,
      lastError: h.lastError,
      consecutiveFailures: h.consecutiveFailures,
      itemsTotal: h.itemsTotal,
      itemsLastFetch: h.itemsLastFetch,
    };
    await db.insert(sourceHealth).values(v).onConflictDoUpdate({ target: sourceHealth.sourceId, set: v });
  }
}
