import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../config.js';
import type { LlmEnricher } from '../pipeline/llm.js';
import type { Pipeline } from '../pipeline/index.js';
import type { SourceScheduler } from '../sources/scheduler.js';

function authorised(req: FastifyRequest, reply: FastifyReply): boolean {
  if (!env.adminToken) return true;
  const q = (req.query as Record<string, string | undefined>).token;
  if (q === env.adminToken || req.headers['x-admin-token'] === env.adminToken) return true;
  void reply.code(401).send({ error: 'admin token required' });
  return false;
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function ago(iso: string | null): string {
  if (!iso) return '—';
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 0) return `in ${Math.round(-s / 60)}m`;
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

export function adminRoutes(app: FastifyInstance, scheduler: SourceScheduler, pipeline: Pipeline, llm: LlmEnricher) {
  app.get('/admin/sources.json', async (req, reply) => {
    if (!authorised(req, reply)) return;
    return { sources: scheduler.views(), pipeline: pipeline.stats, llm: { enabled: llm.enabled, ...llm.stats } };
  });

  app.post<{ Params: { id: string } }>('/admin/sources/:id/fetch', async (req, reply) => {
    if (!authorised(req, reply)) return;
    return { ok: scheduler.fetchNow(req.params.id) };
  });

  app.get('/admin/sources', async (req, reply) => {
    if (!authorised(req, reply)) return;
    const views = scheduler.views();
    const counts = views.reduce<Record<string, number>>((m, v) => ((m[v.status] = (m[v.status] ?? 0) + 1), m), {});
    const rows = views
      .sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name))
      .map(
        (v) => `<tr class="${v.status}">
  <td><span class="dot"></span>${esc(v.status.toUpperCase())}</td>
  <td class="mono">${esc(v.type.toUpperCase())}</td>
  <td>${esc(v.name)}<div class="id mono">${esc(v.id)}</div></td>
  <td class="mono">${ago(v.lastFetchAt)}</td>
  <td class="mono">${ago(v.lastSuccessAt)}</td>
  <td class="mono num">${v.itemsLastFetch}</td>
  <td class="mono num">${v.itemsTotal}</td>
  <td class="mono num">${v.consecutiveFailures}</td>
  <td class="mono">${ago(v.nextFetchAt)}</td>
  <td class="err">${esc(v.lastError ?? '')}</td>
</tr>`,
      )
      .join('\n');
    const p = pipeline.stats;
    reply.type('text/html').send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sources · Global Wire</title><meta http-equiv="refresh" content="20">
<style>
:root{--bg:#0A0D12;--panel:#11161D;--line:#1F2731;--fg:#E6E9EE;--mut:#8A94A3;--amber:#F2A93B}
body{margin:0;background:var(--bg);color:var(--fg);font:13px/1.45 Inter,system-ui,sans-serif;padding:24px}
h1{font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:var(--mut);font-weight:600;margin:0 0 16px}
.mono{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:12px}
.sum{display:flex;gap:18px;flex-wrap:wrap;margin-bottom:16px;color:var(--mut)} .sum b{color:var(--fg)}
table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--line)}
th{text-align:left;font-weight:600;font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--mut);padding:8px 10px;border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--panel)}
td{padding:7px 10px;border-bottom:1px solid var(--line);vertical-align:top} .num{text-align:right}
.id{color:var(--mut);font-size:10.5px}.err{color:#C98C84;max-width:380px;font-size:12px}
.dot{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:7px;background:var(--mut)}
.ok .dot{background:#6E9C7A}.degraded .dot{background:var(--amber)}.failing .dot,.dead .dot{background:#B5655B}.dead td{opacity:.75}
.disabled{opacity:.45}
</style></head><body>
<h1>Global Wire · Source health</h1>
<div class="sum mono">${Object.entries(counts).map(([k, v]) => `<span>${esc(k.toUpperCase())} <b>${v}</b></span>`).join('')}
<span>ITEMS RECEIVED <b>${p.received}</b></span><span>PROCESSED <b>${p.processed}</b></span><span>GEOLOCATED <b>${p.geolocated}</b></span>
<span>GEO ${esc(JSON.stringify(p.geoByMethod))}</span><span>LLM <b>${llm.enabled ? `${llm.stats.calls} calls` : 'off'}</b></span><span>QUEUE <b>${p.queue}</b></span></div>
<table><thead><tr><th>Status</th><th>Type</th><th>Source</th><th>Last fetch</th><th>Last OK</th><th>Last</th><th>Total</th><th>Fails</th><th>Next</th><th>Error</th></tr></thead>
<tbody>${rows}</tbody></table></body></html>`);
  });
}
