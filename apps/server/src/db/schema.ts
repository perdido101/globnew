import { boolean, doublePrecision, index, integer, jsonb, pgTable, real, text, timestamp } from 'drizzle-orm/pg-core';
import type { Engagement } from '@gw/shared';

export const items = pgTable(
  'items',
  {
    id: text('id').primaryKey(),
    sourceId: text('source_id').notNull(),
    sourceType: text('source_type').notNull(),
    outlet: text('outlet').notNull(),
    author: text('author'),
    url: text('url').notNull(),
    title: text('title').notNull(),
    snippet: text('snippet').notNull().default(''),
    imageUrl: text('image_url'),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull(),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lang: text('lang'),
    engagement: jsonb('engagement').$type<Engagement>(),
    subreddit: text('subreddit'),
    verified: boolean('verified').notNull().default(true),
    weight: real('weight').notNull().default(0.7),
    regionHint: text('region_hint'),
    place: text('place'),
    country: text('country'),
    lat: doublePrecision('lat'),
    lon: doublePrecision('lon'),
    geoPrecision: text('geo_precision'),
    geoConfidence: real('geo_confidence'),
    geoMethod: text('geo_method'),
    category: text('category'),
    breaking: boolean('breaking').notNull().default(false),
    importance: real('importance'),
    clusterId: text('cluster_id'),
    processed: boolean('processed').notNull().default(false),
  },
  (t) => [
    index('items_first_seen_idx').on(t.firstSeenAt),
    index('items_cluster_idx').on(t.clusterId),
    index('items_url_idx').on(t.url),
  ],
);

export const clusters = pgTable(
  'clusters',
  {
    id: text('id').primaryKey(),
    leadItemId: text('lead_item_id').notNull(),
    title: text('title').notNull(),
    category: text('category').notNull(),
    breaking: boolean('breaking').notNull().default(false),
    importance: real('importance').notNull().default(0),
    sourceCount: integer('source_count').notNull().default(1),
    place: text('place'),
    country: text('country'),
    lat: doublePrecision('lat'),
    lon: doublePrecision('lon'),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('clusters_first_seen_idx').on(t.firstSeenAt)],
);

export const sourceHealth = pgTable('source_health', {
  sourceId: text('source_id').primaryKey(),
  lastFetchAt: timestamp('last_fetch_at', { withTimezone: true }),
  lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
  lastError: text('last_error'),
  consecutiveFailures: integer('consecutive_failures').notNull().default(0),
  itemsTotal: integer('items_total').notNull().default(0),
  itemsLastFetch: integer('items_last_fetch').notNull().default(0),
});

/** LLM enrichment results cached by item content hash. */
export const llmCache = pgTable('llm_cache', {
  hash: text('hash').primaryKey(),
  result: jsonb('result').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Open Graph lookups cached by URL. */
export const ogCache = pgTable('og_cache', {
  url: text('url').primaryKey(),
  image: text('image'),
  title: text('title'),
  siteName: text('site_name'),
  ok: boolean('ok').notNull(),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
});
