import { CATEGORIES, CATEGORY_COLORS, type TimelineBucket } from '@gw/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { utcHHMM } from '../lib/time';
import { useStore } from '../store/useStore';

const HOURS = 24;
const BUCKET_MIN = 15;
const REPLAY_WINDOW_MS = 45 * 60_000;

/** 24h activity histogram with a scrubber that replays what appeared when. */
export function Timeline() {
  const [data, setData] = useState<{ bucketMs: number; buckets: TimelineBucket[] } | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const replay = useStore((s) => s.replay);
  const setReplay = useStore((s) => s.setReplay);
  const minImportance = useStore((s) => s.settings.minImportance);
  const bar = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const reqId = useRef(0);

  useEffect(() => {
    const load = () => api.timeline(HOURS, BUCKET_MIN).then(setData).catch(() => {});
    void load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  const start = data ? Date.parse(data.buckets[0]?.t ?? new Date().toISOString()) : Date.now() - HOURS * 3600_000;
  const end = Date.now();
  const max = Math.max(1, ...(data?.buckets.map((b) => b.count) ?? [1]));

  const timeAt = useCallback(
    (clientX: number) => {
      const r = bar.current!.getBoundingClientRect();
      const f = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
      return start + f * (end - start);
    },
    [start, end],
  );

  const scrubTo = useCallback(
    (t: number) => {
      const id = ++reqId.current;
      const at = Math.max(start + REPLAY_WINDOW_MS / 2, t);
      setReplay({ at, windowMs: REPLAY_WINDOW_MS, clusters: useStore.getState().replay?.clusters ?? [], loading: true });
      api
        .clusters(new Date(at - REPLAY_WINDOW_MS), new Date(at), minImportance)
        .then((clusters) => {
          if (id !== reqId.current || !useStore.getState().replay) return;
          setReplay({
            at,
            windowMs: REPLAY_WINDOW_MS,
            loading: false,
            clusters: clusters.map((c) => ({ ...c, releasedAt: c.firstSeenAt, ttlMs: REPLAY_WINDOW_MS })),
          });
        })
        .catch(() => {});
    },
    [start, setReplay, minImportance],
  );

  useEffect(() => {
    const up = () => (dragging.current = false);
    const move = (e: PointerEvent) => dragging.current && scrubTo(timeAt(e.clientX));
    window.addEventListener('pointerup', up);
    window.addEventListener('pointermove', move);
    return () => {
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointermove', move);
    };
  }, [scrubTo, timeAt]);

  const markerX = replay ? ((replay.at - start) / (end - start)) * 100 : 100;
  const hourTicks = Array.from({ length: HOURS + 1 }, (_, i) => Math.ceil(start / 3600_000) * 3600_000 + i * 3600_000).filter((t) => t <= end);

  return (
    <div className="relative z-20 h-[74px] shrink-0 border-t border-line bg-bg px-3 pt-1.5">
      <div className="flex items-center gap-3">
        <h3 className="micro">Timeline · 24h</h3>
        {replay ? (
          <>
            <span className="mono text-[10.5px] text-amber">
              REPLAY {utcHHMM(replay.at - replay.windowMs)}–{utcHHMM(replay.at)} UTC · {replay.loading ? '…' : `${replay.clusters.length} stories`}
            </span>
            <button className="mono rounded-[2px] border border-amber/60 px-1.5 py-px text-[10px] text-amber hover:bg-amber/10" onClick={() => setReplay(null)}>
              BACK TO LIVE
            </button>
          </>
        ) : (
          <span className="mono text-[10.5px] text-dim">drag to replay</span>
        )}
        {hover !== null && data?.buckets[hover] && (
          <span className="mono ml-auto text-[10.5px] text-mut">
            {utcHHMM(data.buckets[hover]!.t)} · {data.buckets[hover]!.count} stories
          </span>
        )}
      </div>
      <div
        ref={bar}
        className="relative mt-1 h-[40px] cursor-ew-resize select-none"
        onPointerDown={(e) => {
          dragging.current = true;
          scrubTo(timeAt(e.clientX));
        }}
        onMouseMove={(e) => {
          if (!data) return;
          const f = (timeAt(e.clientX) - start) / (end - start);
          setHover(Math.min(data.buckets.length - 1, Math.floor(f * data.buckets.length)));
        }}
        onMouseLeave={() => setHover(null)}
      >
        <div className="absolute inset-x-0 bottom-3 top-0 flex items-end gap-px">
          {data?.buckets.map((b, i) => {
            const h = (b.count / max) * 100;
            // Stacked by category, muted.
            let acc = 0;
            return (
              <div key={b.t} className={`relative flex-1 ${hover === i ? 'opacity-100' : 'opacity-75'}`} style={{ height: `${Math.max(h, b.count ? 4 : 1)}%` }}>
                {b.count === 0 ? (
                  <div className="absolute inset-x-0 bottom-0 h-px bg-line" />
                ) : (
                  CATEGORIES.map((c) => {
                    const n = b.byCategory[c] ?? 0;
                    if (!n) return null;
                    const seg = (n / b.count) * 100;
                    const el = <div key={c} className="absolute inset-x-0" style={{ bottom: `${acc}%`, height: `${seg}%`, background: CATEGORY_COLORS[c], opacity: 0.55 }} />;
                    acc += seg;
                    return el;
                  })
                )}
              </div>
            );
          })}
        </div>
        <div className="absolute inset-x-0 bottom-0 h-3">
          {hourTicks.map((t) => {
            const x = ((t - start) / (end - start)) * 100;
            const label = new Date(t).getUTCHours() % 3 === 0;
            return (
              <div key={t} className="absolute top-0" style={{ left: `${x}%` }}>
                <div className="h-1 w-px bg-line-2" />
                {label && <div className="mono absolute left-0 top-0.5 -translate-x-1/2 text-[8.5px] text-dim">{utcHHMM(t)}</div>}
              </div>
            );
          })}
        </div>
        <div className="pointer-events-none absolute bottom-3 top-0 w-px bg-amber" style={{ left: `${markerX}%`, opacity: replay ? 1 : 0.5 }} />
        {replay && (
          <div
            className="pointer-events-none absolute bottom-3 top-0 bg-amber/10"
            style={{ left: `${((replay.at - replay.windowMs - start) / (end - start)) * 100}%`, width: `${(replay.windowMs / (end - start)) * 100}%` }}
          />
        )}
      </div>
    </div>
  );
}
