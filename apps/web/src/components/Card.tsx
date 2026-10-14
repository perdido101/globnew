import type { ClusterView } from '@gw/shared';
import { useStore } from '../store/useStore';
import { CategoryChip, LocationTag, RelTime, SourceBadge, SubredditBadge, UnverifiedTag } from './Badges';

export function Thumb({ src, size, className = '' }: { src: string | null; size: number; className?: string }) {
  return (
    <div className={`shrink-0 overflow-hidden rounded-[2px] bg-panel-2 ${className}`} style={{ width: size, height: size }}>
      {src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          draggable={false}
          className="h-full w-full object-cover opacity-90"
          onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')}
        />
      ) : (
        <div className="h-full w-full bg-[radial-gradient(circle_at_30%_30%,#1b2430,#11161d)]" />
      )}
    </div>
  );
}

/** Compact card: thumbnail · outlet + badge · time · 2-line headline · location · category · +N sources. */
export function Card({ c, compact }: { c: ClusterView; compact?: boolean }) {
  const pinned = useStore((s) => !!s.settings.pins[c.id]);
  const selected = useStore((s) => s.selectedId === c.id);
  const hovered = useStore((s) => s.hoverId === c.id);
  const unverified = !c.verified;
  return (
    <div
      className={`brackets ${selected ? 'focus' : ''} flex gap-2.5 rounded-[2px] border bg-panel/95 p-2 backdrop-blur-[2px] transition-colors duration-300 ${
        selected || hovered ? 'border-line-2' : 'border-line'
      } ${c.breaking ? 'shadow-[inset_2px_0_0_#F2A93B]' : ''}`}
      style={{ width: compact ? 228 : 284 }}
    >
      <span className="br-b" />
      <Thumb src={c.thumb} size={compact ? 46 : 60} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[11px] font-medium text-fg/90">{c.sourceType === 'reddit' && c.subreddit ? `r/${c.subreddit}` : c.outlet}</span>
          <SourceBadge type={c.sourceType} />
          {unverified && <UnverifiedTag />}
          {c.subreddit && c.sourceType !== 'reddit' && <SubredditBadge sub={c.subreddit} />}
          <span className="ml-auto flex items-center gap-1 pl-1 text-[10px] text-dim">
            {pinned && <span className="text-amber">●</span>}
            <RelTime iso={c.publishedAt} />
          </span>
        </div>
        <div className={`line-clamp-2 mt-1 font-medium leading-[1.25] text-fg ${compact ? 'text-[11.5px]' : 'text-[12.5px]'}`}>{c.title}</div>
        <div className="mt-1.5 flex items-center gap-2">
          <LocationTag place={c.geo?.place} country={c.geo?.country} />
          <span className="ml-auto flex shrink-0 items-center gap-2">
            {c.sourceCount > 1 && <span className="mono text-[10px] text-mut">+{c.sourceCount - 1} src</span>}
            <CategoryChip category={c.category} short />
          </span>
        </div>
      </div>
    </div>
  );
}
