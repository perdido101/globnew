import fs from 'node:fs';
import YAML from 'yaml';
import { z } from 'zod';
import type { SourceType } from '@gw/shared';
import { SOURCES_PATH } from '../config.js';
import { log } from '../log.js';

const SourceSchema = z.object({
  id: z.string().optional(),
  type: z.enum(['news', 'reddit', 'telegram', 'gdelt']),
  name: z.string(),
  url: z.string().optional(),
  handle: z.string().optional(),
  query: z.string().optional(),
  region: z.string().optional(),
  country: z.string().optional(),
  lang: z.string().optional(),
  weight: z.number().min(0).max(1).default(0.7),
  enabled: z.boolean().default(true),
  intervalSec: z.number().positive().optional(),
  minVelocity: z.number().nonnegative().optional(),
  /** Telegram: mark as verified outlet channel (defaults to false → UNVERIFIED tag). */
  verified: z.boolean().optional(),
});

const FileSchema = z.object({ sources: z.array(SourceSchema) });

export interface SourceDef {
  id: string;
  type: SourceType;
  name: string;
  url?: string;
  handle?: string;
  query?: string;
  region?: string;
  country?: string;
  lang?: string;
  weight: number;
  enabled: boolean;
  intervalSec?: number;
  minVelocity?: number;
  verified?: boolean;
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function parseSources(text: string): SourceDef[] {
  const parsed = FileSchema.parse(YAML.parse(text));
  const seen = new Set<string>();
  const out: SourceDef[] = [];
  for (const s of parsed.sources) {
    if (s.type === 'news' && !s.url) throw new Error(`news source "${s.name}" needs a url`);
    if ((s.type === 'reddit' || s.type === 'telegram') && !s.handle) throw new Error(`${s.type} source "${s.name}" needs a handle`);
    let id = s.id ?? `${s.type}-${slug(s.handle ?? s.name)}`;
    while (seen.has(id)) id += '-x';
    seen.add(id);
    out.push({ ...s, id });
  }
  return out;
}

export function loadSources(): SourceDef[] {
  return parseSources(fs.readFileSync(SOURCES_PATH, 'utf8'));
}

/** Watches sources.yaml and calls `onChange` with the new list (invalid edits are logged and ignored). */
export function watchSources(onChange: (sources: SourceDef[]) => void): () => void {
  let timer: NodeJS.Timeout | null = null;
  const watcher = fs.watch(SOURCES_PATH, () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        const next = loadSources();
        log.info({ count: next.length }, 'sources.yaml reloaded');
        onChange(next);
      } catch (err) {
        log.error({ err: (err as Error).message }, 'sources.yaml invalid — keeping previous config');
      }
    }, 300);
  });
  return () => watcher.close();
}
