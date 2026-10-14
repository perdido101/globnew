import { REGIONS, inRegion } from '@gw/shared';
import { useEffect } from 'react';
import { globeRef } from '../lib/globeRef';
import { useStore } from '../store/useStore';

export const HOME_VIEW = { lat: 28, lng: 18, altitude: 2.3 };

function regionInView(): string | null {
  const g = globeRef.current;
  if (!g) return null;
  const { lat, lng } = g.pointOfView();
  const inside = REGIONS.filter((r) => inRegion(r, lat, lng));
  // Prefer the smallest matching region (Greece inside Europe).
  if (inside.length) return inside.sort((a, b) => area(a) - area(b))[0]!.key;
  let best: { key: string; d: number } | null = null;
  for (const r of REGIONS) {
    const d = (r.view.lat - lat) ** 2 + (((r.view.lng - lng + 540) % 360) - 180) ** 2;
    if (!best || d < best.d) best = { key: r.key, d };
  }
  return best?.key ?? null;
}

function area(r: (typeof REGIONS)[number]): number {
  return r.boxes.reduce((s, [a, b, c, d]) => s + (c - a) * (d - b), 0);
}

export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const s = useStore.getState();
      switch (e.key) {
        case ' ':
          e.preventDefault();
          s.patchSettings({ paused: !s.settings.paused });
          break;
        case 'f':
        case 'F': {
          if (s.settings.focusRegion) s.patchSettings({ focusRegion: null });
          else {
            const key = regionInView();
            if (key) s.patchSettings({ focusRegion: key });
          }
          break;
        }
        case '/':
          e.preventDefault();
          s.setSearchOpen(true);
          break;
        case '[':
          s.patchSettings({ leftOpen: !s.settings.leftOpen });
          break;
        case ']':
          s.patchSettings({ rightOpen: !s.settings.rightOpen });
          break;
        case '?':
          s.setShortcuts(!s.shortcutsOpen);
          break;
        case 'Escape':
          if (s.shortcutsOpen) s.setShortcuts(false);
          else if (s.menu) s.openMenu(null);
          else if (s.detail) s.select(null);
          else {
            if (s.replay) s.setReplay(null);
            globeRef.current?.pointOfView({ ...HOME_VIEW, altitude: window.innerWidth < 768 ? 3.4 : HOME_VIEW.altitude }, 1400);
            const c = globeRef.current?.controls();
            if (c) c.autoRotate = true;
          }
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
