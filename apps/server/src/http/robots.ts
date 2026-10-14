import { config } from '../config.js';

interface RobotsRules {
  disallow: string[];
  allow: string[];
  fetchedAt: number;
}

const cache = new Map<string, RobotsRules>();
const inflight = new Map<string, Promise<RobotsRules>>();
const TTL = 6 * 3600_000;

/** Minimal robots.txt support: applies the group for our UA token or `*`. */
export function parseRobots(txt: string, agentToken: string): Omit<RobotsRules, 'fetchedAt'> {
  const groups: { agents: string[]; allow: string[]; disallow: string[] }[] = [];
  let cur: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const rawLine of txt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, '').trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const val = m[2]!.trim();
    if (key === 'user-agent') {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], allow: [], disallow: [] };
        groups.push(cur);
      }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!cur) continue;
    if (key === 'disallow' && val) cur.disallow.push(val);
    if (key === 'allow' && val) cur.allow.push(val);
  }
  const token = agentToken.toLowerCase();
  const specific = groups.find((g) => g.agents.some((a) => a !== '*' && token.includes(a)));
  const star = groups.find((g) => g.agents.includes('*'));
  const g = specific ?? star;
  return { disallow: g?.disallow ?? [], allow: g?.allow ?? [] };
}

function matches(pattern: string, path: string): number {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const re = new RegExp('^' + body.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + (anchored ? '$' : ''));
  return re.test(path) ? pattern.length : -1;
}

export function robotsAllows(rules: Omit<RobotsRules, 'fetchedAt'>, path: string): boolean {
  let best = -1;
  let allowed = true;
  for (const p of rules.disallow) {
    const l = matches(p, path);
    if (l > best) {
      best = l;
      allowed = false;
    }
  }
  for (const p of rules.allow) {
    const l = matches(p, path);
    if (l >= best && l >= 0) {
      best = l;
      allowed = true;
    }
  }
  return allowed;
}

async function loadRules(origin: string): Promise<RobotsRules> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(origin + '/robots.txt', { signal: ctrl.signal, headers: { 'user-agent': config.ingest.userAgent } });
    if (!res.ok) return { disallow: [], allow: [], fetchedAt: Date.now() };
    const txt = (await res.text()).slice(0, 500_000);
    return { ...parseRobots(txt, 'GlobalWire'), fetchedAt: Date.now() };
  } catch {
    // Unreachable robots.txt: treat as allow (common convention), retry later.
    return { disallow: [], allow: [], fetchedAt: Date.now() - TTL + 600_000 };
  } finally {
    clearTimeout(t);
  }
}

export async function isAllowedByRobots(url: string): Promise<boolean> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const origin = u.origin;
  let rules = cache.get(origin);
  if (!rules || Date.now() - rules.fetchedAt > TTL) {
    let p = inflight.get(origin);
    if (!p) {
      p = loadRules(origin).finally(() => inflight.delete(origin));
      inflight.set(origin, p);
    }
    rules = await p;
    cache.set(origin, rules);
  }
  return robotsAllows(rules, u.pathname + u.search);
}
