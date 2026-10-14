import type { ClusterView, FlowConfigView, FlowFilters, StatsView } from '@gw/shared';
import { inRegion, regionByKey } from '@gw/shared';
import { create } from 'zustand';
import { load, save } from '../lib/persist';
import { DEFAULT_SETTINGS, SETTINGS_KEY, type Settings } from './settings';

export type ConnStatus = 'connecting' | 'live' | 'reconnecting' | 'offline';

export interface ReplayState {
  at: number;
  windowMs: number;
  clusters: ClusterView[];
  loading: boolean;
}

export interface ContextMenuState {
  x: number;
  y: number;
  cluster: ClusterView;
}

interface State {
  settings: Settings;
  /** Released clusters currently alive in this client, by id. */
  clusters: Record<string, ClusterView>;
  /** Release order (oldest → newest). */
  order: string[];
  /** Live feed: every release (newest first), capped. */
  feed: string[];
  /** Views for feed entries (outlives decay from the globe). */
  archive: Record<string, ClusterView>;
  /** Recently arrived (for ring pulses): id → arrival ms. */
  arrivals: Record<string, number>;
  status: ConnStatus;
  sessionId: string | null;
  stats: StatsView | null;
  flowConfig: FlowConfigView;
  selectedId: string | null;
  /** Cluster shown in the drawer (may come from search/replay, not only live state). */
  detail: ClusterView | null;
  hoverId: string | null;
  replay: ReplayState | null;
  menu: ContextMenuState | null;
  shortcutsOpen: boolean;
  searchOpen: boolean;
  now: number;

  init: (clusters: ClusterView[], cfg: FlowConfigView, stats: StatsView, sessionId: string) => void;
  release: (c: ClusterView) => void;
  update: (c: ClusterView) => void;
  setStats: (s: StatsView) => void;
  setStatus: (s: ConnStatus) => void;
  tick: () => void;
  patchSettings: (p: Partial<Settings>) => void;
  togglePin: (c: ClusterView) => void;
  select: (c: ClusterView | null) => void;
  setHover: (id: string | null) => void;
  setReplay: (r: ReplayState | null) => void;
  openMenu: (m: ContextMenuState | null) => void;
  setShortcuts: (open: boolean) => void;
  setSearchOpen: (open: boolean) => void;
}

const FEED_CAP = 400;

export const useStore = create<State>((set, get) => ({
  settings: load<Settings>(SETTINGS_KEY, DEFAULT_SETTINGS),
  clusters: {},
  order: [],
  feed: [],
  archive: {},
  arrivals: {},
  status: 'connecting',
  sessionId: null,
  stats: null,
  flowConfig: { cadenceMs: 4500, maxVisibleCards: 12, dotTtlMinMs: 1_200_000, dotTtlMaxMs: 10_800_000, cardHoldMs: 45_000 },
  selectedId: null,
  detail: null,
  hoverId: null,
  replay: null,
  menu: null,
  shortcutsOpen: false,
  searchOpen: false,
  now: Date.now(),

  init: (clusters, cfg, stats, sessionId) =>
    set((s) => {
      const map: Record<string, ClusterView> = { ...s.clusters };
      for (const c of clusters) map[c.id] = c;
      const order = Object.values(map)
        .sort((a, b) => Date.parse(a.releasedAt ?? a.firstSeenAt) - Date.parse(b.releasedAt ?? b.firstSeenAt))
        .map((c) => c.id);
      const feed = [...new Set([...[...order].reverse(), ...s.feed])].slice(0, FEED_CAP);
      const archive: Record<string, ClusterView> = {};
      for (const id of feed) archive[id] = map[id] ?? s.archive[id]!;
      return { clusters: map, order, feed, archive, flowConfig: cfg, stats, sessionId, status: 'live' };
    }),

  release: (c) =>
    set((s) => {
      if (s.clusters[c.id]) return { clusters: { ...s.clusters, [c.id]: c }, archive: { ...s.archive, [c.id]: c } };
      const feed = [c.id, ...s.feed.filter((x) => x !== c.id)];
      const archive = { ...s.archive, [c.id]: c };
      for (const id of feed.splice(FEED_CAP)) delete archive[id];
      return {
        clusters: { ...s.clusters, [c.id]: c },
        order: [...s.order, c.id],
        feed,
        archive,
        arrivals: { ...s.arrivals, [c.id]: Date.now() },
      };
    }),

  update: (c) =>
    set((s) => {
      const pins = s.settings.pins[c.id] ? { ...s.settings.pins, [c.id]: c } : s.settings.pins;
      const settings = pins === s.settings.pins ? s.settings : { ...s.settings, pins };
      if (settings !== s.settings) save(SETTINGS_KEY, settings);
      return {
        clusters: s.clusters[c.id] ? { ...s.clusters, [c.id]: { ...s.clusters[c.id], ...c } } : s.clusters,
        archive: s.archive[c.id] ? { ...s.archive, [c.id]: { ...s.archive[c.id], ...c } } : s.archive,
        detail: s.detail?.id === c.id ? { ...s.detail, ...c } : s.detail,
        settings,
      };
    }),

  setStats: (stats) => set({ stats }),
  setStatus: (status) => set({ status }),

  /** Decay: drop clusters past their TTL (pins and the selected story survive). */
  tick: () =>
    set((s) => {
      const now = Date.now();
      let changed = false;
      const clusters = { ...s.clusters };
      for (const [id, c] of Object.entries(clusters)) {
        if (s.settings.pins[id] || id === s.selectedId) continue;
        const rel = Date.parse(c.releasedAt ?? c.firstSeenAt);
        if (now - rel > (c.ttlMs ?? s.flowConfig.dotTtlMinMs)) {
          delete clusters[id];
          changed = true;
        }
      }
      let arrivals = s.arrivals;
      const stale = Object.entries(arrivals).filter(([, t]) => now - t > 4000);
      if (stale.length) {
        arrivals = { ...arrivals };
        for (const [id] of stale) delete arrivals[id];
      }
      if (!changed) return arrivals === s.arrivals ? { now } : { now, arrivals };
      return { now, clusters, arrivals, order: s.order.filter((id) => clusters[id]) };
    }),

  patchSettings: (p) =>
    set((s) => {
      const settings = { ...s.settings, ...p };
      save(SETTINGS_KEY, settings);
      return { settings };
    }),

  togglePin: (c) =>
    set((s) => {
      const pins = { ...s.settings.pins };
      if (pins[c.id]) delete pins[c.id];
      else pins[c.id] = c;
      const settings = { ...s.settings, pins };
      save(SETTINGS_KEY, settings);
      return { settings };
    }),

  select: (c) => set({ selectedId: c?.id ?? null, detail: c }),
  setHover: (hoverId) => (get().hoverId === hoverId ? undefined : set({ hoverId })),
  setReplay: (replay) => set({ replay }),
  openMenu: (menu) => set({ menu }),
  setShortcuts: (shortcutsOpen) => set({ shortcutsOpen }),
  setSearchOpen: (searchOpen) => set({ searchOpen }),
}));

/** Filters the server applies to this session's release queue. */
export function toFlowFilters(s: Settings): FlowFilters {
  return {
    sourceTypes: s.sourceTypes,
    categories: s.categories,
    mutedOutlets: s.mutedOutlets,
    mutedRegions: s.mutedRegions,
    minImportance: s.minImportance,
    focusRegion: s.focusRegion,
    includeGlobal: s.includeGlobal,
    paused: s.paused,
    cadenceMs: Math.round(s.cadenceSec * 1000),
  };
}

/** Client-side visibility (instant feedback for clusters already released before a filter changed). */
export function passesClient(c: ClusterView, s: Settings, now: number): boolean {
  if (s.pins[c.id]) return true;
  if (!c.sources.some((x) => s.sourceTypes.includes(x.sourceType)) && !s.sourceTypes.includes(c.sourceType)) return false;
  if (!s.categories.includes(c.category)) return false;
  if (c.importance < s.minImportance) return false;
  if (c.sources.length && c.sources.every((x) => s.mutedOutlets.includes(x.outlet))) return false;
  if (s.mutedOutlets.includes(c.outlet) && c.sourceCount <= 1) return false;
  if (now - Date.parse(c.firstSeenAt) > s.timeWindowH * 3600_000) return false;
  if (c.geo) {
    for (const key of s.mutedRegions) {
      const r = regionByKey(key);
      if (r && inRegion(r, c.geo.lat, c.geo.lon)) return false;
    }
  } else if (!s.includeGlobal) return false;
  return true;
}

/** In focus mode, items outside the region are dimmed rather than hidden. */
export function inFocus(c: ClusterView, s: Settings): boolean {
  if (!s.focusRegion) return true;
  const r = regionByKey(s.focusRegion);
  return !!(r && c.geo && inRegion(r, c.geo.lat, c.geo.lon));
}

if (import.meta.env.DEV) (window as unknown as { __gw: typeof useStore }).__gw = useStore;
