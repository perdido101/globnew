import type { Item } from '@gw/shared';
import { config } from '../config.js';
import type { SourceDef } from '../sources/config.js';
import { shortHash } from '../util/hash.js';
import { cleanTitle, snippet, truncate } from '../util/text.js';
import type { RawItem } from './types.js';

const TRACKING = /^(utm_|fbclid$|gclid$|ocid$|cmpid$|at_|xtor$|ns_|mc_|ref$|src$|CMP$|taid$)/i;

export function canonicalUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    u.hash = '';
    for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
    u.hostname = u.hostname.toLowerCase();
    if (u.protocol === 'http:') u.protocol = 'https:';
    let s = u.toString();
    if (s.endsWith('/') && u.pathname !== '/') s = s.slice(0, -1);
    return s;
  } catch {
    return raw.trim();
  }
}

export interface NormalisedItem extends Item {
  /** Extra transient text for enrichment (never persisted). */
  hintText?: string | null;
}

export function normalise(source: SourceDef, raw: RawItem, now = new Date()): NormalisedItem | null {
  const url = canonicalUrl(raw.url);
  if (!/^https?:\/\//.test(url)) return null;
  const title = truncate(cleanTitle(raw.title), 220);
  if (title.length < 8) return null;
  const published = raw.publishedAt && raw.publishedAt.getTime() <= now.getTime() + 10 * 60_000 ? raw.publishedAt : now;
  if (now.getTime() - published.getTime() > config.ingest.maxItemAgeHours * 3600_000) return null;
  const summary = snippet(raw.summary ?? '', 200);
  return {
    // Same URL from different sources is the same item; per-source variants (reddit posts) keep their own source.
    id: shortHash(`${source.type === 'reddit' ? source.id + '|' : ''}${url}`),
    sourceId: source.id,
    sourceType: source.type,
    outlet: raw.outlet || source.name,
    author: raw.author ?? null,
    url,
    title,
    snippet: summary === title ? '' : summary,
    imageUrl: raw.imageUrl ? new URL(raw.imageUrl, url).toString() : null,
    publishedAt: published.toISOString(),
    firstSeenAt: now.toISOString(),
    lang: raw.lang ?? source.lang ?? null,
    engagement: raw.engagement,
    subreddit: raw.subreddit ?? null,
    verified: source.type === 'telegram' ? source.verified === true : true,
    weight: source.weight,
    regionHint: source.country ?? null,
    geo: raw.geo
      ? {
          place: raw.geo.place || 'Unknown',
          country: raw.geo.country ?? null,
          lat: raw.geo.lat,
          lon: raw.geo.lon,
          precision: 'city',
          confidence: 0.75,
          method: 'gdelt',
        }
      : null,
    hintText: raw.hintText ?? null,
  };
}
