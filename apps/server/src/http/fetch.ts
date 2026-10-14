import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';
import { config } from '../config.js';
import { isAllowedByRobots } from './robots.js';

// Respect HTTP(S)_PROXY / NO_PROXY when present; behaves like a normal agent otherwise.
setGlobalDispatcher(new EnvHttpProxyAgent());

export class HttpError extends Error {
  constructor(
    public status: number,
    public url: string,
    public retryAfterSec?: number,
  ) {
    super(`HTTP ${status} for ${url}`);
  }
}

export interface FetchOpts {
  timeoutMs?: number;
  headers?: Record<string, string>;
  checkRobots?: boolean;
  method?: string;
  body?: string;
  maxBytes?: number;
}

export async function httpFetch(url: string, opts: FetchOpts = {}): Promise<Response> {
  if ((opts.checkRobots ?? true) && config.ingest.respectRobotsTxt) {
    if (!(await isAllowedByRobots(url))) throw new Error(`Disallowed by robots.txt: ${url}`);
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? config.ingest.requestTimeoutMs);
  try {
    const res = await fetch(url, {
      method: opts.method ?? 'GET',
      body: opts.body,
      redirect: 'follow',
      signal: ctrl.signal,
      headers: {
        'user-agent': config.ingest.userAgent,
        accept: '*/*',
        'accept-language': 'en;q=0.9,*;q=0.5',
        ...opts.headers,
      },
    });
    if (!res.ok) {
      const ra = Number(res.headers.get('retry-after'));
      // Drain so the socket is released.
      await res.body?.cancel().catch(() => {});
      throw new HttpError(res.status, url, Number.isFinite(ra) && ra > 0 ? ra : undefined);
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchText(url: string, opts: FetchOpts = {}): Promise<string> {
  const res = await httpFetch(url, opts);
  if (!opts.maxBytes) return res.text();
  return readLimited(res, opts.maxBytes);
}

async function readLimited(res: Response, maxBytes: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  await reader.cancel().catch(() => {});
  return Buffer.concat(chunks).toString('utf8');
}

export async function fetchJson<T>(url: string, opts: FetchOpts = {}): Promise<T> {
  const res = await httpFetch(url, { ...opts, headers: { accept: 'application/json', ...opts.headers } });
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Invalid JSON from ${url}: ${text.slice(0, 120)}`);
  }
}
