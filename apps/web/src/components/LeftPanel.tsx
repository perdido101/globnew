import { CATEGORIES, CATEGORY_COLORS, CATEGORY_LABELS, REGIONS, SOURCE_TYPES, type SourceType } from '@gw/shared';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import { DEMO } from '../lib/demo';
import { DEFAULT_SETTINGS } from '../store/settings';
import { useStore } from '../store/useStore';

function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="border-b border-line px-3 py-3">
      <div className="mb-2 flex items-center">
        <h3 className="micro">{title}</h3>
        <div className="ml-auto">{right}</div>
      </div>
      {children}
    </section>
  );
}

function Toggle({ on, onClick, children, color }: { on: boolean; onClick: () => void; children: ReactNode; color?: string }) {
  return (
    <button onClick={onClick} className={`flex w-full items-center gap-2 py-[3px] text-left text-[12px] ${on ? 'text-fg' : 'text-dim'}`}>
      <span
        className={`flex h-3 w-3 shrink-0 items-center justify-center rounded-[2px] border ${on ? 'border-mut' : 'border-line-2'}`}
        style={on && color ? { background: color, borderColor: color } : undefined}
      >
        {on && !color && <span className="h-1.5 w-1.5 rounded-[1px] bg-fg" />}
      </span>
      {children}
    </button>
  );
}

const TYPE_LABEL: Record<SourceType, string> = { news: 'News outlets', gdelt: 'GDELT', reddit: 'Reddit', telegram: 'Telegram (unverified)' };

export function LeftPanel() {
  const s = useStore((st) => st.settings);
  const patch = useStore((st) => st.patchSettings);
  const [outlets, setOutlets] = useState<{ outlet: string; sourceType: string; count: number }[]>([]);
  const [outletQ, setOutletQ] = useState('');

  useEffect(() => {
    const load = () => api.outlets().then(setOutlets).catch(() => {});
    void load();
    const t = setInterval(load, 120_000);
    return () => clearInterval(t);
  }, []);

  const toggle = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const shownOutlets = useMemo(() => {
    const q = outletQ.toLowerCase();
    const list = outlets.filter((o) => !q || o.outlet.toLowerCase().includes(q));
    const muted = list.filter((o) => s.mutedOutlets.includes(o.outlet));
    const rest = list.filter((o) => !s.mutedOutlets.includes(o.outlet));
    return [...muted, ...rest].slice(0, 80);
  }, [outlets, outletQ, s.mutedOutlets]);

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="flex items-center border-b border-line px-3 py-2.5">
        <h2 className="micro text-fg/80">Layers &amp; Filters</h2>
        <button className="mono ml-auto text-[10px] text-dim hover:text-fg" onClick={() => patch({ ...DEFAULT_SETTINGS, pins: s.pins, leftOpen: s.leftOpen, rightOpen: s.rightOpen })}>
          RESET
        </button>
      </div>

      <Section title="Sources">
        {SOURCE_TYPES.map((t) => (
          <Toggle key={t} on={s.sourceTypes.includes(t)} onClick={() => patch({ sourceTypes: toggle(s.sourceTypes, t) })}>
            {TYPE_LABEL[t]}
          </Toggle>
        ))}
      </Section>

      <Section
        title="Categories"
        right={
          <button className="mono text-[10px] text-dim hover:text-fg" onClick={() => patch({ categories: s.categories.length === CATEGORIES.length ? [] : [...CATEGORIES] })}>
            {s.categories.length === CATEGORIES.length ? 'NONE' : 'ALL'}
          </button>
        }
      >
        {CATEGORIES.map((c) => (
          <Toggle key={c} on={s.categories.includes(c)} color={CATEGORY_COLORS[c]} onClick={() => patch({ categories: toggle(s.categories, c) })}>
            {CATEGORY_LABELS[c]}
          </Toggle>
        ))}
      </Section>

      <Section title="Importance threshold" right={<span className="mono text-[11px] text-fg">{s.minImportance}</span>}>
        <input type="range" min={0} max={90} step={5} value={s.minImportance} onChange={(e) => patch({ minImportance: Number(e.target.value) })} className="w-full" />
      </Section>

      <Section title="Time window">
        <div className="grid grid-cols-5 gap-1">
          {[1, 3, 6, 12, 24].map((h) => (
            <button
              key={h}
              onClick={() => patch({ timeWindowH: h })}
              className={`mono rounded-[2px] border py-1 text-[11px] ${s.timeWindowH === h ? 'border-amber/60 text-amber' : 'border-line text-mut hover:text-fg'}`}
            >
              {h}h
            </button>
          ))}
        </div>
      </Section>

      <Section title="Layers">
        <Toggle on={s.density} onClick={() => patch({ density: !s.density })}>
          Activity density <span className="mono ml-auto text-[10px] text-dim">{s.densityHours}h</span>
        </Toggle>
        {s.density && (
          <input type="range" min={1} max={48} step={1} value={s.densityHours} onChange={(e) => patch({ densityHours: Number(e.target.value) })} className="mt-1 w-full" />
        )}
        <Toggle on={s.graticule} onClick={() => patch({ graticule: !s.graticule })}>
          Graticule
        </Toggle>
        <Toggle on={s.includeGlobal} onClick={() => patch({ includeGlobal: !s.includeGlobal })}>
          Global lane (no location)
        </Toggle>
      </Section>

      <Section title="Flow cadence" right={<span className="mono text-[11px] text-fg">{s.cadenceSec.toFixed(1)}s</span>}>
        <input type="range" min={1.5} max={20} step={0.5} value={s.cadenceSec} onChange={(e) => patch({ cadenceSec: Number(e.target.value) })} className="w-full" />
      </Section>

      <Section title="Muted regions">
        {REGIONS.map((r) => (
          <Toggle key={r.key} on={s.mutedRegions.includes(r.key)} onClick={() => patch({ mutedRegions: toggle(s.mutedRegions, r.key) })}>
            {r.label}
          </Toggle>
        ))}
      </Section>

      <Section title="Outlets" right={<span className="mono text-[10px] text-dim">{s.mutedOutlets.length} muted</span>}>
        <input
          value={outletQ}
          onChange={(e) => setOutletQ(e.target.value)}
          placeholder="Filter outlets"
          className="mono mb-2 w-full rounded-[2px] border border-line bg-transparent px-2 py-1 text-[11px] text-fg outline-none placeholder:text-dim focus:border-line-2"
        />
        {shownOutlets.map((o) => {
          const muted = s.mutedOutlets.includes(o.outlet);
          return (
            <button key={o.outlet} onClick={() => patch({ mutedOutlets: toggle(s.mutedOutlets, o.outlet) })} className="flex w-full items-center gap-2 py-[3px] text-left text-[11.5px]">
              <span className={`truncate ${muted ? 'text-dim line-through' : 'text-fg/85'}`}>{o.outlet}</span>
              <span className="mono ml-auto shrink-0 text-[10px] text-dim">{o.count || ''}</span>
              <span className={`mono shrink-0 text-[9.5px] ${muted ? 'text-amber' : 'text-dim'}`}>{muted ? 'MUTED' : 'MUTE'}</span>
            </button>
          );
        })}
      </Section>

      <div className="px-3 py-3">
        {DEMO ? (
          <a href="https://github.com/perdido101/globnew" target="_blank" rel="noreferrer" className="mono text-[10.5px] text-dim hover:text-fg">
            RECORDED DEMO · RUN THE LIVE APP ↗
          </a>
        ) : (
        <a href="/admin/sources" target="_blank" rel="noreferrer" className="mono text-[10.5px] text-dim hover:text-fg">
          SOURCE HEALTH ↗
        </a>
        )}
      </div>
    </div>
  );
}
