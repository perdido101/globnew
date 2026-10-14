import type { StreamEvent } from '@gw/shared';
import { toFlowFilters, useStore } from '../store/useStore';
import { api } from './api';

const SESSION_KEY = 'gw:session';

function b64url(s: string): string {
  return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** SSE connection with exponential-backoff reconnects. Session id survives reloads so reconnects don't replay. */
export function connectStream(): () => void {
  let es: EventSource | null = null;
  let retry = 0;
  let timer: number | null = null;
  let closed = false;

  const open = () => {
    if (closed) return;
    const st = useStore.getState();
    let session: string | null = null;
    try {
      session = sessionStorage.getItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
    const filters = b64url(JSON.stringify(toFlowFilters(st.settings)));
    st.setStatus(retry === 0 ? 'connecting' : 'reconnecting');
    es = new EventSource(`/stream?filters=${filters}${session ? `&session=${encodeURIComponent(session)}` : ''}`);

    const handle = (e: MessageEvent<string>) => {
      let ev: StreamEvent;
      try {
        ev = JSON.parse(e.data) as StreamEvent;
      } catch {
        return;
      }
      const s = useStore.getState();
      switch (ev.type) {
        case 'init':
          retry = 0;
          try {
            sessionStorage.setItem(SESSION_KEY, ev.sessionId);
          } catch {
            /* ignore */
          }
          s.init(ev.clusters, ev.config, ev.stats, ev.sessionId);
          break;
        case 'release':
          s.release(ev.cluster);
          break;
        case 'update':
          s.update(ev.cluster);
          break;
        case 'stats':
          s.setStats(ev.stats);
          break;
      }
    };
    for (const t of ['init', 'release', 'update', 'stats']) es.addEventListener(t, handle as EventListener);
    es.onopen = () => useStore.getState().setStatus('live');
    es.onerror = () => {
      es?.close();
      es = null;
      if (closed) return;
      retry++;
      useStore.getState().setStatus(retry > 4 ? 'offline' : 'reconnecting');
      const delay = Math.min(30_000, 1000 * 2 ** Math.min(retry - 1, 5)) * (0.75 + Math.random() * 0.5);
      timer = window.setTimeout(open, delay);
    };
  };

  open();

  // Push filter changes to the server-side release queue (debounced).
  let debounce: number | null = null;
  let lastSent = '';
  const unsub = useStore.subscribe((s, prev) => {
    if (s.settings === prev.settings) return;
    const f = toFlowFilters(s.settings);
    const key = JSON.stringify(f);
    if (key === lastSent) return;
    if (debounce) clearTimeout(debounce);
    debounce = window.setTimeout(() => {
      lastSent = key;
      const id = useStore.getState().sessionId;
      if (id) void api.setFilters(id, f).catch(() => {});
    }, 250);
  });

  const onVisible = () => {
    if (document.visibilityState === 'visible' && !es && !closed) {
      if (timer) clearTimeout(timer);
      retry = 0;
      open();
    }
  };
  document.addEventListener('visibilitychange', onVisible);

  return () => {
    closed = true;
    es?.close();
    if (timer) clearTimeout(timer);
    unsub();
    document.removeEventListener('visibilitychange', onVisible);
  };
}
