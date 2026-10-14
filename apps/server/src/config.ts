import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import YAML from 'yaml';
import { z } from 'zod';
import { REPO_ROOT } from './paths.js';

dotenv.config({ path: path.join(REPO_ROOT, '.env'), quiet: true });

const num = z.number();
const ConfigSchema = z.object({
  server: z.object({ port: num, memoryWindowHours: num, maxItemsInMemory: num }),
  ingest: z.object({
    intervalSec: z.object({ news: num, gdelt: num, reddit: num, telegram: num }),
    maxItemAgeHours: num,
    requestTimeoutMs: num,
    userAgent: z.string(),
    backoffBaseSec: num,
    backoffMaxSec: num,
    deadAfterFailures: num,
    concurrency: num,
    respectRobotsTxt: z.boolean(),
  }),
  reddit: z.object({ minVelocity: num, maxPostAgeHours: num, listings: z.array(z.string()), limit: num }),
  telegram: z.object({ minVelocity: num, maxPostAgeHours: num }),
  gdelt: z.object({ queries: z.array(z.string()), timespan: z.string(), maxRecords: num, minGapMs: num, eventsPerUpdate: num }),
  enrich: z.object({
    ogConcurrency: num,
    ogTimeoutMs: num,
    thumbWidth: num,
    thumbHeight: num,
    thumbQuality: num,
    imageCacheDir: z.string(),
    imageMaxBytes: num,
  }),
  llm: z.object({
    model: z.string(),
    effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']),
    batchSize: num,
    batchWaitMs: num,
    timeoutMs: num,
    maxCallsPerHour: num,
    geoConfidenceThreshold: num,
  }),
  geo: z.object({ dataDir: z.string(), ambiguousCityMinPop: num }),
  cluster: z.object({ similarity: num, nearSimilarity: num, nearKm: num, windowHours: num }),
  score: z.object({
    weights: z.object({ outlets: num, source: num, velocity: num, breaking: num, category: num, recency: num }),
    categoryWeights: z.record(z.string(), num),
    recencyHalfLifeMin: num,
    velocitySaturation: num,
  }),
  flow: z.object({
    cadenceMs: num,
    jitter: num,
    maxVisibleCards: num,
    cardHoldMs: num,
    dotTtlMinMs: num,
    dotTtlMaxMs: num,
    jumpScore: num,
    breakingMinScore: num,
    jumpMinGapMs: num,
    candidateMaxAgeHours: num,
    initialSeed: num,
    sessionTtlMs: num,
    statsIntervalMs: num,
  }),
  ui: z.object({ densityHours: num }),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

export const CONFIG_PATH = process.env.GW_CONFIG ?? path.join(REPO_ROOT, 'config.yaml');
export const SOURCES_PATH = process.env.GW_SOURCES ?? path.join(REPO_ROOT, 'sources.yaml');

function loadConfig(): AppConfig {
  const raw = YAML.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const parsed = ConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid ${CONFIG_PATH}:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

export const config: AppConfig = loadConfig();

export const env = {
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://globalwire:globalwire@localhost:5433/globalwire',
  port: Number(process.env.PORT ?? config.server.port),
  anthropicKey: process.env.ANTHROPIC_API_KEY || '',
  redditClientId: process.env.REDDIT_CLIENT_ID || '',
  redditClientSecret: process.env.REDDIT_CLIENT_SECRET || '',
  redditUserAgent: process.env.REDDIT_USER_AGENT || '',
  imageSecret: process.env.IMAGE_PROXY_SECRET || 'dev-insecure-image-secret',
  adminToken: process.env.ADMIN_TOKEN || '',
  logLevel: process.env.LOG_LEVEL || 'info',
  disableIngest: process.env.DISABLE_INGEST === '1',
};
