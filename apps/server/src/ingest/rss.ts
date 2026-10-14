import { XMLParser } from 'fast-xml-parser';
import { fetchText } from '../http/fetch.js';
import type { SourceDef } from '../sources/config.js';
import { decodeEntities, stripHtml } from '../util/text.js';
import type { Ingester, RawItem } from './types.js';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  textNodeName: '#text',
  removeNSPrefix: false,
  processEntities: true,
  htmlEntities: true,
  isArray: (name) => ['item', 'entry', 'media:content', 'media:thumbnail', 'link', 'enclosure', 'category'].includes(name),
});

type Node = Record<string, unknown>;

function text(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) return text(v[0]);
  if (typeof v === 'object') {
    const o = v as Node;
    if ('#text' in o) return text(o['#text']);
    if ('__cdata' in o) return text(o['__cdata']);
  }
  return '';
}

function attr(v: unknown, name: string): string | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const r = (v as Node)['@' + name];
  return typeof r === 'string' ? r : undefined;
}

function firstImage(entry: Node): string | null {
  const candidates: unknown[] = [];
  for (const key of ['media:content', 'media:thumbnail']) {
    const arr = entry[key];
    if (Array.isArray(arr)) candidates.push(...arr);
  }
  const group = entry['media:group'] as Node | undefined;
  if (group) {
    for (const key of ['media:content', 'media:thumbnail']) {
      const arr = group[key];
      if (Array.isArray(arr)) candidates.push(...arr);
    }
  }
  // Prefer the widest media:content image.
  let best: { url: string; w: number } | null = null;
  for (const c of candidates) {
    const url = attr(c, 'url');
    if (!url) continue;
    const medium = attr(c, 'medium');
    const type = attr(c, 'type');
    if (medium && medium !== 'image') continue;
    if (type && !type.startsWith('image')) continue;
    const w = Number(attr(c, 'width') ?? 0);
    if (!best || w > best.w) best = { url, w };
  }
  if (best) return best.url;
  const enclosures = entry['enclosure'];
  if (Array.isArray(enclosures)) {
    for (const e of enclosures) {
      const url = attr(e, 'url');
      const type = attr(e, 'type') ?? '';
      if (url && (type.startsWith('image') || /\.(jpe?g|png|webp)(\?|$)/i.test(url))) return url;
    }
  }
  const html = text(entry['content:encoded']) || text(entry['description']) || text(entry['content']) || text(entry['summary']);
  const m = /<img[^>]+src=["']([^"']+)["']/i.exec(html);
  return m ? decodeEntities(m[1]!) : null;
}

function entryLink(entry: Node): string {
  const links = entry['link'];
  if (Array.isArray(links)) {
    // Atom: prefer rel=alternate
    const alt = links.find((l) => typeof l === 'object' && (attr(l, 'rel') ?? 'alternate') === 'alternate' && attr(l, 'href'));
    if (alt) return attr(alt, 'href')!;
    const any = links.map((l) => (typeof l === 'object' ? attr(l, 'href') ?? text(l) : String(l))).find(Boolean);
    if (any) return any;
  }
  const guid = entry['guid'];
  if (guid && attr(guid, 'isPermaLink') !== 'false') {
    const g = text(guid);
    if (/^https?:\/\//.test(g)) return g;
  }
  return '';
}

function parseDate(...vals: unknown[]): Date | null {
  for (const v of vals) {
    const s = text(v).trim();
    if (!s) continue;
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

export function parseFeed(xml: string): (RawItem & { rawHtml?: string })[] {
  const doc = parser.parse(xml) as Node;
  const rss = doc['rss'] as Node | undefined;
  const channel = (rss?.['channel'] ?? (doc['rdf:RDF'] as Node | undefined)?.['channel']) as Node | undefined;
  const feed = doc['feed'] as Node | undefined;
  const entries: Node[] =
    ((rss?.['channel'] as Node | undefined)?.['item'] as Node[] | undefined) ??
    ((doc['rdf:RDF'] as Node | undefined)?.['item'] as Node[] | undefined) ??
    (feed?.['entry'] as Node[] | undefined) ??
    [];
  const feedLang = text(channel?.['language']) || attr(feed, 'xml:lang') || null;

  const out: (RawItem & { rawHtml?: string })[] = [];
  for (const e of entries) {
    const url = entryLink(e).trim();
    const title = stripHtml(text(e['title']));
    if (!url || !title) continue;
    const summaryHtml = text(e['description']) || text(e['summary']) || text(e['content']) || '';
    const categories = Array.isArray(e['category']) ? (e['category'] as unknown[]).map((c) => text(c) || attr(c, 'term') || '').join(' ') : '';
    out.push({
      url,
      title,
      summary: stripHtml(summaryHtml),
      imageUrl: firstImage(e),
      publishedAt: parseDate(e['pubDate'], e['published'], e['updated'], e['dc:date']),
      author: stripHtml(text(e['dc:creator']) || text((e['author'] as Node | undefined)?.['name']) || text(e['author'])) || null,
      lang: feedLang,
      hintText: categories || null,
      rawHtml: summaryHtml,
    });
  }
  return out;
}

export const rssIngester: Ingester = {
  async fetch(source: SourceDef) {
    const xml = await fetchText(source.url!, {
      headers: { accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5' },
      maxBytes: 6_000_000,
    });
    if (!/<(rss|feed|rdf:RDF)[\s>]/i.test(xml.slice(0, 2000))) throw new Error('Response is not an RSS/Atom feed');
    return parseFeed(xml);
  },
};
