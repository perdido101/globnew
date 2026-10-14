import type { Engagement } from '@gw/shared';
import type { SourceDef } from '../sources/config.js';

/** What an ingester returns before normalisation. */
export interface RawItem {
  url: string;
  title: string;
  summary?: string | null;
  imageUrl?: string | null;
  publishedAt?: Date | null;
  author?: string | null;
  outlet?: string | null;
  lang?: string | null;
  engagement?: Engagement;
  subreddit?: string | null;
  /** Coordinates supplied by the source (GDELT). */
  geo?: { lat: number; lon: number; place: string; country?: string | null } | null;
  /** Extra text to help geolocation/classification (not stored). */
  hintText?: string | null;
}

export interface Ingester {
  fetch(source: SourceDef): Promise<RawItem[]>;
}
