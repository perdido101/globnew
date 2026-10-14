import * as cheerio from 'cheerio';
import pLimit from 'p-limit';
import { config } from '../config.js';
import { fetchText } from '../http/fetch.js';

export interface OgData {
  image: string | null;
  title: string | null;
  siteName: string | null;
  ok: boolean;
}

export function parseOg(html: string, baseUrl: string): OgData {
  const $ = cheerio.load(html);
  const meta = (...names: string[]) => {
    for (const n of names) {
      const v = $(`meta[property="${n}"]`).attr('content') ?? $(`meta[name="${n}"]`).attr('content');
      if (v?.trim()) return v.trim();
    }
    return null;
  };
  let image = meta('og:image:secure_url', 'og:image', 'og:image:url', 'twitter:image', 'twitter:image:src');
  if (image) {
    try {
      image = new URL(image, baseUrl).toString();
    } catch {
      image = null;
    }
  }
  return { image, title: meta('og:title', 'twitter:title'), siteName: meta('og:site_name', 'application-name'), ok: true };
}

const limit = pLimit(config.enrich.ogConcurrency);

/** Fetch only the <head> part of the page — we never keep the article body. */
export function fetchOg(url: string): Promise<OgData> {
  return limit(async () => {
    try {
      const html = await fetchText(url, {
        timeoutMs: config.enrich.ogTimeoutMs,
        maxBytes: 400_000,
        headers: { accept: 'text/html,application/xhtml+xml' },
      });
      const head = html.split(/<\/head>/i)[0] ?? html;
      return parseOg(head, url);
    } catch {
      return { image: null, title: null, siteName: null, ok: false };
    }
  });
}
