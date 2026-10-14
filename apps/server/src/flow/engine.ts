import crypto from 'node:crypto';
import type { ClusterView, FlowConfigView, FlowFilters, StatsView, StreamEvent } from '@gw/shared';
import { inRegion, regionByKey } from '@gw/shared';
import { config } from '../config.js';
import type { ClusterChange, ClusterState, Store } from './store.js';

interface Session {
  id: string;
  filters: FlowFilters;
  /** clusterId → release time */
  released: Map<string, number>;
  send: ((ev: StreamEvent) => void) | null;
  timer: NodeJS.Timeout | null;
  lastJump: number;
  lastRelease: number;
  disconnectedAt: number | null;
  /** last sourceCount sent per cluster (to throttle update events) */
  sentCounts: Map<string, number>;
}

export function ttlFor(importance: number): number {
  const { dotTtlMinMs, dotTtlMaxMs } = config.flow;
  return Math.round(dotTtlMinMs + ((dotTtlMaxMs - dotTtlMinMs) * Math.max(0, Math.min(100, importance))) / 100);
}

/** Does a cluster pass a session's filters? */
export function passes(c: Pick<ClusterState, "category" | "importance" | "geo">, f: FlowFilters, meta: { sourceTypes: string[]; outlets: string[] }): boolean {
  if (f.sourceTypes && f.sourceTypes.length && !meta.sourceTypes.some((t) => f.sourceTypes!.includes(t as never))) return false;
  if (f.mutedOutlets?.length && meta.outlets.every((o) => f.mutedOutlets!.includes(o))) return false;
  if (f.categories && f.categories.length && !f.categories.includes(c.category)) return false;
  if (f.minImportance && c.importance < f.minImportance) return false;
  const geo = c.geo;
  if (!geo) return f.includeGlobal !== false && !f.focusRegion;
  if (f.focusRegion) {
    const r = regionByKey(f.focusRegion);
    if (r && !inRegion(r, geo.lat, geo.lon)) return false;
  }
  if (f.mutedRegions?.length) {
    for (const key of f.mutedRegions) {
      const r = regionByKey(key);
      if (r && inRegion(r, geo.lat, geo.lon)) return false;
    }
  }
  return true;
}

/**
 * The "flow": every client session has its own release scheduler over the shared cluster pool,
 * so filters/focus/pause shape what is released rather than leaving gaps.
 */
export class FlowEngine {
  private sessions = new Map<string, Session>();
  private statsTimer: NodeJS.Timeout;
  private sweepTimer: NodeJS.Timeout;

  constructor(
    private store: Store,
    private statsFn: () => StatsView,
  ) {
    store.on('change', (ch) => this.onChange(ch));
    this.statsTimer = setInterval(() => this.broadcastStats(), config.flow.statsIntervalMs);
    this.sweepTimer = setInterval(() => this.sweep(), 60_000);
  }

  get sessionCount(): number {
    return [...this.sessions.values()].filter((s) => s.send).length;
  }

  flowConfig(): FlowConfigView {
    const f = config.flow;
    return { cadenceMs: f.cadenceMs, maxVisibleCards: f.maxVisibleCards, dotTtlMinMs: f.dotTtlMinMs, dotTtlMaxMs: f.dotTtlMaxMs, cardHoldMs: f.cardHoldMs };
  }

  private meta(c: ClusterState) {
    const its = this.store.members(c);
    return { sourceTypes: [...new Set(its.map((i) => i.sourceType))], outlets: [...new Set(its.map((i) => i.outlet))] };
  }

  private releasedView(s: Session, c: ClusterState): ClusterView {
    const v = this.store.view(c);
    const at = s.released.get(c.id)!;
    v.releasedAt = new Date(at).toISOString();
    v.ttlMs = ttlFor(c.importance);
    return v;
  }

  /** Clusters eligible for release now in this session, best first. */
  private candidates(s: Session, now = Date.now()): ClusterState[] {
    const maxAge = config.flow.candidateMaxAgeHours * 3600_000;
    const out: ClusterState[] = [];
    for (const c of this.store.clusters.values()) {
      if (s.released.has(c.id) || now - c.firstSeenAt > maxAge) continue;
      if (!passes(c, s.filters, this.meta(c))) continue;
      out.push(c);
    }
    for (const c of out) this.store.recompute(c, now);
    return out.sort((a, b) => b.importance - a.importance);
  }

  connect(sessionId: string | null, filters: FlowFilters, send: (ev: StreamEvent) => void): string {
    let s = sessionId ? this.sessions.get(sessionId) : undefined;
    const now = Date.now();
    if (!s) {
      s = {
        id: sessionId && /^[\w-]{8,64}$/.test(sessionId) ? sessionId : crypto.randomUUID(),
        filters,
        released: new Map(),
        send: null,
        timer: null,
        lastJump: 0,
        lastRelease: 0,
        disconnectedAt: null,
        sentCounts: new Map(),
      };
      this.sessions.set(s.id, s);
      // Seed so the globe is never empty: best recent clusters, staggered into the recent past.
      const seed = this.candidates(s, now).slice(0, config.flow.initialSeed);
      seed.reverse().forEach((c, i) => s!.released.set(c.id, now - (seed.length - i) * config.flow.cadenceMs));
    } else {
      s.filters = filters;
    }
    s.send = send;
    s.disconnectedAt = null;
    const visible: ClusterView[] = [];
    for (const [id, at] of s.released) {
      const c = this.store.clusters.get(id);
      if (!c || now - at > ttlFor(c.importance)) continue;
      const v = this.releasedView(s, c);
      s.sentCounts.set(id, v.sourceCount);
      visible.push(v);
    }
    visible.sort((a, b) => Date.parse(a.releasedAt!) - Date.parse(b.releasedAt!));
    send({ type: 'init', sessionId: s.id, clusters: visible, config: this.flowConfig(), stats: this.statsFn() });
    this.schedule(s);
    return s.id;
  }

  disconnect(sessionId: string): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    s.send = null;
    s.disconnectedAt = Date.now();
    if (s.timer) clearTimeout(s.timer);
    s.timer = null;
  }

  setFilters(sessionId: string, filters: FlowFilters): boolean {
    const s = this.sessions.get(sessionId);
    if (!s) return false;
    s.filters = filters;
    // A focus/filter change should feel responsive: release soon.
    if (s.send) this.schedule(s, 800);
    return true;
  }

  private cadence(s: Session): number {
    return Math.max(1000, s.filters.cadenceMs ?? config.flow.cadenceMs);
  }

  private schedule(s: Session, delay?: number): void {
    if (s.timer) clearTimeout(s.timer);
    const base = this.cadence(s);
    const j = config.flow.jitter;
    const d = delay ?? base * (1 - j + Math.random() * 2 * j);
    s.timer = setTimeout(() => this.tick(s), d);
  }

  private release(s: Session, c: ClusterState, now = Date.now()): void {
    s.released.set(c.id, now);
    s.lastRelease = now;
    const v = this.releasedView(s, c);
    s.sentCounts.set(c.id, v.sourceCount);
    s.send?.({ type: 'release', cluster: v });
  }

  private tick(s: Session): void {
    s.timer = null;
    if (!s.send) return;
    if (!s.filters.paused) {
      const best = this.candidates(s)[0];
      if (best) this.release(s, best);
    }
    this.schedule(s);
  }

  private isJumper(c: ClusterState): boolean {
    const f = config.flow;
    return c.importance >= f.jumpScore || (c.breaking && c.importance >= f.breakingMinScore);
  }

  private onChange({ cluster: c, kind }: ClusterChange): void {
    const now = Date.now();
    for (const s of this.sessions.values()) {
      if (!s.send) continue;
      if (s.released.has(c.id)) {
        // Cluster grew: update the existing card in place (no new card).
        const prev = s.sentCounts.get(c.id) ?? 0;
        if (kind === 'grew' || (kind === 'changed' && c.outletCount !== prev)) {
          const v = this.releasedView(s, c);
          s.sentCounts.set(c.id, v.sourceCount);
          s.send({ type: 'update', cluster: v });
        }
        continue;
      }
      // Breaking / very high scores jump the queue (rate-limited so it never floods).
      if (!s.filters.paused && this.isJumper(c) && now - s.lastJump > config.flow.jumpMinGapMs && now - s.lastRelease > 1200) {
        if (passes(c, s.filters, this.meta(c))) {
          s.lastJump = now;
          this.release(s, c, now);
          this.schedule(s);
        }
      }
    }
  }

  private broadcastStats(): void {
    const stats = this.statsFn();
    for (const s of this.sessions.values()) s.send?.({ type: 'stats', stats });
  }

  private sweep(): void {
    const now = Date.now();
    for (const [id, s] of this.sessions) {
      if (!s.send && s.disconnectedAt && now - s.disconnectedAt > config.flow.sessionTtlMs) {
        this.sessions.delete(id);
        continue;
      }
      for (const [cid, at] of s.released) {
        const c = this.store.clusters.get(cid);
        if (!c || now - at > config.flow.dotTtlMaxMs * 2) {
          s.released.delete(cid);
          s.sentCounts.delete(cid);
        }
      }
    }
  }

  stop(): void {
    clearInterval(this.statsTimer);
    clearInterval(this.sweepTimer);
    for (const s of this.sessions.values()) if (s.timer) clearTimeout(s.timer);
  }
}
