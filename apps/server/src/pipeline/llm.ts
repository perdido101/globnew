import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { CATEGORIES, type Category } from '@gw/shared';
import { config, env } from '../config.js';
import { log } from '../log.js';

export interface LlmInput {
  hash: string;
  title: string;
  snippet: string;
  outlet: string;
  lang?: string | null;
  hint?: string | null;
}

export interface LlmResult {
  place: string | null;
  country: string | null;
  lat: number | null;
  lon: number | null;
  precision: 'city' | 'region' | 'country' | null;
  confidence: number;
  category: Category;
  breaking: boolean;
  importance: number;
}

const ResultSchema = z.object({
  id: z.string(),
  place: z.string().nullable().describe('Most specific place where the event happens, in English; null if no location'),
  country: z.string().nullable().describe('ISO 3166-1 alpha-2 code of that place, upper case'),
  lat: z.number().nullable(),
  lon: z.number().nullable(),
  precision: z.enum(['city', 'region', 'country']).nullable(),
  confidence: z.number().describe('0..1 confidence in the location'),
  category: z.enum(CATEGORIES),
  breaking: z.boolean().describe('True only for urgent, just-happened events'),
  importance: z.number().describe('0..100 global newsworthiness'),
});

const BatchSchema = z.object({ results: z.array(ResultSchema) });

const SYSTEM = `You enrich news headlines for a world news map.
For each item return where the story HAPPENS (not where the outlet is based), its category, whether it is breaking, and its global importance.
Location rules:
- Use the most specific place that is clearly the scene of the event (city > region > country). Give approximate lat/lon for it.
- National politics/policy stories with no specific scene: the country, precision "country".
- If the item has no geographic anchor (e.g. a general science study, a celebrity profile, global markets), set place/country/lat/lon/precision to null.
- confidence reflects how sure you are about the location (0..1).
Categories: conflict (war, attacks, security, military), politics, disaster (natural disasters, severe weather, accidents), economy (markets, business, trade), tech (technology, science, space), health, society (crime, justice, migration, education, labour, religion), climate (climate & environment), sports, culture.
importance: 90+ only for major world events (war escalation, mass-casualty disaster, head-of-state change); 60-80 significant national/international news; 30-50 routine news; <30 minor/local/soft news.
Items may be in any language. Answer for every id.`;

interface Pending {
  input: LlmInput;
  resolve: (r: LlmResult | null) => void;
  timer: NodeJS.Timeout;
}

/** Batches enrichment requests into single API calls. Resolves null (→ heuristic fallback) when unavailable. */
export class LlmEnricher {
  private client: Anthropic | null;
  private queue: Pending[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private callTimes: number[] = [];
  private inFlight = 0;
  private disabledUntil = 0;
  stats = { calls: 0, items: 0, failures: 0, skippedBudget: 0 };

  constructor() {
    this.client = env.anthropicKey ? new Anthropic({ apiKey: env.anthropicKey, maxRetries: 2, timeout: 120_000 }) : null;
    if (!this.client) log.warn('ANTHROPIC_API_KEY not set — LLM enrichment disabled (gazetteer + keyword heuristics only)');
  }

  get enabled(): boolean {
    return this.client !== null;
  }

  private budgetOk(): boolean {
    const hourAgo = Date.now() - 3600_000;
    this.callTimes = this.callTimes.filter((t) => t > hourAgo);
    return this.callTimes.length < config.llm.maxCallsPerHour && Date.now() > this.disabledUntil;
  }

  enrich(input: LlmInput): Promise<LlmResult | null> {
    if (!this.client) return Promise.resolve(null);
    if (!this.budgetOk()) {
      this.stats.skippedBudget++;
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.queue = this.queue.filter((p) => p.resolve !== resolve);
        resolve(null);
      }, config.llm.timeoutMs);
      this.queue.push({ input, resolve, timer });
      if (this.queue.length >= config.llm.batchSize) this.flush();
      else if (!this.flushTimer) this.flushTimer = setTimeout(() => this.flush(), config.llm.batchWaitMs);
    });
  }

  private flush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    if (this.inFlight >= 2) {
      // Back-pressure: try again shortly.
      this.flushTimer = setTimeout(() => this.flush(), 1500);
      return;
    }
    const batch = this.queue.splice(0, config.llm.batchSize);
    if (batch.length === 0) return;
    if (this.queue.length) this.flushTimer = setTimeout(() => this.flush(), config.llm.batchWaitMs);
    void this.run(batch);
  }

  private async run(batch: Pending[]): Promise<void> {
    this.inFlight++;
    this.callTimes.push(Date.now());
    this.stats.calls++;
    const lines = batch.map((p, i) => ({
      id: String(i),
      outlet: p.input.outlet,
      lang: p.input.lang ?? undefined,
      title: p.input.title,
      text: [p.input.snippet, p.input.hint].filter(Boolean).join(' — ').slice(0, 500),
    }));
    try {
      const res = await this.client!.messages.parse({
        model: config.llm.model,
        max_tokens: 16000,
        system: SYSTEM,
        output_config: { effort: config.llm.effort, format: zodOutputFormat(BatchSchema) },
        messages: [{ role: 'user', content: JSON.stringify(lines) }],
      });
      if (res.stop_reason === 'refusal' || !res.parsed_output) throw new Error(`LLM returned no parsed output (${res.stop_reason})`);
      const byId = new Map(res.parsed_output.results.map((r) => [r.id, r]));
      batch.forEach((p, i) => {
        clearTimeout(p.timer);
        const r = byId.get(String(i));
        if (!r) return p.resolve(null);
        this.stats.items++;
        const valid = r.lat != null && r.lon != null && Math.abs(r.lat) <= 90 && Math.abs(r.lon) <= 180;
        p.resolve({
          place: valid ? r.place : null,
          country: valid && r.country ? r.country.toUpperCase().slice(0, 2) : null,
          lat: valid ? r.lat : null,
          lon: valid ? r.lon : null,
          precision: valid ? r.precision : null,
          confidence: Math.max(0, Math.min(1, r.confidence)),
          category: r.category,
          breaking: r.breaking,
          importance: Math.max(0, Math.min(100, r.importance)),
        });
      });
    } catch (err) {
      this.stats.failures++;
      if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
        log.error('Anthropic API key rejected — disabling LLM enrichment for 1h');
        this.disabledUntil = Date.now() + 3600_000;
      } else if (err instanceof Anthropic.RateLimitError) {
        this.disabledUntil = Date.now() + 120_000;
        log.warn('Anthropic rate limit — pausing LLM enrichment for 2 min');
      } else {
        log.warn({ err: (err as Error).message }, 'LLM batch failed');
      }
      for (const p of batch) {
        clearTimeout(p.timer);
        p.resolve(null);
      }
    } finally {
      this.inFlight--;
    }
  }
}
