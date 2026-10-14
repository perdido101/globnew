import type { Category } from './categories.js';

export type SourceType = 'news' | 'reddit' | 'telegram' | 'gdelt';
export const SOURCE_TYPES: SourceType[] = ['news', 'gdelt', 'reddit', 'telegram'];

export type GeoPrecision = 'city' | 'region' | 'country';
export type GeoMethod = 'gdelt' | 'gazetteer' | 'llm';

export interface GeoLocation {
  place: string;
  /** ISO 3166-1 alpha-2, upper case. */
  country: string | null;
  lat: number;
  lon: number;
  precision: GeoPrecision;
  /** 0..1 */
  confidence: number;
  method: GeoMethod;
}

export interface Engagement {
  score?: number;
  comments?: number;
  views?: number;
  /** Units gained per minute since posting (score for reddit, views for telegram). */
  velocity?: number;
}

/** A single normalised item from any source. Metadata only — never full article text. */
export interface Item {
  id: string;
  sourceId: string;
  sourceType: SourceType;
  outlet: string;
  author?: string | null;
  url: string;
  title: string;
  /** ≤ ~200 chars. */
  snippet: string;
  /** Original image URL (server side only; clients receive proxied `thumb`). */
  imageUrl?: string | null;
  publishedAt: string;
  firstSeenAt: string;
  lang?: string | null;
  engagement?: Engagement;
  subreddit?: string | null;
  verified: boolean;
  /** Source weight from sources.yaml (0..1). */
  weight: number;
  regionHint?: string | null;
  geo?: GeoLocation | null;
  category?: Category | null;
  breaking?: boolean;
  importance?: number;
  clusterId?: string | null;
}

/** One outlet's entry inside a cluster, as shown to clients. */
export interface ClusterSource {
  itemId: string;
  outlet: string;
  sourceType: SourceType;
  url: string;
  title: string;
  publishedAt: string;
  subreddit?: string | null;
  verified: boolean;
  engagement?: Engagement;
}

/** A story: one or more items covering the same event. This is what the client renders. */
export interface ClusterView {
  id: string;
  title: string;
  snippet: string;
  url: string;
  outlet: string;
  sourceType: SourceType;
  subreddit?: string | null;
  verified: boolean;
  /** Proxied thumbnail path (`/img/...`) or null. */
  thumb: string | null;
  geo: GeoLocation | null;
  category: Category;
  breaking: boolean;
  importance: number;
  sourceCount: number;
  sources: ClusterSource[];
  firstSeenAt: string;
  publishedAt: string;
  updatedAt: string;
  engagement?: Engagement;
  /** Set when the cluster was released into a client's flow. */
  releasedAt?: string;
  /** Time-to-live after release, scaled by importance (ms). */
  ttlMs?: number;
}

export interface FlowConfigView {
  cadenceMs: number;
  maxVisibleCards: number;
  dotTtlMinMs: number;
  dotTtlMaxMs: number;
  cardHoldMs: number;
}

export interface StatsView {
  itemsLastHour: number;
  clustersLastHour: number;
  totalClusters: number;
  queued: number;
  sourcesOk: number;
  sourcesTotal: number;
  llmEnabled: boolean;
  serverTime: string;
}

/** Session-level filters the server applies before releasing items into a client's flow. */
export interface FlowFilters {
  sourceTypes?: SourceType[];
  mutedOutlets?: string[];
  categories?: Category[];
  minImportance?: number;
  /** Region keys (see REGIONS) whose items must not be released. */
  mutedRegions?: string[];
  /** Focus region key: only items inside it are released. */
  focusRegion?: string | null;
  /** Include items with no location (go to the Global lane). */
  includeGlobal?: boolean;
  paused?: boolean;
  cadenceMs?: number;
}

export type StreamEvent =
  | {
      type: 'init';
      sessionId: string;
      clusters: ClusterView[];
      config: FlowConfigView;
      stats: StatsView;
    }
  | { type: 'release'; cluster: ClusterView }
  | { type: 'update'; cluster: ClusterView }
  | { type: 'stats'; stats: StatsView };

export interface SourceHealthView {
  id: string;
  name: string;
  type: SourceType;
  enabled: boolean;
  status: 'ok' | 'degraded' | 'failing' | 'dead' | 'idle' | 'disabled';
  lastFetchAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  itemsTotal: number;
  itemsLastFetch: number;
  nextFetchAt: string | null;
}

export interface TimelineBucket {
  t: string;
  count: number;
  byCategory: Partial<Record<Category, number>>;
}
