import type { ClusterView } from '@gw/shared';
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Card } from '../components/Card';
import { globeRef } from '../lib/globeRef';
import { computeVisible } from '../lib/visible';
import { useStore } from '../store/useStore';
import { groupNearby, placeCards, type Anchor } from './layout';

interface Refs {
  wrap: HTMLDivElement | null;
  card: HTMLDivElement | null;
  line: SVGLineElement | null;
  size: { w: number; h: number } | null;
}

const MARKER_ALT = 0.012;
const GROUP_RADIUS = 30;

/** Floating cards anchored to markers with leader lines; hides far-side cards; collapses crowds into bubbles. */
export function CardLayer({ maxCards, compact }: { maxCards: number; compact: boolean }) {
  const cards = useStore(useShallow((s) => computeVisible(s, maxCards).cards));
  const container = useRef<HTMLDivElement>(null);
  const bubbleHost = useRef<HTMLDivElement>(null);
  const refs = useRef(new Map<string, Refs>());
  const prevSlots = useRef(new Map<string, number>());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  const cardsRef = useRef(cards);
  cardsRef.current = cards;
  /** Ref records are created on demand and only garbage-collected once their element has left the DOM. */
  const rec = (id: string): Refs => {
    let r = refs.current.get(id);
    if (!r) {
      r = { wrap: null, card: null, line: null, size: null };
      refs.current.set(id, r);
    }
    return r;
  };

  useEffect(() => {
    let raf = 0;
    const bubbles: HTMLButtonElement[] = [];
    const v = { x: 0, y: 0, z: 0 };

    const frame = () => {
      raf = requestAnimationFrame(frame);
      const g = globeRef.current;
      const host = container.current;
      if (!g || !host) return;
      const W = host.clientWidth;
      const H = host.clientHeight;
      const cam = g.camera().position;
      const camLen = Math.hypot(cam.x, cam.y, cam.z);
      const R = g.getGlobeRadius();
      const horizon = (R * 1.01) / camLen;

      // 1. project anchors; hide those on the far side of the globe
      const pts: { id: string; x: number; y: number; priority: number; c: ClusterView; vis: number }[] = [];
      const list = cardsRef.current;
      const now = Date.now();
      list.forEach((c, i) => {
        if (!c.geo) return;
        const p = g.getCoords(c.geo.lat, c.geo.lon, MARKER_ALT);
        v.x = p.x;
        v.y = p.y;
        v.z = p.z;
        const pl = Math.hypot(v.x, v.y, v.z);
        const dot = (v.x * cam.x + v.y * cam.y + v.z * cam.z) / (pl * camLen);
        const vis = Math.max(0, Math.min(1, (dot - horizon) / 0.08));
        if (vis <= 0) return;
        const s = g.getScreenCoords(c.geo.lat, c.geo.lon, MARKER_ALT);
        if (s.x < -50 || s.y < -50 || s.x > W + 50 || s.y > H + 50) return;
        const pinned = !!useStore.getState().settings.pins[c.id];
        const sel = useStore.getState().selectedId === c.id;
        const recency = 1 - Math.min(1, (now - Date.parse(c.releasedAt ?? c.firstSeenAt)) / 600_000);
        pts.push({ id: c.id, x: s.x, y: s.y, c, vis, priority: (sel ? 1000 : 0) + (pinned ? 500 : 0) + c.importance + recency * 30 - i * 0.01 });
      });

      // 2. crowding → bubbles (expanded groups are exempt)
      const exp = expandedRef.current;
      const groups = groupNearby(
        pts.filter((p) => !exp.has(p.id)),
        GROUP_RADIUS,
      );
      const grouped = new Set<string>();
      const bubbleGroups = groups.filter((gp) => gp.ids.length > 1);
      for (const gp of bubbleGroups) {
        // The selected story is never swallowed by a bubble.
        const sel = useStore.getState().selectedId;
        if (sel && gp.ids.includes(sel)) continue;
        gp.ids.forEach((id) => grouped.add(id));
      }

      // 3. place cards
      const anchors: Anchor[] = [];
      for (const p of pts) {
        if (grouped.has(p.id)) continue;
        const r = refs.current.get(p.id);
        if (!r?.card) continue;
        if (!r.size || r.size.w === 0) r.size = { w: r.card.offsetWidth, h: r.card.offsetHeight };
        anchors.push({ id: p.id, x: p.x, y: p.y, w: r.size.w, h: r.size.h, priority: p.priority });
      }
      const placements = placeCards(anchors, { x: 8, y: 8, w: W - 16, h: H - 16 }, prevSlots.current, pts.map((p) => ({ x: p.x, y: p.y })));
      const byId = new Map(placements.map((pl) => [pl.id, pl]));
      if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__gwLayout = { list: list.length, pts: pts.length, grouped: grouped.size, anchors: anchors.length, placed: placements.length, refs: refs.current.size };
      const visById = new Map(pts.map((p) => [p.id, p]));

      const current = new Set(list.map((c) => c.id));
      for (const [id, r] of refs.current) {
        if (!r.wrap || !r.wrap.isConnected) {
          if (!current.has(id)) {
            refs.current.delete(id);
            prevSlots.current.delete(id);
          }
          continue;
        }
        const pl = byId.get(id);
        const p = visById.get(id);
        if (!pl || !p) {
          r.wrap.style.opacity = '0';
          r.wrap.style.pointerEvents = 'none';
          continue;
        }
        r.wrap.style.opacity = String(p.vis);
        r.wrap.style.pointerEvents = p.vis > 0.5 ? 'auto' : 'none';
        r.wrap.style.transform = `translate3d(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px, 0)`;
        if (r.card) r.card.style.transform = `translate3d(${pl.side === 1 ? 0 : -pl.rect.w}px, ${-pl.L - pl.rect.h}px, 0)`;
        if (r.line) r.line.setAttribute('y2', String(-pl.L));
      }

      // 4. bubbles (imperative pool)
      const host2 = bubbleHost.current!;
      while (bubbles.length < bubbleGroups.length) {
        const b = document.createElement('button');
        b.className =
          'mono absolute left-0 top-0 flex h-6 min-w-6 items-center justify-center rounded-full border border-line-2 bg-panel/90 px-1.5 text-[10px] text-fg transition-opacity duration-300 hover:border-amber hover:text-amber';
        b.onclick = () => {
          const ids = (b.dataset.ids ?? '').split(',');
          const gl = globeRef.current;
          const items = ids.map((id) => cardsRef.current.find((c) => c.id === id)).filter(Boolean) as ClusterView[];
          if (gl && items.length) {
            const lat = items.reduce((s, c) => s + c.geo!.lat, 0) / items.length;
            const lng = items.reduce((s, c) => s + c.geo!.lon, 0) / items.length;
            const alt = gl.pointOfView().altitude;
            gl.pointOfView({ lat, lng, altitude: Math.max(0.25, alt * 0.5) }, 900);
            window.dispatchEvent(new Event('gw:interact'));
          }
          setExpanded(new Set(ids));
        };
        host2.appendChild(b);
        bubbles.push(b);
      }
      bubbles.forEach((b, i) => {
        const gp = bubbleGroups[i];
        if (!gp) {
          b.style.display = 'none';
          return;
        }
        b.style.display = 'flex';
        b.dataset.ids = gp.ids.join(',');
        b.textContent = String(gp.ids.length);
        b.title = `${gp.ids.length} stories — click to expand`;
        b.style.transform = `translate3d(${(gp.x - 12).toFixed(1)}px, ${(gp.y - 34).toFixed(1)}px, 0)`;
      });
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      bubbles.forEach((b) => b.remove());
    };
  }, []);

  // Expanded groups collapse again after a while or on Esc.
  useEffect(() => {
    if (!expanded.size) return;
    const t = setTimeout(() => setExpanded(new Set()), 25_000);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setExpanded(new Set());
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKey);
    };
  }, [expanded]);

  const select = useStore((s) => s.select);
  const setHover = useStore((s) => s.setHover);
  const openMenu = useStore((s) => s.openMenu);

  return (
    <div ref={container} className="pointer-events-none absolute inset-0 overflow-hidden">
      <AnimatePresence>
        {cards.map((c) => (
          <motion.div
            key={c.id}
            ref={(el) => {
              rec(c.id).wrap = el;
            }}
            className="absolute left-0 top-0 transition-opacity duration-500"
            style={{ opacity: 0, willChange: 'transform' }}
            initial={{ filter: 'blur(0px)' }}
            exit={{ opacity: 0, transition: { duration: 0.6 } }}
          >
            <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width="1" height="1">
              <line
                ref={(el) => {
                  rec(c.id).line = el;
                }}
                x1={0}
                y1={-3}
                x2={0}
                y2={-58}
                stroke={c.breaking ? '#F2A93B' : '#5B6573'}
                strokeWidth={1}
                className="leader"
              />
              <circle r={2.2} fill="none" stroke={c.breaking ? '#F2A93B' : '#8A94A3'} strokeWidth={1} />
            </svg>
            <div
              ref={(el) => {
                const r = rec(c.id);
                if (el !== r.card) r.size = null;
                r.card = el;
              }}
              className="absolute left-0 top-0"
              style={{ transition: 'transform 380ms cubic-bezier(0.22,1,0.36,1)' }}
            >
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.7, delay: 0.35, ease: [0.22, 1, 0.36, 1] }}
                className="cursor-pointer select-none"
                onClick={() => select(c)}
                onMouseEnter={() => setHover(c.id)}
                onMouseLeave={() => setHover(null)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  openMenu({ x: e.clientX, y: e.clientY, cluster: c });
                }}
              >
                <Card c={c} compact={compact} />
              </motion.div>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
      <div ref={bubbleHost} className="pointer-events-auto absolute left-0 top-0" />
    </div>
  );
}
