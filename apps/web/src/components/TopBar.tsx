import { REGIONS, regionByKey } from '@gw/shared';
import { useEffect, useRef, useState } from 'react';
import { flyTo } from '../lib/globeRef';
import { utcClock } from '../lib/time';
import { useStore } from '../store/useStore';
import { IconPanelLeft, IconPanelRight, IconPause, IconPlay, IconTarget } from './icons';
import { SearchBox } from './SearchBox';

function Clock() {
  const now = useStore((s) => s.now);
  return <span className="mono text-[12px] tabular-nums text-fg">{utcClock(new Date(now))}<span className="ml-1 text-dim">UTC</span></span>;
}

function Status() {
  const status = useStore((s) => s.status);
  const paused = useStore((s) => s.settings.paused);
  const replay = useStore((s) => !!s.replay);
  const label = replay ? 'REPLAY' : paused ? 'PAUSED' : status === 'live' ? 'LIVE' : status === 'offline' ? 'OFFLINE' : status === 'reconnecting' ? 'RECONNECTING' : 'CONNECTING';
  const color = replay || paused ? '#F2A93B' : status === 'live' ? '#6E9C7A' : status === 'offline' ? '#B5655B' : '#F2A93B';
  return (
    <span className="flex items-center gap-1.5">
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${status === 'live' && !paused && !replay ? 'breathe' : ''}`} style={{ background: color }} />
      <span className="mono text-[10.5px] tracking-[0.14em]" style={{ color }}>{label}</span>
    </span>
  );
}

export function RegionMenu() {
  const [open, setOpen] = useState(false);
  const focus = useStore((s) => s.settings.focusRegion);
  const patch = useStore((s) => s.patchSettings);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  const region = regionByKey(focus);
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex h-7 items-center gap-1.5 rounded-[2px] border px-2 text-[11px] ${focus ? 'border-amber/60 text-amber' : 'border-line text-mut hover:text-fg'}`}
        title="Region presets & focus mode (F)"
      >
        <IconTarget />
        <span className="hidden sm:inline">{region ? `FOCUS · ${region.label.toUpperCase()}` : 'REGIONS'}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-8 z-50 w-56 rounded-[2px] border border-line bg-panel p-1 shadow-none">
          <div className="micro px-2 pb-1 pt-1.5">Fly to</div>
          {REGIONS.map((r) => (
            <div key={r.key} className="flex items-center">
              <button className="flex-1 px-2 py-1.5 text-left text-[12px] text-fg/90 hover:bg-panel-2" onClick={() => (flyTo(r.view.lat, r.view.lng, r.view.altitude, 1600), setOpen(false))}>
                {r.label}
              </button>
              <button
                className={`mono px-2 py-1 text-[10px] tracking-[0.08em] hover:text-amber ${focus === r.key ? 'text-amber' : 'text-dim'}`}
                onClick={() => {
                  patch({ focusRegion: focus === r.key ? null : r.key });
                  if (focus !== r.key) flyTo(r.view.lat, r.view.lng, r.view.altitude, 1600);
                  setOpen(false);
                }}
              >
                {focus === r.key ? 'UNFOCUS' : 'FOCUS'}
              </button>
            </div>
          ))}
          {focus && (
            <button className="mt-1 w-full border-t border-line px-2 py-1.5 text-left text-[11px] text-mut hover:text-fg" onClick={() => (patch({ focusRegion: null }), setOpen(false))}>
              Exit focus mode
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function TopBar() {
  const stats = useStore((s) => s.stats);
  const settings = useStore((s) => s.settings);
  const patch = useStore((s) => s.patchSettings);
  const setShortcuts = useStore((s) => s.setShortcuts);
  return (
    <header className="relative z-30 flex h-11 shrink-0 items-center gap-3 border-b border-line bg-bg px-3">
      <button className="hidden text-mut hover:text-fg md:block" title="Toggle filters ([)" onClick={() => patch({ leftOpen: !settings.leftOpen })}>
        <IconPanelLeft />
      </button>
      <div className="flex items-baseline gap-2">
        <span className="text-[12.5px] font-semibold tracking-[0.28em] text-fg">GLOBAL&nbsp;WIRE</span>
        <span className="mono hidden text-[10px] text-dim lg:inline">v0.1</span>
      </div>
      <span className="h-4 w-px bg-line" />
      <Status />
      <span className="hidden h-4 w-px bg-line sm:block" />
      <span className="hidden sm:block">
        <Clock />
      </span>
      <span className="hidden items-center gap-3 lg:flex">
        <span className="h-4 w-px bg-line" />
        <span className="micro">Items/h</span>
        <span className="mono text-[12px] tabular-nums text-fg">{stats?.itemsLastHour ?? '—'}</span>
        <span className="micro">Stories/h</span>
        <span className="mono text-[12px] tabular-nums text-fg">{stats?.clustersLastHour ?? '—'}</span>
        <span className="micro">Sources</span>
        <span className="mono text-[12px] tabular-nums text-fg">
          {stats ? `${stats.sourcesOk}/${stats.sourcesTotal}` : '—'}
        </span>
        {stats && !stats.llmEnabled && (
          <span className="mono text-[10px] text-dim" title="ANTHROPIC_API_KEY not set — heuristic enrichment only">
            HEURISTIC
          </span>
        )}
      </span>
      <div className="ml-auto flex items-center gap-2">
        <SearchBox />
        <RegionMenu />
        <button
          onClick={() => patch({ paused: !settings.paused })}
          className={`flex h-7 items-center gap-1.5 rounded-[2px] border px-2 text-[11px] ${settings.paused ? 'border-amber/60 text-amber' : 'border-line text-mut hover:text-fg'}`}
          title="Pause / resume flow (Space)"
        >
          {settings.paused ? <IconPlay /> : <IconPause />}
          <span className="hidden sm:inline">{settings.paused ? 'RESUME' : 'PAUSE'}</span>
        </button>
        <button className="mono hidden h-7 w-7 rounded-[2px] border border-line text-[12px] text-mut hover:text-fg sm:block" onClick={() => setShortcuts(true)} title="Keyboard shortcuts (?)">
          ?
        </button>
        <button className="hidden text-mut hover:text-fg md:block" title="Toggle live feed (])" onClick={() => patch({ rightOpen: !settings.rightOpen })}>
          <IconPanelRight />
        </button>
      </div>
    </header>
  );
}
