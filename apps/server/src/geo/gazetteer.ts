import fs from 'node:fs';
import path from 'node:path';
import type { GeoLocation } from '@gw/shared';
import { config } from '../config.js';
import { AMBIGUOUS_WORDS, COUNTRY_ALIASES, DEMONYMS, NON_PLACE_PHRASES } from './aliases.js';

type Kind = 'city' | 'admin' | 'country';

interface Place {
  kind: Kind;
  name: string;
  country: string;
  lat: number;
  lon: number;
  pop: number;
  admin1?: string;
}

interface CountryInfo {
  code: string;
  name: string;
  lat: number;
  lon: number;
  pop: number;
}

export interface GazetteerData {
  /** normalised lower-case key → candidates */
  names: Map<string, Place[]>;
  /** case-sensitive aliases (abbreviations like "US", "UK") */
  exact: Map<string, Place[]>;
  countries: Map<string, CountryInfo>;
  maxGram: number;
}

const LATIN = /^[\p{Script=Latin}\d\s'’.\-]+$/u;

function key(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’']/g, "'")
    .replace(/[.]/g, '')
    .replace(/[-\s]+/g, ' ')
    .trim();
}

function add(map: Map<string, Place[]>, k: string, p: Place) {
  if (!k) return;
  const arr = map.get(k);
  if (!arr) map.set(k, [p]);
  else if (!arr.some((x) => x.kind === p.kind && x.country === p.country && x.name === p.name)) arr.push(p);
}

/** Weighted median of a list of [value, weight]. */
function wmedian(vals: [number, number][]): number {
  const sorted = [...vals].sort((a, b) => a[0] - b[0]);
  const total = sorted.reduce((s, v) => s + v[1], 0);
  let acc = 0;
  for (const [v, w] of sorted) {
    acc += w;
    if (acc >= total / 2) return v;
  }
  return sorted[sorted.length - 1]?.[0] ?? 0;
}

export function loadGazetteer(dir: string): GazetteerData {
  const names = new Map<string, Place[]>();
  const exact = new Map<string, Place[]>();
  const countries = new Map<string, CountryInfo>();

  const countryLines = fs.readFileSync(path.join(dir, 'countryInfo.txt'), 'utf8').split('\n');
  const countryNames = new Map<string, { name: string; pop: number }>();
  for (const line of countryLines) {
    if (!line || line.startsWith('#')) continue;
    const f = line.split('\t');
    countryNames.set(f[0]!, { name: f[4]!, pop: Number(f[7]) || 0 });
  }

  const adminNames = new Map<string, string>();
  for (const line of fs.readFileSync(path.join(dir, 'admin1CodesASCII.txt'), 'utf8').split('\n')) {
    const f = line.split('\t');
    if (f.length >= 2) adminNames.set(f[0]!, f[1]!);
  }

  const cityPts = new Map<string, [number, number, number][]>(); // country → [lat, lon, pop]
  const adminPts = new Map<string, [number, number, number][]>(); // CC.ADM1 → pts
  const cities: Place[] = [];
  for (const line of fs.readFileSync(path.join(dir, 'cities15000.txt'), 'utf8').split('\n')) {
    const f = line.split('\t');
    if (f.length < 15) continue;
    const pop = Number(f[14]) || 0;
    const p: Place = {
      kind: 'city',
      name: f[1]!,
      country: f[8]!,
      lat: Number(f[4]),
      lon: Number(f[5]),
      pop,
      admin1: f[10],
    };
    cities.push(p);
    (cityPts.get(p.country) ?? cityPts.set(p.country, []).get(p.country)!).push([p.lat, p.lon, pop]);
    const ak = `${p.country}.${p.admin1}`;
    (adminPts.get(ak) ?? adminPts.set(ak, []).get(ak)!).push([p.lat, p.lon, pop]);
    add(names, key(p.name), p);
    if (f[2] && f[2] !== p.name) add(names, key(f[2]), p);
    // Non-Latin alternate names (Greek, Cyrillic, Arabic, Hebrew…) for larger cities.
    if (pop >= 50_000 && f[3]) {
      for (const alt of f[3].split(',')) {
        if (alt.length >= 3 && !LATIN.test(alt) && !/\d/.test(alt)) add(names, key(alt), p);
      }
    }
  }

  for (const [code, { name, pop }] of countryNames) {
    const pts = cityPts.get(code);
    if (!pts?.length) continue;
    const lat = wmedian(pts.map(([la, , w]) => [la, w]));
    const lon = wmedian(pts.map(([, lo, w]) => [lo, w]));
    countries.set(code, { code, name, lat, lon, pop });
    add(names, key(name), { kind: 'country', name, country: code, lat, lon, pop: Math.max(pop, 1) });
  }
  for (const [alias, code] of Object.entries(COUNTRY_ALIASES)) {
    const c = countries.get(code);
    if (!c) continue;
    const p: Place = { kind: 'country', name: c.name, country: code, lat: c.lat, lon: c.lon, pop: c.pop };
    // Short all-caps abbreviations only match exactly as written ("US" but not "us").
    if (/^[A-Z.]{2,4}$/.test(alias) || /^[Α-ΩА-Я]{2,4}$/.test(alias)) add(exact, alias, p);
    else add(names, key(alias), p);
  }
  // Special areas often in the news with better coordinates than a country centroid.
  const special: [string, string, number, number, Kind][] = [
    ['Gaza', 'PS', 31.45, 34.39, 'admin'],
    ['Gaza Strip', 'PS', 31.45, 34.39, 'admin'],
    ['West Bank', 'PS', 31.95, 35.25, 'admin'],
    ['Crimea', 'UA', 45.0, 34.1, 'admin'],
    ['Donbas', 'UA', 48.2, 38.2, 'admin'],
    ['Donbass', 'UA', 48.2, 38.2, 'admin'],
    ['Darfur', 'SD', 13.5, 24.5, 'admin'],
    ['Tigray', 'ET', 14.0, 38.8, 'admin'],
    ['Kashmir', 'IN', 34.1, 74.8, 'admin'],
    ['Red Sea', 'YE', 15.5, 41.5, 'admin'],
    ['Strait of Hormuz', 'IR', 26.6, 56.3, 'admin'],
    ['Golan Heights', 'IL', 33.0, 35.75, 'admin'],
    ['Sahel', 'ML', 15.5, 0.0, 'admin'],
  ];
  for (const [n, cc, lat, lon, kind] of special) {
    names.set(key(n), [{ kind, name: n, country: cc, lat, lon, pop: 2_000_000 }]);
  }

  for (const [code, pts] of adminPts) {
    const name = adminNames.get(code);
    if (!name || pts.length === 0) continue;
    const [cc] = code.split('.');
    const totalPop = pts.reduce((s, p) => s + p[2], 0);
    const lat = wmedian(pts.map(([la, , w]) => [la, w]));
    const lon = wmedian(pts.map(([, lo, w]) => [lo, w]));
    add(names, key(name), { kind: 'admin', name, country: cc!, lat, lon, pop: totalPop, admin1: code.split('.')[1] });
  }

  let maxGram = 1;
  for (const k of names.keys()) maxGram = Math.max(maxGram, Math.min(4, k.split(' ').length));
  return { names, exact, countries, maxGram };
}

interface Token {
  raw: string;
  start: number;
  sentenceStart: boolean;
}

function tokenize(text: string): Token[] {
  const out: Token[] = [];
  const re = /[\p{L}\p{M}][\p{L}\p{M}'’.\-]*[\p{L}\p{M}.]|[\p{L}]/gu;
  let m: RegExpExecArray | null;
  let lastEnd = 0;
  while ((m = re.exec(text))) {
    let raw = m[0];
    // Strip trailing period unless it is an abbreviation like U.S.
    if (raw.endsWith('.') && !/^([A-Z]\.){2,}$/.test(raw)) raw = raw.slice(0, -1);
    const between = text.slice(lastEnd, m.index);
    out.push({ raw, start: m.index, sentenceStart: out.length === 0 || /[.!?:\n|]\s*$/.test(between) || /[“"‘]\s*$/.test(between) });
    lastEnd = m.index + m[0].length;
  }
  return out;
}

function isCapitalised(w: string): boolean {
  const c = w[0]!;
  // Upper-case letter, or a script without letter case (Arabic, Hebrew, CJK…).
  return c !== c.toLowerCase() || c.toLowerCase() === c.toUpperCase();
}

/** Remove a leading news dateline ("SEOUL, Oct. 15 (Yonhap) --", "LONDON (Reuters) -") — it names the bureau, not the story. */
export function stripDateline(s: string): string {
  return s.replace(/^\s*[A-Z][A-Z .'’-]{2,40}(,\s*[A-Za-z. ]{2,30}?)?(,\s*[A-Z][a-z]{2,8}\.? \d{1,2})?\s*(\([^)]{2,40}\))?\s*[-–—]{1,2}\s*/, '');
}

interface Mention {
  places: Place[];
  surface: string;
  weight: number;
  ambiguous: boolean;
  personLike?: boolean;
}

const PLACE_SUFFIX = /^(City|Airport|Region|Province|Oblast|Port|Bay|Island|Islands|Harbou?r|Station|Strip|Valley|Coast|Governorate|County|District|State|Metro|Area)$/;

const KIND_RANK: Record<Kind, number> = { city: 3, admin: 2, country: 1 };

export interface GeoGuess extends GeoLocation {
  /** All countries mentioned, strongest first (useful for the LLM prompt/debugging). */
  countries: string[];
}

export class Gazetteer {
  constructor(private data: GazetteerData) {}

  get countryCount(): number {
    return this.data.countries.size;
  }

  countryName(code: string | null | undefined): string | null {
    return code ? this.data.countries.get(code)?.name ?? null : null;
  }

  countryCentroid(code: string): { lat: number; lon: number } | null {
    const c = this.data.countries.get(code.toUpperCase());
    return c ? { lat: c.lat, lon: c.lon } : null;
  }

  /** Nearest known place name for coordinates (used to label LLM/GDELT points). */
  findPlace(name: string, country?: string | null): Place | null {
    const cands = this.data.names.get(key(name));
    if (!cands?.length) return null;
    const pool = country ? cands.filter((c) => c.country === country.toUpperCase()) : cands;
    return [...(pool.length ? pool : cands)].sort((a, b) => KIND_RANK[b.kind] - KIND_RANK[a.kind] || b.pop - a.pop)[0] ?? null;
  }

  private mentions(text: string, weight: number): { mentions: Mention[]; demonyms: string[] } {
    let masked = text;
    for (const phrase of NON_PLACE_PHRASES) {
      if (masked.includes(phrase)) masked = masked.split(phrase).join(' '.repeat(phrase.length));
    }
    const toks = tokenize(masked);
    const out: Mention[] = [];
    const demonyms: string[] = [];
    const used = new Set<number>();
    const mostlyUpper = toks.filter((t) => /\p{Lu}{2,}/u.test(t.raw)).length > toks.length * 0.6;
    const titleCase = toks.filter((t) => isCapitalised(t.raw)).length > toks.length * 0.7;
    for (let n = this.data.maxGram; n >= 1; n--) {
      for (let i = 0; i + n <= toks.length; i++) {
        let skip = false;
        for (let j = i; j < i + n; j++) if (used.has(j)) skip = true;
        if (skip) continue;
        const words = toks.slice(i, i + n).map((t) => t.raw);
        const surface = words.join(' ');
        const exactHit = this.data.exact.get(surface.replace(/\s/g, ''));
        if (exactHit && n === 1) {
          out.push({ places: exactHit, surface, weight, ambiguous: false });
          used.add(i);
          continue;
        }
        // Place names must be capitalised (except connector words like "of", "de", "al").
        const capsOk =
          mostlyUpper ||
          (isCapitalised(words[0]!) && isCapitalised(words[words.length - 1]!) && words.every((w) => isCapitalised(w) || /^(of|de|del|la|el|al|da|do|upon|on|am|an|der|sur|en)$/.test(w)));
        if (!capsOk) continue;
        const k = key(surface);
        const dem = n <= 2 ? DEMONYMS[surface] : undefined;
        let places = this.data.names.get(k);
        if (!places && /[^\p{Script=Latin}]/u.test(k) && k.length >= 5) {
          // Light de-inflection for Greek / Cyrillic (Αθήνας → Αθήνα, Києва → Київ is out of reach).
          places = this.data.names.get(k.slice(0, -1)) ?? (k.length >= 6 ? this.data.names.get(k.slice(0, -2)) : undefined);
        }
        if (!places) {
          if (dem) {
            demonyms.push(dem);
            for (let j = i; j < i + n; j++) used.add(j);
          }
          continue;
        }
        const single = n === 1;
        const next = toks[i + 1];
        // "Sydney Sweeney", "Jackson Pollock": a capitalised non-place word right after a city name suggests a person.
        const personLike =
          single &&
          !titleCase &&
          !!next &&
          !next.sentenceStart &&
          next.start - (toks[i]!.start + toks[i]!.raw.length) <= 1 &&
          isCapitalised(next.raw) &&
          !PLACE_SUFFIX.test(next.raw) &&
          !this.data.names.has(key(next.raw));
        const ambiguous =
          single &&
          (personLike ||
            AMBIGUOUS_WORDS.has(words[0]!) ||
            words[0]!.length <= 3 ||
            (toks[i]!.sentenceStart && places.every((p) => p.kind === 'city' && p.pop < 200_000)));
        out.push({ places, surface, weight, ambiguous, personLike });
        for (let j = i; j < i + n; j++) used.add(j);
      }
    }
    return { mentions: out, demonyms };
  }

  /** Locate where a story happens from its title (+ optional body/hint text). */
  locate(title: string, body = '', regionHint?: string | null): GeoGuess | null {
    const a = this.mentions(title, 3);
    const b = body ? this.mentions(stripDateline(body), 1) : { mentions: [], demonyms: [] };
    const mentions = [...a.mentions, ...b.mentions];
    const demonyms = [...a.demonyms.map((d) => [d, 3] as const), ...b.demonyms.map((d) => [d, 1] as const)];

    // Countries explicitly named (country-kind mentions) give context for disambiguating cities.
    const namedCountries = new Set<string>();
    for (const m of mentions) for (const p of m.places) if (p.kind === 'country' && m.places.length === 1) namedCountries.add(p.country);
    for (const [d] of demonyms) namedCountries.add(d);

    const support = new Map<string, number>();
    const resolved: { place: Place; weight: number }[] = [];
    for (const m of mentions) {
      const pick = this.disambiguate(m, namedCountries, regionHint);
      if (!pick) continue;
      resolved.push({ place: pick, weight: m.weight });
      const kindW = pick.kind === 'country' ? 1 : 1.2;
      support.set(pick.country, (support.get(pick.country) ?? 0) + m.weight * kindW);
    }
    for (const [cc, w] of demonyms) support.set(cc, (support.get(cc) ?? 0) + w * 0.4);
    if (support.size === 0) return null;

    const ranked = [...support.entries()].sort((x, y) => y[1] - x[1]);
    const [topCc, topW] = ranked[0]!;
    const total = ranked.reduce((s, [, w]) => s + w, 0);
    const share = topW / total;

    const inTop = resolved.filter((r) => r.place.country === topCc);
    // Headline places beat body places; then the most specific; then population.
    inTop.sort((x, y) => y.weight - x.weight || KIND_RANK[y.place.kind] - KIND_RANK[x.place.kind] || y.place.pop - x.place.pop);
    // A body city inside the headline's region/country is still more precise than the headline area.
    const head = inTop[0];
    if (head && head.place.kind !== 'city') {
      const finer = inTop.find((r) => KIND_RANK[r.place.kind] > KIND_RANK[head.place.kind] && (head.place.kind === 'country' || r.place.admin1 === head.place.admin1));
      if (finer) inTop.unshift(finer);
    }
    const best = inTop[0]?.place;
    const country = this.data.countries.get(topCc);

    let loc: Omit<GeoLocation, 'confidence' | 'method'>;
    if (best) {
      loc = {
        place: best.name,
        country: topCc,
        lat: best.lat,
        lon: best.lon,
        precision: best.kind === 'city' ? 'city' : best.kind === 'admin' ? 'region' : 'country',
      };
    } else if (country) {
      loc = { place: country.name, country: topCc, lat: country.lat, lon: country.lon, precision: 'country' };
    } else return null;

    const onlyDemonyms = inTop.length === 0;
    let confidence = 0.45 + 0.35 * share + (topW >= 3 ? 0.1 : 0) + (loc.precision === 'city' && namedCountries.has(topCc) ? 0.1 : 0);
    if (onlyDemonyms) confidence = Math.min(confidence, 0.45);
    if (loc.precision === 'country') confidence = Math.min(confidence, 0.8);
    if (resolved.some((r) => r.place.country === topCc && r.weight === 3)) confidence += 0.05;
    return {
      ...loc,
      confidence: Math.round(Math.min(0.95, confidence) * 100) / 100,
      method: 'gazetteer',
      countries: ranked.map(([c]) => c),
    };
  }

  private disambiguate(m: Mention, namedCountries: Set<string>, regionHint?: string | null): Place | null {
    const scored = m.places.map((p) => {
      let s = Math.log10(p.pop + 10);
      if (namedCountries.has(p.country)) s += 4;
      if (regionHint && p.country === regionHint) s += 1.5;
      if (p.kind === 'country') s += 3;
      if (p.kind === 'admin') s += 0.5;
      return { p, s };
    });
    scored.sort((a, b) => b.s - a.s);
    let best = scored[0]?.p;
    if (!best) return null;
    if (best.kind === 'admin') {
      // "Kharkiv", "Valencia", "Buenos Aires": the city usually is the referent when it shares the region's name.
      const city = m.places.find((p) => p.kind === 'city' && p.country === best!.country && p.pop >= 50_000);
      if (city) best = city;
    }
    if (m.personLike && best.kind === 'city' && !namedCountries.has(best.country)) return null;
    if (m.ambiguous && best.kind === 'city' && !namedCountries.has(best.country) && best.pop < config.geo.ambiguousCityMinPop) return null;
    // Small single-word towns need context.
    if (best.kind === 'city' && !m.surface.includes(' ') && best.pop < 100_000 && !namedCountries.has(best.country) && best.country !== regionHint) return null;
    return best;
  }
}

let instance: Gazetteer | null = null;

export function getGazetteer(dir: string): Gazetteer {
  if (!instance) instance = new Gazetteer(loadGazetteer(dir));
  return instance;
}
