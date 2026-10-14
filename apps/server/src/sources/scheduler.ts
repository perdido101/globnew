import pLimit from 'p-limit';
import type { SourceType } from '@gw/shared';
import { config } from '../config.js';
import { HttpError } from '../http/fetch.js';
import { gdeltIngester } from '../ingest/gdelt.js';
import { normalise, type NormalisedItem } from '../ingest/normalise.js';
import { redditIngester } from '../ingest/reddit.js';
import { rssIngester } from '../ingest/rss.js';
import { telegramIngester } from '../ingest/telegram.js';
import type { Ingester } from '../ingest/types.js';
import { log } from '../log.js';
import type { SourceDef } from './config.js';
import { backoffMs, emptyHealth, toView, type HealthState } from './health.js';

const INGESTERS: Record<SourceType, Ingester> = {
  news: rssIngester,
  gdelt: gdeltIngester,
  reddit: redditIngester,
  telegram: telegramIngester,
};

export interface SchedulerDeps {
  /** Returns how many of the items were new. */
  onItems: (items: NormalisedItem[]) => Promise<number>;
  loadHealth: () => Promise<Map<string, Partial<HealthState>>>;
  saveHealth: (sourceId: string, h: HealthState) => Promise<void>;
}

export class SourceScheduler {
  private sources: SourceDef[] = [];
  private health = new Map<string, HealthState>();
  private running = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private limit = pLimit(config.ingest.concurrency);

  constructor(private deps: SchedulerDeps) {}

  async start(sources: SourceDef[]): Promise<void> {
    const persisted = await this.deps.loadHealth().catch(() => new Map<string, Partial<HealthState>>());
    for (const [id, h] of persisted) this.health.set(id, { ...emptyHealth(), ...h, nextFetchAt: null });
    this.setSources(sources);
    this.timer = setInterval(() => this.tick(), 1000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  setSources(sources: SourceDef[]): void {
    this.sources = sources;
    const now = Date.now();
    let i = 0;
    for (const s of sources) {
      const h = this.health.get(s.id) ?? emptyHealth();
      // Stagger first fetches so we don't hit everything at once.
      if (!h.nextFetchAt) h.nextFetchAt = new Date(now + 500 + i++ * 700);
      this.health.set(s.id, h);
    }
  }

  views() {
    return this.sources.map((s) => toView(s, this.health.get(s.id) ?? emptyHealth()));
  }

  /** Force an immediate fetch (admin). */
  fetchNow(id: string): boolean {
    const h = this.health.get(id);
    if (!h) return false;
    h.nextFetchAt = new Date();
    return true;
  }

  private interval(s: SourceDef): number {
    return (s.intervalSec ?? config.ingest.intervalSec[s.type]) * 1000;
  }

  private tick(): void {
    const now = Date.now();
    for (const s of this.sources) {
      if (!s.enabled || this.running.has(s.id)) continue;
      const h = this.health.get(s.id)!;
      if (h.nextFetchAt && h.nextFetchAt.getTime() > now) continue;
      this.running.add(s.id);
      h.nextFetchAt = new Date(now + this.interval(s)); // provisional, prevents re-queue
      void this.limit(() => this.run(s)).finally(() => this.running.delete(s.id));
    }
  }

  private async run(s: SourceDef): Promise<void> {
    const h = this.health.get(s.id)!;
    const started = Date.now();
    h.lastFetchAt = new Date();
    try {
      const raws = await INGESTERS[s.type].fetch(s);
      const now = new Date();
      const items = raws.map((r) => normalise(s, r, now)).filter((x): x is NormalisedItem => x !== null);
      h.lastSuccessAt = now;
      h.consecutiveFailures = 0;
      h.lastError = items.length === 0 && raws.length === 0 && (s.type === 'news' || s.type === 'gdelt') ? 'empty response' : null;
      h.itemsLastFetch = items.length;
      h.emptyFetches = raws.length === 0 ? h.emptyFetches + 1 : 0;
      h.nextFetchAt = new Date(Date.now() + this.interval(s) * (0.9 + Math.random() * 0.2));
      log.debug({ source: s.id, items: items.length, ms: Date.now() - started }, 'fetched');
      if (items.length) h.itemsTotal += await this.deps.onItems(items);
    } catch (err) {
      h.consecutiveFailures += 1;
      h.lastError = (err as Error).message?.slice(0, 300) ?? String(err);
      const retryAfter = err instanceof HttpError ? err.retryAfterSec : undefined;
      // Never poll a failing source more often than its normal interval.
      h.nextFetchAt = new Date(Date.now() + Math.max(backoffMs(h.consecutiveFailures, retryAfter), Math.min(this.interval(s), 120_000)));
      log.warn({ source: s.id, failures: h.consecutiveFailures, err: h.lastError }, 'source fetch failed');
    }
    await this.deps.saveHealth(s.id, h).catch(() => {});
  }
}
