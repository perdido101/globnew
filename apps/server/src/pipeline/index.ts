import pLimit from 'p-limit';
import type { Item } from '@gw/shared';
import { isCategory } from '@gw/shared';
import { config } from '../config.js';
import type { Repo } from '../db/repo.js';
import type { Store } from '../flow/store.js';
import type { Gazetteer } from '../geo/gazetteer.js';
import type { NormalisedItem } from '../ingest/normalise.js';
import { log } from '../log.js';
import { sha1 } from '../util/hash.js';
import { classify, detectBreaking } from './classify.js';
import { haversineKm } from './geo-util.js';
import type { LlmEnricher, LlmResult } from './llm.js';
import { fetchOg } from './og.js';

export interface PipelineStats {
  received: number;
  processed: number;
  duplicates: number;
  geolocated: number;
  geoByMethod: Record<string, number>;
  llmUsed: number;
  ogFetched: number;
  queue: number;
}

/** ingest → normalise (done by scheduler) → enrich → geolocate → classify → cluster → score → store/stream */
export class Pipeline {
  private limit = pLimit(8);
  private inProgress = new Set<string>();
  stats: PipelineStats = { received: 0, processed: 0, duplicates: 0, geolocated: 0, geoByMethod: {}, llmUsed: 0, ogFetched: 0, queue: 0 };

  constructor(
    private store: Store,
    private repo: Repo,
    private llm: LlmEnricher,
    private gazetteer: Gazetteer | null,
  ) {}

  /** Queue items for processing; returns how many were new. */
  async ingest(items: NormalisedItem[]): Promise<number> {
    this.stats.received += items.length;
    const fresh: NormalisedItem[] = [];
    for (const it of items) {
      const existing = this.store.items.get(it.id);
      if (existing) {
        // Re-polled social post: refresh engagement (velocity drives the score).
        if (it.engagement && JSON.stringify(it.engagement) !== JSON.stringify(existing.engagement)) {
          this.store.updateEngagement(it.id, it.engagement);
          this.repo.saveItem(existing);
        }
        this.stats.duplicates++;
        continue;
      }
      if (this.inProgress.has(it.id)) continue;
      fresh.push(it);
    }
    // Items already in Postgres but evicted from memory are not re-processed.
    const known = await this.repo.knownIds(fresh.map((i) => i.id)).catch(() => new Set<string>());
    let added = 0;
    for (const it of fresh) {
      if (known.has(it.id)) {
        this.stats.duplicates++;
        continue;
      }
      this.inProgress.add(it.id);
      this.stats.queue++;
      added++;
      void this.limit(() => this.process(it))
        .catch((err) => log.warn({ err: (err as Error).message, url: it.url }, 'pipeline error'))
        .finally(() => {
          this.inProgress.delete(it.id);
          this.stats.queue--;
        });
    }
    return added;
  }

  async process(raw: NormalisedItem): Promise<Item> {
    const { hintText, ...item } = raw;
    await this.enrichOg(item);
    const extra = [item.snippet, hintText].filter(Boolean).join(' . ');

    // Geolocate: GDELT coordinates → gazetteer → LLM fallback.
    if (!item.geo && this.gazetteer) {
      const g = this.gazetteer.locate(item.title, extra, item.regionHint);
      if (g) {
        const { countries: _c, ...geo } = g;
        item.geo = geo;
      }
    } else if (item.geo && this.gazetteer && !item.geo.country) {
      item.geo.country = this.gazetteer.findPlace(item.geo.place)?.country ?? null;
    }

    const heur = classify(item.title, extra);
    item.category = heur.category;
    item.breaking = detectBreaking(item.title, hintText ?? '');

    const needLlm = this.llm.enabled && (!item.geo || item.geo.confidence < config.llm.geoConfidenceThreshold || heur.confidence < 0.5);
    if (needLlm) {
      const r = await this.askLlm(item, hintText);
      if (r) this.applyLlm(item, r);
    }
    if (item.geo) {
      this.stats.geolocated++;
      this.stats.geoByMethod[item.geo.method] = (this.stats.geoByMethod[item.geo.method] ?? 0) + 1;
    }

    this.store.addItem(item);
    this.repo.saveItem(item);
    const c = this.store.clusters.get(item.clusterId!);
    if (c) {
      const lead = this.store.items.get(c.leadId)!;
      this.repo.saveCluster({
        id: c.id,
        leadItemId: c.leadId,
        title: lead.title,
        category: c.category,
        breaking: c.breaking,
        importance: c.importance,
        sourceCount: c.outletCount,
        place: c.geo?.place ?? null,
        country: c.geo?.country ?? null,
        lat: c.geo?.lat ?? null,
        lon: c.geo?.lon ?? null,
        firstSeenAt: new Date(c.firstSeenAt),
        updatedAt: new Date(c.updatedAt),
      });
      item.importance = c.importance;
    }
    this.stats.processed++;
    return item;
  }

  private async enrichOg(item: Item): Promise<void> {
    // Telegram posts and self-posts have nothing to enrich.
    if (item.sourceType === 'telegram' || /reddit\.com\//.test(item.url)) return;
    if (item.imageUrl && !(item.sourceType === 'gdelt' && item.outlet.includes('.'))) return;
    let og = await this.repo.getOg(item.url).catch(() => null);
    if (!og) {
      og = await fetchOg(item.url);
      this.stats.ogFetched++;
      await this.repo.putOg(item.url, og).catch(() => {});
    }
    if (!item.imageUrl && og.image) item.imageUrl = og.image;
    if (item.sourceType === 'gdelt' && og.siteName) item.outlet = og.siteName;
  }

  private async askLlm(item: Item, hint?: string | null): Promise<LlmResult | null> {
    const hash = sha1(`${item.title}\n${item.snippet}`);
    const cached = await this.repo.getLlm(hash).catch(() => null);
    if (cached) return cached;
    const r = await this.llm.enrich({ hash, title: item.title, snippet: item.snippet, outlet: item.outlet, lang: item.lang, hint: hint?.slice(0, 300) });
    if (r) {
      this.stats.llmUsed++;
      await this.repo.putLlm(hash, r).catch(() => {});
    }
    return r;
  }

  private applyLlm(item: Item, r: LlmResult): void {
    if (isCategory(r.category)) item.category = r.category;
    item.breaking = item.breaking || (r.breaking && r.importance >= 60);
    this.store.llmImportance.set(item.id, r.importance);
    if (r.lat == null || r.lon == null || !r.place) return;
    const llmGeo = {
      place: this.gazetteer?.findPlace(r.place, r.country)?.name ?? r.place,
      country: r.country,
      lat: r.lat,
      lon: r.lon,
      precision: r.precision ?? 'country',
      confidence: Math.round(r.confidence * 100) / 100,
      method: 'llm' as const,
    };
    const cur = item.geo;
    if (!cur) {
      if (r.confidence >= 0.4) item.geo = llmGeo;
      return;
    }
    // Disagreement: trust the LLM when it is confident and the heuristic was not.
    const far = haversineKm(cur.lat, cur.lon, r.lat, r.lon) > 300;
    if (cur.method === 'gazetteer' && far && r.confidence > cur.confidence) item.geo = llmGeo;
    else if (!far && cur.precision === 'country' && llmGeo.precision !== 'country' && r.confidence >= 0.6) item.geo = llmGeo;
  }
}
