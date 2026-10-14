import fs from 'node:fs';
import path from 'node:path';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import type { StatsView } from '@gw/shared';
import { config, env } from './config.js';
import { sql } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { Repo } from './db/repo.js';
import { FlowEngine } from './flow/engine.js';
import { Store } from './flow/store.js';
import { downloadGeoData, geoDataDir, geoDataPresent } from './geo/download.js';
import { getGazetteer, type Gazetteer } from './geo/gazetteer.js';
import { log } from './log.js';
import { REPO_ROOT, fromServerRoot } from './paths.js';
import { Pipeline } from './pipeline/index.js';
import { LlmEnricher } from './pipeline/llm.js';
import { adminRoutes } from './routes/admin.js';
import { apiRoutes } from './routes/api.js';
import { imgRoutes } from './routes/img.js';
import { streamRoutes } from './routes/stream.js';
import { loadSources, watchSources } from './sources/config.js';
import { SourceScheduler } from './sources/scheduler.js';

async function loadGazetteer(): Promise<Gazetteer | null> {
  try {
    if (!geoDataPresent()) {
      log.info('GeoNames data missing — downloading (one-off, ~3 MB)…');
      await downloadGeoData();
    }
    const g = getGazetteer(geoDataDir());
    log.info({ countries: g.countryCount }, 'gazetteer loaded');
    return g;
  } catch (err) {
    log.error({ err: (err as Error).message }, 'gazetteer unavailable — geolocation falls back to GDELT/LLM only');
    return null;
  }
}

async function main() {
  await runMigrations();
  log.info('database migrations applied');

  const gazetteer = await loadGazetteer();
  const store = new Store();
  const repo = new Repo();
  const llm = new LlmEnricher();
  const pipeline = new Pipeline(store, repo, llm, gazetteer);

  // Warm the store from Postgres so restarts keep the globe populated.
  const since = new Date(Date.now() - config.server.memoryWindowHours * 3600_000);
  const restored = await repo.recentItems(since, config.server.maxItemsInMemory);
  for (const it of restored) store.addItem(it, { silent: true });
  log.info({ items: restored.length, clusters: store.clusters.size }, 'restored state from database');

  const scheduler = new SourceScheduler({
    onItems: (items) => pipeline.ingest(items),
    loadHealth: () => repo.loadHealth(),
    saveHealth: (id, h) => repo.saveHealth(id, h),
  });

  const statsFn = (): StatsView => {
    const hourAgo = Date.now() - 3600_000;
    let itemsLastHour = 0;
    for (const it of store.items.values()) if (Date.parse(it.firstSeenAt) > hourAgo) itemsLastHour++;
    let clustersLastHour = 0;
    for (const c of store.clusters.values()) if (c.firstSeenAt > hourAgo) clustersLastHour++;
    const views = scheduler.views().filter((v) => v.enabled);
    return {
      itemsLastHour,
      clustersLastHour,
      totalClusters: store.clusters.size,
      queued: pipeline.stats.queue,
      sourcesOk: views.filter((v) => v.status === 'ok').length,
      sourcesTotal: views.length,
      llmEnabled: llm.enabled,
      serverTime: new Date().toISOString(),
    };
  };
  const flow = new FlowEngine(store, statsFn);

  const app = Fastify({ logger: false, bodyLimit: 64 * 1024 });
  await app.register(cors, { origin: true });
  apiRoutes(app, store, scheduler);
  streamRoutes(app, flow);
  imgRoutes(app);
  adminRoutes(app, scheduler, pipeline, llm);

  // Production: serve the built web app.
  const webDist = path.join(REPO_ROOT, 'apps/web/dist');
  if (fs.existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api') && !req.url.startsWith('/admin')) return reply.sendFile('index.html');
      return reply.code(404).send({ error: 'not found' });
    });
  }

  await app.listen({ port: env.port, host: '0.0.0.0' });
  log.info(`Global Wire server on http://localhost:${env.port}  (admin: /admin/sources)`);

  const sources = loadSources();
  log.info({ total: sources.length, enabled: sources.filter((s) => s.enabled).length }, 'sources loaded');
  if (env.disableIngest) log.warn('DISABLE_INGEST=1 — not polling sources');
  else await scheduler.start(sources);
  const unwatch = watchSources((next) => scheduler.setSources(next));

  // Housekeeping: memory window + image cache.
  const imgDir = fromServerRoot(config.enrich.imageCacheDir);
  const housekeeping = setInterval(() => {
    const removed = store.evict();
    if (removed) log.debug({ removed }, 'evicted old clusters');
    fs.promises
      .readdir(imgDir)
      .then((files) =>
        Promise.all(
          files.map(async (f) => {
            const p = path.join(imgDir, f);
            const st = await fs.promises.stat(p);
            if (Date.now() - st.mtimeMs > 3 * 86400_000) await fs.promises.unlink(p);
          }),
        ),
      )
      .catch(() => {});
  }, 10 * 60_000);

  const shutdown = async (sig: string) => {
    log.info(`${sig} — shutting down`);
    clearInterval(housekeeping);
    unwatch();
    scheduler.stop();
    flow.stop();
    await Promise.race([app.close().catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
    await repo.close().catch(() => {});
    await sql.end({ timeout: 2 }).catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  log.fatal({ err: err instanceof Error ? err.stack : err }, 'fatal start-up error');
  process.exit(1);
});
