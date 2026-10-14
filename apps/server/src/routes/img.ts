import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { config, env } from '../config.js';
import { httpFetch } from '../http/fetch.js';
import { fromServerRoot } from '../paths.js';
import { hmac, sha1 } from '../util/hash.js';

const dir = fromServerRoot(config.enrich.imageCacheDir);
fs.mkdirSync(dir, { recursive: true });
const inflight = new Map<string, Promise<Buffer | null>>();

async function makeThumb(url: string, file: string): Promise<Buffer | null> {
  try {
    const res = await httpFetch(url, { checkRobots: false, timeoutMs: 12_000, headers: { accept: 'image/avif,image/webp,image/*;q=0.8' } });
    const len = Number(res.headers.get('content-length') ?? 0);
    if (len > config.enrich.imageMaxBytes) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > config.enrich.imageMaxBytes) return null;
    const out = await sharp(buf, { failOn: 'none', limitInputPixels: 50e6 })
      .rotate()
      .resize(config.enrich.thumbWidth, config.enrich.thumbHeight, { fit: 'cover', position: 'attention' })
      .modulate({ saturation: 0.9 })
      .webp({ quality: config.enrich.thumbQuality })
      .toBuffer();
    await fs.promises.writeFile(file, out);
    return out;
  } catch {
    // Negative cache marker so we don't hammer broken images.
    await fs.promises.writeFile(file + '.err', '').catch(() => {});
    return null;
  }
}

/** Image proxy: clients never hotlink; we fetch once, resize to a webp thumbnail and cache on disk. */
export function imgRoutes(app: FastifyInstance) {
  app.get<{ Params: { sig: string }; Querystring: { u?: string } }>('/img/:sig', async (req, reply) => {
    const url = req.query.u;
    if (!url || hmac(env.imageSecret, url) !== req.params.sig || !/^https?:\/\//.test(url)) return reply.code(403).send();
    const file = path.join(dir, sha1(url) + '.webp');
    let buf: Buffer | null = null;
    if (fs.existsSync(file)) buf = await fs.promises.readFile(file);
    else if (fs.existsSync(file + '.err') && Date.now() - fs.statSync(file + '.err').mtimeMs < 6 * 3600_000) buf = null;
    else {
      let p = inflight.get(file);
      if (!p) {
        p = makeThumb(url, file).finally(() => inflight.delete(file));
        inflight.set(file, p);
      }
      buf = await p;
    }
    if (!buf) return reply.code(404).header('cache-control', 'public, max-age=3600').send();
    return reply.header('content-type', 'image/webp').header('cache-control', 'public, max-age=86400, immutable').send(buf);
  });
}
