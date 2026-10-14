import { REGIONS, inRegion } from '@gw/shared';
import { useEffect, useRef } from 'react';
import { useStore } from '../store/useStore';

/** Card context menu: pin, mute outlet / source type / category / region, open original. */
export function ContextMenu() {
  const menu = useStore((s) => s.menu);
  const openMenu = useStore((s) => s.openMenu);
  const settings = useStore((s) => s.settings);
  const patch = useStore((s) => s.patchSettings);
  const togglePin = useStore((s) => s.togglePin);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => !ref.current?.contains(e.target as Node) && openMenu(null);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && openMenu(null);
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    window.addEventListener('wheel', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', esc);
      window.removeEventListener('wheel', close);
    };
  }, [menu, openMenu]);

  if (!menu) return null;
  const c = menu.cluster;
  const region = c.geo ? REGIONS.find((r) => r.key !== 'greece' && inRegion(r, c.geo!.lat, c.geo!.lon)) : undefined;
  const pinned = !!settings.pins[c.id];
  const items: { label: string; run: () => void; hint?: string }[] = [
    { label: pinned ? 'Unpin' : 'Pin (never decays)', run: () => togglePin(c) },
    { label: `Mute outlet · ${c.outlet}`, run: () => patch({ mutedOutlets: [...new Set([...settings.mutedOutlets, c.outlet])] }) },
    { label: `Hide ${c.sourceType.toUpperCase()} items`, run: () => patch({ sourceTypes: settings.sourceTypes.filter((t) => t !== c.sourceType) }) },
    { label: `Hide category · ${c.category}`, run: () => patch({ categories: settings.categories.filter((x) => x !== c.category) }) },
    ...(region ? [{ label: `Mute region · ${region.label}`, run: () => patch({ mutedRegions: [...new Set([...settings.mutedRegions, region.key])] }) }] : []),
    { label: 'Open original ↗', run: () => window.open(c.url, '_blank', 'noopener,noreferrer') },
  ];
  const x = Math.min(menu.x, window.innerWidth - 250);
  const y = Math.min(menu.y, window.innerHeight - items.length * 30 - 20);
  return (
    <div ref={ref} className="fixed z-[60] w-60 rounded-[2px] border border-line-2 bg-panel py-1" style={{ left: x, top: y }}>
      {items.map((it) => (
        <button
          key={it.label}
          onClick={() => {
            it.run();
            openMenu(null);
          }}
          className="block w-full truncate px-3 py-1.5 text-left text-[12px] text-fg/90 hover:bg-panel-2"
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}
