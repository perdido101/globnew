import { CATEGORY_COLORS, CATEGORY_LABELS, type Category, type SourceType } from '@gw/shared';
import { relTime } from '../lib/time';
import { useStore } from '../store/useStore';

const TYPE_LABEL: Record<SourceType, string> = { news: 'NEWS', reddit: 'REDDIT', telegram: 'TELEGRAM', gdelt: 'GDELT' };

export function SourceBadge({ type }: { type: SourceType }) {
  return (
    <span className="mono rounded-[2px] border border-line-2 px-1 py-px text-[9px] leading-none tracking-[0.08em] text-mut">{TYPE_LABEL[type]}</span>
  );
}

export function UnverifiedTag() {
  return (
    <span
      title="Telegram channel — not independently verified"
      className="mono rounded-[2px] border border-amber/50 px-1 py-px text-[9px] leading-none tracking-[0.08em] text-amber"
    >
      UNVERIFIED
    </span>
  );
}

export function CategoryChip({ category, short }: { category: Category; short?: boolean }) {
  const color = CATEGORY_COLORS[category];
  const label = CATEGORY_LABELS[category];
  return (
    <span className="inline-flex items-center gap-1 text-[10px] leading-none text-mut">
      <span className="inline-block h-[7px] w-[7px] rounded-[1px]" style={{ background: color }} />
      {short ? label.split(' ')[0] : label}
    </span>
  );
}

export function RelTime({ iso, className = '' }: { iso: string | undefined; className?: string }) {
  const now = useStore((s) => s.now);
  return <span className={`mono tabular-nums ${className}`}>{relTime(iso, now)}</span>;
}

export function LocationTag({ place, country }: { place?: string | null; country?: string | null }) {
  if (!place && !country) return <span className="mono text-[10px] tracking-[0.06em] text-dim">GLOBAL</span>;
  const p = (place ?? '').toUpperCase();
  return (
    <span className="mono truncate text-[10px] tracking-[0.06em] text-mut">
      {p}
      {country && p !== country ? <span className="text-dim"> · {country}</span> : null}
    </span>
  );
}

export function SubredditBadge({ sub }: { sub: string }) {
  return <span className="mono truncate rounded-[2px] bg-panel-2 px-1 py-px text-[9px] leading-none text-mut">r/{sub}</span>;
}
