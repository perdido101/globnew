import fs from 'node:fs';
import path from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { config } from '../config.js';
import { geoDataDir } from '../geo/download.js';
import { fetchOg } from '../pipeline/og.js';
import { httpFetch, fetchText } from '../http/fetch.js';
import type { SourceDef } from '../sources/config.js';
import type { Ingester, RawItem } from './types.js';

interface DocArticle {
  url: string;
  title: string;
  seendate: string;
  socialimage?: string;
  domain: string;
  language?: string;
  sourcecountry?: string;
}

/** GDELT allows roughly one request every 5 seconds; serialise all calls through this gate. */
let gate: Promise<void> = Promise.resolve();
function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = gate.then(fn);
  gate = run.then(
    () => new Promise((r) => setTimeout(r, config.gdelt.minGapMs)),
    () => new Promise((r) => setTimeout(r, config.gdelt.minGapMs)),
  );
  return run;
}

/** "20261014T203000Z" → Date */
export function parseGdeltDate(s: string): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s);
  if (!m) return null;
  return new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!));
}

const LANG_CODES: Record<string, string> = { English: 'en', French: 'fr', German: 'de', Spanish: 'es', Greek: 'el', Russian: 'ru', Ukrainian: 'uk', Arabic: 'ar' };

async function docQuery(query: string): Promise<DocArticle[]> {
  const params = new URLSearchParams({
    query,
    mode: 'artlist',
    format: 'json',
    sort: 'datedesc',
    maxrecords: String(config.gdelt.maxRecords),
    timespan: config.gdelt.timespan,
  });
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?${params}`;
  // GDELT returns an empty body (not JSON) when there are no results.
  const text = await throttled(() => fetchText(url, { checkRobots: false }));
  if (!text.trim()) return [];
  if (!text.trim().startsWith('{')) throw new Error(`GDELT: ${text.trim().slice(0, 140)}`);
  const json = JSON.parse(text) as { articles?: DocArticle[] };
  return json.articles ?? [];
}

/** FIPS 10-4 → ISO 3166-1 alpha-2, from GeoNames countryInfo.txt (GDELT events use FIPS codes). */
let fipsMap: Map<string, string> | null = null;
function fipsToIso(fips: string): string | null {
  if (!fipsMap) {
    fipsMap = new Map();
    try {
      for (const line of fs.readFileSync(path.join(geoDataDir(), 'countryInfo.txt'), 'utf8').split('\n')) {
        if (!line || line.startsWith('#')) continue;
        const f = line.split('\t');
        if (f[3]) fipsMap.set(f[3], f[0]!);
      }
    } catch {
      /* gazetteer not downloaded yet */
    }
  }
  return fipsMap.get(fips) ?? null;
}

export interface GdeltEvent {
  url: string;
  lat: number;
  lon: number;
  place: string;
  country: string | null;
  mentions: number;
  goldstein: number;
  geoType: number;
  added: Date | null;
}

/** Parse a GDELT 2.0 events export (tab separated, 61 columns, no header). */
export function parseEventsCsv(csv: string): GdeltEvent[] {
  const out: GdeltEvent[] = [];
  for (const line of csv.split('\n')) {
    const f = line.split('\t');
    if (f.length < 61) continue;
    const lat = Number(f[56]);
    const lon = Number(f[57]);
    const url = f[60]!.trim();
    const geoType = Number(f[51]);
    if (!url.startsWith('http') || !Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0) || !f[56]) continue;
    const added = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(f[59]!.trim());
    out.push({
      url,
      lat,
      lon,
      place: (f[52] ?? '').split(',')[0]!.trim(),
      country: f[53] ? fipsToIso(f[53]) : null,
      mentions: Number(f[31]) || 0,
      goldstein: Number(f[30]) || 0,
      geoType,
      added: added ? new Date(Date.UTC(+added[1]!, +added[2]! - 1, +added[3]!, +added[4]!, +added[5]!, +added[6]!)) : null,
    });
  }
  return out;
}

let lastExport = '';

/**
 * GDELT 2.0 15-minute events export: geolocated events with their source article URL.
 * (The GEO 2.0 API was retired, so this is where coordinates come from.)
 */
async function latestEvents(): Promise<GdeltEvent[]> {
  const idx = await fetchText('https://data.gdeltproject.org/gdeltv2/lastupdate.txt', { checkRobots: false });
  const exportUrl = /(\S+\.export\.CSV\.zip)/.exec(idx)?.[1]?.replace(/^http:/, 'https:');
  if (!exportUrl || exportUrl === lastExport) return [];
  const res = await httpFetch(exportUrl, { checkRobots: false, timeoutMs: 60_000 });
  const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
  const csv = Object.values(files)[0];
  lastExport = exportUrl;
  return csv ? parseEventsCsv(strFromU8(csv)) : [];
}

/** One location per URL: the most-mentioned event with the most specific geography (city > state > country). */
export function bestEventPerUrl(events: GdeltEvent[]): Map<string, GdeltEvent> {
  const rank = (e: GdeltEvent) => (e.geoType === 3 || e.geoType === 4 ? 2 : e.geoType === 2 || e.geoType === 5 ? 1 : 0);
  const map = new Map<string, GdeltEvent>();
  for (const e of events) {
    const cur = map.get(e.url);
    if (!cur || rank(e) > rank(cur) || (rank(e) === rank(cur) && e.mentions > cur.mentions)) map.set(e.url, e);
  }
  return map;
}

export const gdeltIngester: Ingester = {
  async fetch(source: SourceDef): Promise<RawItem[]> {
    const queries = source.query ? [source.query] : config.gdelt.queries;
    const events = bestEventPerUrl(await latestEvents());
    const out: RawItem[] = [];
    const seen = new Set<string>();
    let docError: Error | null = null;
    for (const q of queries) {
      let articles: DocArticle[] = [];
      try {
        articles = await docQuery(q);
      } catch (err) {
        docError = err as Error;
        continue;
      }
      for (const a of articles) {
        if (!a.url || !a.title || seen.has(a.url)) continue;
        seen.add(a.url);
        const e = events.get(a.url);
        out.push({
          url: a.url,
          title: a.title,
          summary: '',
          imageUrl: a.socialimage || null,
          publishedAt: parseGdeltDate(a.seendate),
          outlet: a.domain,
          lang: a.language ? LANG_CODES[a.language] ?? a.language.slice(0, 2).toLowerCase() : null,
          geo: e ? { lat: e.lat, lon: e.lon, place: e.place, country: e.country } : null,
        });
      }
    }
    // Events export: the most-covered geolocated events, titled from the article's Open Graph tags.
    const top = [...events.values()]
      .filter((e) => !seen.has(e.url) && e.geoType !== 1)
      .sort((a, b) => b.mentions - a.mentions || Math.abs(b.goldstein) - Math.abs(a.goldstein))
      .slice(0, config.gdelt.eventsPerUpdate);
    const titled = await Promise.all(
      top.map(async (e) => {
        const og = await fetchOg(e.url);
        if (!og.ok || !og.title) return null;
        const item: RawItem = {
          url: e.url,
          title: og.title,
          summary: '',
          imageUrl: og.image,
          publishedAt: e.added,
          outlet: og.siteName || new URL(e.url).hostname.replace(/^www\./, ''),
          geo: { lat: e.lat, lon: e.lon, place: e.place, country: e.country },
        };
        return item;
      }),
    );
    for (const t of titled) if (t) out.push(t);
    if (out.length === 0 && docError) throw docError;
    return out;
  },
};
