import { CATEGORY_COLORS, type ClusterView } from '@gw/shared';
import Globe, { type GlobeInstance } from 'globe.gl';
import { useEffect, useRef } from 'react';
import { Color, MeshPhongMaterial } from 'three';
import { api } from '../lib/api';
import { globeRef } from '../lib/globeRef';
import { computeVisible } from '../lib/visible';
import { worldFeatures } from '../lib/world';
import { useStore } from '../store/useStore';

interface PointDatum {
  id: string;
  lat: number;
  lng: number;
  color: string;
  r: number;
  alt: number;
  c: ClusterView;
}

interface RingDatum {
  lat: number;
  lng: number;
  color: string;
  born: number;
  speed: number;
  maxR: number;
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

const IDLE_RESUME_MS = 25_000;

export function GlobeView({ maxCards, onCursor }: { maxCards: number; onCursor: (c: { lat: number; lng: number } | null) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const maxRef = useRef(maxCards);
  maxRef.current = maxCards;
  const cursorRef = useRef(onCursor);
  cursorRef.current = onCursor;

  useEffect(() => {
    const host = el.current!;
    const globe: GlobeInstance = new Globe(host, { rendererConfig: { antialias: true, alpha: false, powerPreference: 'high-performance' } });
    globeRef.current = globe;

    const mat = new MeshPhongMaterial({ color: new Color('#0E141B'), emissive: new Color('#070A0E'), shininess: 3 });
    globe
      .backgroundColor('#0A0D12')
      .globeMaterial(mat)
      .showAtmosphere(true)
      .atmosphereColor('#5B7FA3')
      .atmosphereAltitude(0.13)
      .showGraticules(useStore.getState().settings.graticule)
      .polygonsData(worldFeatures())
      .polygonCapColor(() => 'rgba(20,28,37,0.55)')
      .polygonSideColor(() => 'rgba(0,0,0,0)')
      .polygonStrokeColor(() => '#2B3846')
      .polygonAltitude(0.0035)
      .polygonsTransitionDuration(0)
      // markers
      .pointsData([])
      .pointLat('lat')
      .pointLng('lng')
      .pointColor('color')
      .pointAltitude('alt')
      .pointRadius('r')
      .pointResolution(10)
      .pointsMerge(false)
      .pointsTransitionDuration(0)
      .pointLabel(() => '')
      .onPointClick((d) => {
        const c = (d as PointDatum).c;
        useStore.getState().select(c);
      })
      .onPointHover((d) => {
        useStore.getState().setHover(d ? (d as PointDatum).id : null);
        host.style.cursor = d ? 'pointer' : '';
      })
      // arrival pulses
      .ringsData([])
      .ringLat('lat')
      .ringLng('lng')
      .ringColor((d: object) => {
        const r = d as RingDatum;
        return (t: number) => hexA(r.color, Math.max(0, 0.7 * (1 - t)));
      })
      .ringMaxRadius('maxR')
      .ringPropagationSpeed('speed')
      .ringRepeatPeriod(1e9)
      .ringAltitude(0.004)
      // density
      .hexBinPointsData([])
      .hexBinPointLat((d: object) => (d as number[])[0]!)
      .hexBinPointLng((d: object) => (d as number[])[1]!)
      .hexBinPointWeight((d: object) => (d as number[])[2]!)
      .hexBinResolution(3)
      .hexMargin(0.18)
      .hexAltitude((d) => Math.min(0.06, 0.004 + d.sumWeight * 0.0025))
      .hexTopColor((d) => `rgba(242,169,59,${Math.min(0.55, 0.12 + d.sumWeight * 0.035)})`)
      .hexSideColor((d) => `rgba(242,169,59,${Math.min(0.3, 0.05 + d.sumWeight * 0.02)})`)
      .hexTransitionDuration(600)
      .hexLabel(() => '');

    // Lighting: soft, matte.
    const scene = globe.scene();
    scene.children.filter((o) => (o as { isLight?: boolean }).isLight).forEach((l) => ((l as unknown as { intensity: number }).intensity *= 0.9));

    const controls = globe.controls();
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.18;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.55;
    controls.zoomSpeed = 0.7;
    controls.minDistance = 120;
    controls.maxDistance = 900;
    const narrow = host.clientWidth < 768;
    globe.pointOfView({ lat: narrow ? 30 : 28, lng: 18, altitude: narrow ? 3.4 : 2.3 }, 0);
    // Keep the globe above the mobile bottom sheet.
    if (narrow) globe.globeOffset([0, -60]);

    // Idle mode: slow auto-rotation that pauses on any interaction.
    let idleTimer: number | null = null;
    const interact = () => {
      controls.autoRotate = false;
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => {
        if (!useStore.getState().selectedId) controls.autoRotate = true;
      }, IDLE_RESUME_MS);
    };
    host.addEventListener('pointerdown', interact);
    host.addEventListener('wheel', interact, { passive: true });
    host.addEventListener('touchstart', interact, { passive: true });
    window.addEventListener('gw:interact', interact);

    // Double-click to focus a region.
    const onDbl = (e: MouseEvent) => {
      const rect = host.getBoundingClientRect();
      const p = globe.toGlobeCoords(e.clientX - rect.left, e.clientY - rect.top);
      if (!p) return;
      interact();
      globe.pointOfView({ lat: p.lat, lng: p.lng, altitude: Math.max(0.35, globe.pointOfView().altitude * 0.55) }, 900);
    };
    host.addEventListener('dblclick', onDbl);

    // Cursor coordinate readout (throttled to animation frames).
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const rect = host.getBoundingClientRect();
        cursorRef.current(globe.toGlobeCoords(e.clientX - rect.left, e.clientY - rect.top));
      });
    };
    const onLeave = () => cursorRef.current(null);
    host.addEventListener('pointermove', onMove);
    host.addEventListener('pointerleave', onLeave);

    const ro = new ResizeObserver(() => globe.width(host.clientWidth).height(host.clientHeight));
    ro.observe(host);

    // ---- data binding (outside React render for performance) ----
    let rings: RingDatum[] = [];
    const seenArrivals = new Set<string>();
    // Reuse datum objects so the points layer only touches markers whose look actually changed.
    const datums = new Map<string, PointDatum>();
    let lastKey = '';
    const sync = () => {
      const s = useStore.getState();
      const vis = computeVisible(s, maxRef.current);
      const cardIds = new Set(vis.cards.map((c) => c.id));
      const next: PointDatum[] = vis.markers.map((c) => {
        const base = CATEGORY_COLORS[c.category];
        const dim = vis.dimmed.has(c.id);
        const sel = c.id === s.selectedId || c.id === s.hoverId;
        const card = cardIds.has(c.id);
        const r = 0.16 + (c.importance / 100) * 0.42 + Math.min(0.2, Math.log2(c.sourceCount) * 0.06);
        const d: PointDatum = {
          id: c.id,
          lat: c.geo!.lat,
          lng: c.geo!.lon,
          color: sel ? '#F2A93B' : dim ? hexA(base, 0.18) : card ? base : hexA(base, 0.72),
          r: Math.round((sel ? r * 1.3 : r) * 1000) / 1000,
          alt: card || sel ? 0.012 : 0.006,
          c,
        };
        const prev = datums.get(c.id);
        if (prev && prev.lat === d.lat && prev.lng === d.lng && prev.color === d.color && prev.r === d.r && prev.alt === d.alt) {
          prev.c = c;
          return prev;
        }
        datums.set(c.id, d);
        return d;
      });
      const live = new Set(next.map((d) => d.id));
      for (const id of datums.keys()) if (!live.has(id)) datums.delete(id);
      const key = next.map((d) => `${d.id}|${d.color}|${d.r}|${d.alt}`).join(',');
      if (key !== lastKey) {
        lastKey = key;
        globe.pointsData(next);
      }

      // One soft ring pulse per arrival (breaking: amber, slightly wider).
      const now = Date.now();
      for (const [id, t] of Object.entries(s.arrivals)) {
        if (seenArrivals.has(id) || now - t > 2000) continue;
        seenArrivals.add(id);
        const c = s.clusters[id];
        if (!c?.geo || vis.dimmed.has(id)) continue;
        rings.push({ lat: c.geo.lat, lng: c.geo.lon, color: c.breaking ? '#F2A93B' : CATEGORY_COLORS[c.category], born: now, speed: c.breaking ? 2.4 : 1.6, maxR: c.breaking ? 5 : 3.2 });
      }
      rings = rings.filter((r) => now - r.born < 2600);
      globe.ringsData(rings);
    };
    sync();
    const unsub = useStore.subscribe((s, p) => {
      if (s.clusters !== p.clusters || s.settings !== p.settings || s.replay !== p.replay || s.selectedId !== p.selectedId || s.hoverId !== p.hoverId || s.arrivals !== p.arrivals)
        sync();
      if (s.settings.graticule !== p.settings.graticule) globe.showGraticules(s.settings.graticule);
      if (s.selectedId && s.selectedId !== p.selectedId) controls.autoRotate = false;
    });
    const ringGc = setInterval(() => {
      if (rings.length) {
        rings = rings.filter((r) => Date.now() - r.born < 2600);
        globe.ringsData(rings);
      }
    }, 1000);

    // Density layer
    let densityTimer: number | null = null;
    const loadDensity = async () => {
      const s = useStore.getState().settings;
      if (!s.density) {
        globe.hexBinPointsData([]);
        return;
      }
      try {
        const d = await api.density(s.densityHours);
        if (useStore.getState().settings.density) globe.hexBinPointsData(d.points);
      } catch {
        /* keep previous */
      }
    };
    void loadDensity();
    densityTimer = window.setInterval(loadDensity, 120_000);
    const unsubDensity = useStore.subscribe((s, p) => {
      if (s.settings.density !== p.settings.density || s.settings.densityHours !== p.settings.densityHours) void loadDensity();
    });

    // Pause rendering when the tab is hidden.
    const onVis = () => (document.hidden ? globe.pauseAnimation() : globe.resumeAnimation());
    document.addEventListener('visibilitychange', onVis);

    return () => {
      unsub();
      unsubDensity();
      clearInterval(ringGc);
      if (densityTimer) clearInterval(densityTimer);
      if (idleTimer) clearTimeout(idleTimer);
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('gw:interact', interact);
      globe._destructor();
      globeRef.current = null;
      host.innerHTML = '';
    };
  }, []);

  return <div ref={el} className="absolute inset-0" />;
}
