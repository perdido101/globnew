import { regionByKey } from '@gw/shared';
import { fmtCoord } from '../lib/time';
import { useStore } from '../store/useStore';

/** Restrained HUD details: corner brackets, cursor coordinates, focus/replay banners, empty & error states. */
export function Hud({ cursor }: { cursor: { lat: number; lng: number } | null }) {
  const status = useStore((s) => s.status);
  const count = useStore((s) => (s.replay ? s.replay.clusters.filter((c) => c.geo).length : Object.keys(s.clusters).length));
  const sessionId = useStore((s) => s.sessionId);
  const focus = useStore((s) => regionByKey(s.settings.focusRegion));
  const paused = useStore((s) => s.settings.paused);
  const patch = useStore((s) => s.patchSettings);
  const replay = useStore((s) => s.replay);

  return (
    <div className="pointer-events-none absolute inset-0">
      <div className="brackets absolute inset-3">
        <span className="br-b" />
      </div>
      <div className="mono absolute bottom-5 left-5 text-[10.5px] tabular-nums text-dim">
        {cursor ? fmtCoord(cursor.lat, cursor.lng) : '——.——° ———.——°'}
      </div>
      <div className="mono absolute bottom-5 right-5 hidden text-[10px] text-dim sm:block">{count} ON GLOBE</div>

      {(focus || paused) && !replay && (
        <div className="pointer-events-auto absolute left-1/2 top-5 flex -translate-x-1/2 items-center gap-2 rounded-[2px] border border-amber/40 bg-panel/90 px-3 py-1">
          <span className="mono text-[10.5px] tracking-[0.12em] text-amber">
            {paused ? 'FLOW PAUSED' : ''}
            {paused && focus ? ' · ' : ''}
            {focus ? `FOCUS · ${focus.label.toUpperCase()}` : ''}
          </span>
          {focus && (
            <button className="mono text-[10px] text-mut hover:text-fg" onClick={() => patch({ focusRegion: null })}>
              EXIT
            </button>
          )}
          {paused && (
            <button className="mono text-[10px] text-mut hover:text-fg" onClick={() => patch({ paused: false })}>
              RESUME
            </button>
          )}
        </div>
      )}

      {!sessionId && status !== 'offline' && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="mono text-[11px] tracking-[0.2em] text-mut breathe">ESTABLISHING LINK…</div>
        </div>
      )}
      {sessionId && count === 0 && !replay && status === 'live' && (
        <div className="absolute inset-x-0 top-1/2 flex justify-center">
          <div className="mono text-[11px] tracking-[0.16em] text-dim">AWAITING FIRST STORIES…</div>
        </div>
      )}
      {(status === 'offline' || status === 'reconnecting') && (
        <div className="absolute left-1/2 top-14 -translate-x-1/2 rounded-[2px] border border-warn/40 bg-panel/95 px-3 py-1.5">
          <span className="mono text-[10.5px] tracking-[0.1em] text-warn">
            {status === 'offline' ? 'CONNECTION LOST — RETRYING' : 'RECONNECTING…'}
          </span>
        </div>
      )}
    </div>
  );
}
