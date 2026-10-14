import { config, env } from '../config.js';
import { fetchText, httpFetch } from '../http/fetch.js';
import { decodeEntities } from '../util/text.js';
import { parseFeed } from './rss.js';
import { log } from '../log.js';
import type { SourceDef } from '../sources/config.js';
import type { Ingester, RawItem } from './types.js';

interface RedditPost {
  id: string;
  title: string;
  permalink: string;
  url: string;
  url_overridden_by_dest?: string;
  is_self: boolean;
  selftext?: string;
  created_utc: number;
  score: number;
  num_comments: number;
  author: string;
  subreddit: string;
  domain: string;
  over_18: boolean;
  stickied: boolean;
  thumbnail?: string;
  preview?: { images?: { source?: { url: string } }[] };
}

interface Listing {
  data: { children: { data: RedditPost }[] };
}

let token: { value: string; expiresAt: number } | null = null;
let warnedNoCreds = false;

/**
 * Degraded mode without OAuth credentials: Reddit blocks unauthenticated JSON, but the public
 * `rising` RSS feed works. It carries no scores, so items get a nominal velocity at the threshold
 * ("rising" already means fast-growing). Configure REDDIT_CLIENT_ID/SECRET for real velocity ranking.
 */
/** Unauthenticated Reddit requests are rate-limited hard; space them out. */
let gate: Promise<void> = Promise.resolve();
function spaced<T>(fn: () => Promise<T>, gapMs = 7000): Promise<T> {
  const run = gate.then(fn);
  const wait = () => new Promise<void>((r) => setTimeout(r, gapMs));
  gate = run.then(wait, wait);
  return run;
}

async function rssFallback(source: SourceDef): Promise<RawItem[]> {
  const sub = source.handle!;
  if (!warnedNoCreds) {
    warnedNoCreds = true;
    log.warn('REDDIT_CLIENT_ID/SECRET not set — using public rising RSS (no upvote velocity; degraded)');
  }
  const xml = await spaced(() =>
    fetchText(`https://www.reddit.com/r/${encodeURIComponent(sub)}/rising/.rss?limit=25`, {
      checkRobots: false,
      headers: { 'user-agent': userAgent() },
    }),
  );
  const maxAgeMs = config.reddit.maxPostAgeHours * 3600_000;
  const minVelocity = source.minVelocity ?? config.reddit.minVelocity;
  const out: RawItem[] = [];
  for (const e of parseFeed(xml)) {
    if (e.publishedAt && Date.now() - e.publishedAt.getTime() > maxAgeMs) continue;
    const html = e.summary ?? '';
    const ext = /<a href="(https?:\/\/(?!www\.reddit\.com|old\.reddit\.com|i\.redd\.it|v\.redd\.it)[^"]+)">\[link\]<\/a>/.exec(e.rawHtml ?? '')?.[1];
    const linkUrl = ext ? decodeEntities(ext) : null;
    out.push({
      url: linkUrl ?? e.url,
      title: e.title,
      summary: linkUrl ? `Via r/${sub}` : html.replace(/\s*submitted by[\s\S]*$/, ''),
      imageUrl: e.imageUrl,
      publishedAt: e.publishedAt,
      author: e.author,
      outlet: linkUrl ? new URL(linkUrl).hostname.replace(/^www\./, '') : `r/${sub}`,
      subreddit: sub,
      engagement: { velocity: minVelocity },
    });
  }
  return out;
}

async function getToken(): Promise<string | null> {
  if (!env.redditClientId || !env.redditClientSecret) return null;
  if (token && token.expiresAt > Date.now() + 60_000) return token.value;
  const basic = Buffer.from(`${env.redditClientId}:${env.redditClientSecret}`).toString('base64');
  const res = await httpFetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    body: 'grant_type=client_credentials',
    checkRobots: false,
    headers: {
      authorization: `Basic ${basic}`,
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': userAgent(),
    },
  });
  const json = (await res.json()) as { access_token: string; expires_in: number };
  token = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return token.value;
}

function userAgent(): string {
  return env.redditUserAgent || `web:global-wire:0.1 (news globe)`;
}

/** Reddit's documented rate-limit headers; we stop early when we are close to the limit. */
let rateRemaining = 100;
let rateResetAt = 0;

async function listing(sub: string, kind: string): Promise<RedditPost[]> {
  if (rateRemaining < 5 && Date.now() < rateResetAt) throw new Error('Reddit rate limit nearly exhausted; deferring');
  const tok = await getToken();
  const limit = config.reddit.limit;
  let url: string;
  const headers: Record<string, string> = { 'user-agent': userAgent() };
  if (tok) {
    url = `https://oauth.reddit.com/r/${encodeURIComponent(sub)}/${kind}?limit=${limit}&raw_json=1`;
    headers.authorization = `Bearer ${tok}`;
  } else {
    throw new Error('no OAuth token');
  }
  const res = await httpFetch(url, { headers, checkRobots: false });
  const rem = Number(res.headers.get('x-ratelimit-remaining'));
  const reset = Number(res.headers.get('x-ratelimit-reset'));
  if (Number.isFinite(rem)) rateRemaining = rem;
  if (Number.isFinite(reset)) rateResetAt = Date.now() + reset * 1000;
  const json = (await res.json()) as Listing;
  return json.data.children.map((c) => c.data);
}

export function redditVelocity(score: number, createdUtcSec: number, now = Date.now()): number {
  const minutes = Math.max(5, (now - createdUtcSec * 1000) / 60_000);
  return Math.max(0, score) / minutes;
}

function postImage(p: RedditPost): string | null {
  const src = p.preview?.images?.[0]?.source?.url;
  if (src) return src;
  if (p.thumbnail && /^https?:/.test(p.thumbnail)) return p.thumbnail;
  return null;
}

export const redditIngester: Ingester = {
  async fetch(source: SourceDef): Promise<RawItem[]> {
    if (!env.redditClientId || !env.redditClientSecret) return rssFallback(source);
    const sub = source.handle!;
    const minVelocity = source.minVelocity ?? config.reddit.minVelocity;
    const maxAgeMs = config.reddit.maxPostAgeHours * 3600_000;
    const seen = new Map<string, RedditPost>();
    for (const kind of config.reddit.listings) {
      for (const p of await listing(sub, kind)) seen.set(p.id, p);
    }
    const out: RawItem[] = [];
    for (const p of seen.values()) {
      if (p.over_18 || p.stickied) continue;
      if (Date.now() - p.created_utc * 1000 > maxAgeMs) continue;
      const velocity = redditVelocity(p.score, p.created_utc);
      if (velocity < minVelocity) continue;
      const linksOut = !p.is_self && p.url_overridden_by_dest && !/reddit\.com|redd\.it/.test(p.domain);
      out.push({
        // A post linking to an article is stored under the article URL, so it clusters with outlet coverage.
        url: linksOut ? p.url_overridden_by_dest! : `https://www.reddit.com${p.permalink}`,
        title: p.title,
        summary: p.is_self ? p.selftext ?? '' : `Via r/${p.subreddit} · ${p.domain}`,
        imageUrl: postImage(p),
        publishedAt: new Date(p.created_utc * 1000),
        author: `u/${p.author}`,
        outlet: linksOut ? p.domain.replace(/^www\./, '') : `r/${p.subreddit}`,
        subreddit: p.subreddit,
        engagement: { score: p.score, comments: p.num_comments, velocity: Math.round(velocity * 100) / 100 },
      });
    }
    return out;
  },
};
