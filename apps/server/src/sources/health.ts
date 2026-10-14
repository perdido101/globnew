import type { SourceHealthView } from '@gw/shared';
import { config } from '../config.js';
import type { SourceDef } from './config.js';

export interface HealthState {
  lastFetchAt: Date | null;
  lastSuccessAt: Date | null;
  lastError: string | null;
  consecutiveFailures: number;
  itemsTotal: number;
  itemsLastFetch: number;
  emptyFetches: number;
  nextFetchAt: Date | null;
  retryAfterSec?: number;
}

export function emptyHealth(): HealthState {
  return {
    lastFetchAt: null,
    lastSuccessAt: null,
    lastError: null,
    consecutiveFailures: 0,
    itemsTotal: 0,
    itemsLastFetch: 0,
    emptyFetches: 0,
    nextFetchAt: null,
  };
}

export function backoffMs(failures: number, retryAfterSec?: number): number {
  const { backoffBaseSec, backoffMaxSec } = config.ingest;
  const exp = Math.min(backoffMaxSec, backoffBaseSec * 2 ** Math.max(0, failures - 1));
  const withRetryAfter = Math.max(exp, retryAfterSec ?? 0);
  // ±20% jitter
  return Math.round(withRetryAfter * 1000 * (0.8 + Math.random() * 0.4));
}

export function statusOf(def: SourceDef, h: HealthState): SourceHealthView['status'] {
  if (!def.enabled) return 'disabled';
  if (!h.lastFetchAt) return 'idle';
  if (h.consecutiveFailures >= config.ingest.deadAfterFailures) return 'dead';
  if (h.consecutiveFailures >= 3) return 'failing';
  if (h.consecutiveFailures > 0) return 'degraded';
  // A feed that answers but never yields items is effectively dead (velocity-gated sources excepted).
  if (h.itemsTotal === 0 && h.emptyFetches >= 3 && (def.type === 'news' || def.type === 'gdelt')) return 'dead';
  return 'ok';
}

export function toView(def: SourceDef, h: HealthState): SourceHealthView {
  return {
    id: def.id,
    name: def.name,
    type: def.type,
    enabled: def.enabled,
    status: statusOf(def, h),
    lastFetchAt: h.lastFetchAt?.toISOString() ?? null,
    lastSuccessAt: h.lastSuccessAt?.toISOString() ?? null,
    lastError: h.lastError,
    consecutiveFailures: h.consecutiveFailures,
    itemsTotal: h.itemsTotal,
    itemsLastFetch: h.itemsLastFetch,
    nextFetchAt: h.nextFetchAt?.toISOString() ?? null,
  };
}
