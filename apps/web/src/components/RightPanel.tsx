import type { ClusterView } from '@gw/shared';
import { CATEGORY_COLORS } from '@gw/shared';
import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { DEMO } from '../lib/demo';
import { flyTo } from '../lib/globeRef';
import { utcHHMM } from '../lib/time';
import { inFocus, passesClient, useStore } from '../store/useStore';
import { LocationTag, SourceBadge, UnverifiedTag } from './Badges';
import { Thumb } from './Card';

function FeedRow({ c }: { c: ClusterView }) {
  const select = useStore((s) => s.select);
  const selected = useStore((s) => s.selectedId === c.id);
  const setHover = useStore((s) => s.setHover);
  const openMenu = useStore((s) => s.openMenu);
  const dim = useStore((s) => !inFocus(c, s.settings));
  return (
    <button
      onClick={() => {
        select(c);
        if (c.geo) flyTo(c.geo.lat, c.geo.lon, 1.35);
        window.dispatchEvent(new Event('gw:interact'));
      }}
      onMouseEnter={() => setHover(c.id)}
      onMouseLeave={() => setHover(null)}
      onContextMenu={(e) => {
        e.preventDefault();
        openMenu({ x: e.clientX, y: e.clientY, cluster: c });
      }}
      className={`group flex w-full gap-2.5 border-b border-line px-3 py-2.5 text-left transition-colors ${selected ? 'bg-panel-2' : 'hover:bg-panel-2/60'} ${dim ? 'opacity-40' : ''}`}
    >
      <div className="flex w-9 shrink-0 flex-col items-start gap-1.5">
        <span className="mono text-[10.5px] tabular-nums text-mut">{utcHHMM(c.releasedAt ?? c.firstSeenAt)}</span>
        <span className="h-[3px] w-5 rounded-full" style={{ background: c.breaking ? '#F2A93B' : CATEGORY_COLORS[c.category] }} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-[10.5px] text-mut">
          <span className="truncate">{c.sourceType === 'reddit' && c.subreddit ? `r/${c.subreddit}` : c.outlet}</span>
          <SourceBadge type={c.sourceType} />
          {!c.verified && <UnverifiedTag />}
          {c.sourceCount > 1 && <span className="mono ml-auto shrink-0 text-[10px] text-mut">+{c.sourceCount - 1}</span>}
        </div>
        <div className="mt-0.5 line-clamp-2 text-[12px] leading-[1.3] text-fg">{c.title}</div>
        <div className="mt-1">
          <LocationTag place={c.geo?.place} country={c.geo?.country} />
        </div>
      </div>
      {(c.thumb || !DEMO) && <Thumb src={c.thumb} size={40} className="hidden xl:block" />}
    </button>
  );
}

export function FeedList({ lane }: { lane: 'all' | 'global' }) {
  const ids = useStore(useShallow((s) => s.feed));
  const clusters = useStore((s) => s.archive);
  const pins = useStore((s) => s.settings.pins);
  const settings = useStore((s) => s.settings);
  const now = useStore((s) => Math.floor(s.now / 10_000));
  const list = useMemo(() => {
    const out: ClusterView[] = [];
    for (const id of ids) {
      const c = clusters[id] ?? pins[id];
      if (!c || !passesClient(c, settings, Date.now())) continue;
      if (lane === 'global' && c.geo) continue;
      out.push(c);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, clusters, pins, settings, lane, now]);
  if (!list.length)
    return (
      <div className="px-4 py-10 text-center text-[12px] text-dim">
        {lane === 'global' ? 'No stories without a location yet.' : 'Waiting for the first stories…'}
      </div>
    );
  return (
    <div>
      {list.map((c) => (
        <FeedRow key={c.id} c={c} />
      ))}
    </div>
  );
}

export function RightPanel() {
  const [lane, setLane] = useState<'all' | 'global'>('all');
  const count = useStore((s) => s.feed.length);
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-line px-3 py-2.5">
        <h2 className="micro text-fg/80">Live Feed</h2>
        <span className="mono text-[10px] text-dim">{count}</span>
        <div className="ml-auto flex gap-1">
          {(['all', 'global'] as const).map((l) => (
            <button
              key={l}
              onClick={() => setLane(l)}
              className={`mono rounded-[2px] px-1.5 py-0.5 text-[10px] tracking-[0.08em] ${lane === l ? 'bg-panel-2 text-fg' : 'text-dim hover:text-mut'}`}
            >
              {l === 'all' ? 'ALL' : 'GLOBAL LANE'}
            </button>
          ))}
        </div>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <FeedList lane={lane} />
      </div>
    </div>
  );
}
