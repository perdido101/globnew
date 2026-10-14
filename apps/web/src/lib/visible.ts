import type { ClusterView } from '@gw/shared';
import { inFocus, passesClient, useStore } from '../store/useStore';

export interface VisibleSet {
  /** Geolocated clusters drawn as markers. */
  markers: ClusterView[];
  /** Subset that gets a floating card (newest releases, pins first). */
  cards: ClusterView[];
  /** Released items without a location. */
  globalLane: ClusterView[];
  dimmed: Set<string>;
}

type S = ReturnType<typeof useStore.getState>;

export function computeVisible(s: S, maxCards: number): VisibleSet {
  const now = s.now;
  const pool: ClusterView[] = s.replay
    ? s.replay.clusters
    : [...Object.values(s.clusters), ...Object.values(s.settings.pins).filter((p) => !s.clusters[p.id])];
  const shown = s.replay ? pool : pool.filter((c) => passesClient(c, s.settings, now));
  const dimmed = new Set<string>();
  for (const c of shown) if (!inFocus(c, s.settings)) dimmed.add(c.id);
  const markers = shown.filter((c) => c.geo);
  const relTime = (c: ClusterView) => Date.parse(c.releasedAt ?? c.firstSeenAt);
  const pinned = markers.filter((c) => s.settings.pins[c.id] && !dimmed.has(c.id));
  const rest = markers
    .filter((c) => !s.settings.pins[c.id] && !dimmed.has(c.id))
    .sort((a, b) => (s.replay ? b.importance - a.importance : relTime(b) - relTime(a)));
  const cards = [...pinned, ...rest].slice(0, Math.max(maxCards, pinned.length));
  const globalLane = shown.filter((c) => !c.geo).sort((a, b) => relTime(b) - relTime(a));
  return { markers, cards, globalLane, dimmed };
}
