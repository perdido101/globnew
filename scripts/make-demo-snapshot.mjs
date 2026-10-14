#!/usr/bin/env node
// Record a demo snapshot from a running server (default http://localhost:8787) for the static
// GitHub Pages build: `node scripts/make-demo-snapshot.mjs [serverUrl]`.
// Stores only what the live app shows (headline, ≤200-char snippet, outlet, link, location, scores).
// Thumbnails are left out: the demo is public static hosting, and we don't redistribute publishers' images.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = process.argv[2] ?? 'http://localhost:8787';
const out = path.join(root, 'apps/web/public/demo/snapshot.json');

const now = Date.now();
const byId = new Map();
for (let h = 0; h < 24 * 6; h++) {
  const to = new Date(now - h * 600_000);
  const from = new Date(to.getTime() - 600_000);
  const res = await fetch(`${base}/api/clusters?from=${from.toISOString()}&to=${to.toISOString()}&limit=300`);
  if (!res.ok) throw new Error(`${res.status} from ${base}`);
  for (const c of await res.json()) byId.set(c.id, c);
}
const clusters = [...byId.values()]
  .sort((a, b) => b.importance - a.importance)
  .slice(0, 900)
  .map((c) => ({
    ...c,
    thumb: null,
    snippet: (c.snippet ?? '').slice(0, 200),
    sources: c.sources.slice(0, 8),
    releasedAt: undefined,
    ttlMs: undefined,
  }));
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ takenAt: new Date(now).toISOString(), clusters }));
console.log(`wrote ${clusters.length} clusters (${(fs.statSync(out).size / 1e6).toFixed(2)} MB) → ${path.relative(root, out)}`);
