import { CATEGORY_LABELS, type ClusterView } from '@gw/shared';
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect } from 'react';
import { api } from '../lib/api';
import { DEMO } from '../lib/demo';
import { fmtCoord, utcHHMM } from '../lib/time';
import { useStore } from '../store/useStore';
import { CategoryChip, LocationTag, RelTime, SourceBadge, UnverifiedTag } from './Badges';
import { Thumb } from './Card';
import { IconClose, IconExternal, IconPin } from './icons';
import { MiniMap } from './MiniMap';

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="border-r border-line px-3 py-2 last:border-r-0">
      <div className="micro !text-[9px]">{label}</div>
      <div className="mono mt-0.5 text-[12px] text-fg">{value}</div>
    </div>
  );
}

function fmtN(n: number | undefined): string {
  if (n == null) return '—';
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(Math.round(n));
}

function Body({ c }: { c: ClusterView }) {
  const select = useStore((s) => s.select);
  const togglePin = useStore((s) => s.togglePin);
  const pinned = useStore((s) => !!s.settings.pins[c.id]);
  const anyUnverified = c.sources.some((x) => !x.verified);
  const eng = c.engagement;
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <h2 className="micro text-fg/80">Story</h2>
        {c.breaking && <span className="mono rounded-[2px] bg-amber/15 px-1.5 py-px text-[9.5px] tracking-[0.1em] text-amber">BREAKING</span>}
        <span className="mono text-[10px] text-dim">{c.id}</span>
        <button
          onClick={() => togglePin(c)}
          className={`ml-auto flex items-center gap-1 rounded-[2px] border px-1.5 py-0.5 text-[10px] ${pinned ? 'border-amber/60 text-amber' : 'border-line text-mut hover:text-fg'}`}
          title="Pinned stories never decay"
        >
          <IconPin /> {pinned ? 'PINNED' : 'PIN'}
        </button>
        <button onClick={() => select(null)} className="text-mut hover:text-fg" title="Close (Esc)">
          <IconClose />
        </button>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <div className="flex gap-3 px-4 pt-4">
          {(c.thumb || !DEMO) && <Thumb src={c.thumb} size={84} />}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-mut">
              <span>{c.sourceType === 'reddit' && c.subreddit ? `r/${c.subreddit}` : c.outlet}</span>
              <SourceBadge type={c.sourceType} />
              {!c.verified && <UnverifiedTag />}
            </div>
            <h1 className="mt-1 text-[16px] font-semibold leading-[1.3] text-fg">{c.title}</h1>
          </div>
        </div>
        {c.snippet && <p className="px-4 pt-3 text-[12.5px] leading-relaxed text-mut">{c.snippet}</p>}
        <div className="px-4 pt-3">
          <a href={c.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-[12px] text-amber hover:underline">
            Read at {c.outlet} <IconExternal />
          </a>
        </div>
        {anyUnverified && (
          <div className="mx-4 mt-3 rounded-[2px] border border-amber/30 bg-amber/5 px-3 py-2 text-[11.5px] text-amber/90">
            Includes posts from public Telegram channels. These are unverified and may be partisan or inaccurate.
          </div>
        )}

        <div className="mx-4 mt-4 grid grid-cols-4 rounded-[2px] border border-line">
          <Stat label="Importance" value={Math.round(c.importance)} />
          <Stat label="Sources" value={c.sourceCount} />
          <Stat label="First seen" value={utcHHMM(c.firstSeenAt)} />
          <Stat label="Age" value={<RelTime iso={c.firstSeenAt} />} />
        </div>
        {eng && (eng.score != null || eng.views != null || eng.velocity != null) && (
          <div className="mx-4 mt-2 grid grid-cols-4 rounded-[2px] border border-line">
            <Stat label="Upvotes" value={fmtN(eng.score)} />
            <Stat label="Comments" value={fmtN(eng.comments)} />
            <Stat label="Views" value={fmtN(eng.views)} />
            <Stat label="Velocity/min" value={eng.velocity != null ? eng.velocity.toFixed(1) : '—'} />
          </div>
        )}

        <div className="px-4 pt-5">
          <div className="micro mb-2 flex items-center">
            Location
            <span className="ml-auto normal-case tracking-normal">
              <CategoryChip category={c.category} />
            </span>
          </div>
          {c.geo ? (
            <>
              <MiniMap geo={c.geo} />
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                <LocationTag place={c.geo.place} country={c.geo.country} />
                <span className="mono text-[10.5px] text-dim">{fmtCoord(c.geo.lat, c.geo.lon)}</span>
                <span className="mono text-[10.5px] text-dim">
                  {c.geo.precision.toUpperCase()} · {c.geo.method.toUpperCase()} · CONF {Math.round(c.geo.confidence * 100)}%
                </span>
              </div>
            </>
          ) : (
            <div className="rounded-[2px] border border-line px-3 py-3 text-[12px] text-dim">No specific location — shown in the Global lane.</div>
          )}
          <div className="mt-2 text-[11px] text-dim">Category: {CATEGORY_LABELS[c.category]}</div>
        </div>

        <div className="px-4 pb-6 pt-5">
          <div className="micro mb-2">Coverage · {c.sources.length}</div>
          <ul className="rounded-[2px] border border-line">
            {c.sources.map((s) => (
              <li key={s.itemId} className="border-b border-line last:border-0">
                <a href={s.url} target="_blank" rel="noopener noreferrer" className="block px-3 py-2 hover:bg-panel-2">
                  <div className="flex items-center gap-1.5 text-[10.5px] text-mut">
                    <span className="truncate">{s.sourceType === 'reddit' && s.subreddit ? `r/${s.subreddit}` : s.outlet}</span>
                    <SourceBadge type={s.sourceType} />
                    {!s.verified && <UnverifiedTag />}
                    <span className="mono ml-auto shrink-0 text-dim">{utcHHMM(s.publishedAt)}</span>
                  </div>
                  <div className="mt-0.5 line-clamp-2 text-[12px] text-fg/90">{s.title}</div>
                </a>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[10.5px] text-dim">Headlines and short snippets only — every link opens the original publisher.</p>
        </div>
      </div>
    </div>
  );
}

export function DetailDrawer() {
  const detail = useStore((s) => s.detail);
  const select = useStore((s) => s.select);

  // Refresh from the server so the cluster view is current (source list grows over time).
  useEffect(() => {
    if (!detail) return;
    let alive = true;
    api
      .cluster(detail.id)
      .then((c) => alive && useStore.getState().detail?.id === c.id && useStore.setState({ detail: { ...useStore.getState().detail!, ...c } }))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [detail?.id]);

  return (
    <AnimatePresence>
      {detail && (
        <motion.aside
          key="drawer"
          initial={{ x: 40, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 40, opacity: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="absolute bottom-0 right-0 top-0 z-40 w-full border-l border-line bg-panel sm:w-[420px]"
          onKeyDown={(e) => e.key === 'Escape' && select(null)}
        >
          <Body c={detail} />
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
