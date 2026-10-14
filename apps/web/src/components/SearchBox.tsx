import type { ClusterView } from '@gw/shared';
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { flyTo } from '../lib/globeRef';
import { useStore } from '../store/useStore';
import { LocationTag, RelTime, SourceBadge } from './Badges';
import { IconSearch } from './icons';

export function SearchBox() {
  const open = useStore((s) => s.searchOpen);
  const setOpen = useStore((s) => s.setSearchOpen);
  const select = useStore((s) => s.select);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<ClusterView[]>([]);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      api
        .search(q)
        .then((r) => {
          setResults(r);
          setActive(0);
        })
        .catch(() => setResults([]));
    }, 180);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open, setOpen]);

  const choose = (c: ClusterView) => {
    select(c);
    if (c.geo) flyTo(c.geo.lat, c.geo.lon, 1.4);
    setOpen(false);
  };

  return (
    <div ref={box} className="relative">
      <div className={`flex h-7 items-center gap-1.5 rounded-[2px] border px-2 ${open ? 'w-56 border-line-2 sm:w-72' : 'w-7 border-line sm:w-40'} transition-[width] duration-300`}>
        <span className="text-mut">
          <IconSearch />
        </span>
        <input
          ref={input}
          value={q}
          onFocus={() => setOpen(true)}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setOpen(false);
              input.current?.blur();
            } else if (e.key === 'ArrowDown') setActive((a) => Math.min(results.length - 1, a + 1));
            else if (e.key === 'ArrowUp') setActive((a) => Math.max(0, a - 1));
            else if (e.key === 'Enter' && results[active]) choose(results[active]!);
          }}
          placeholder="Search  /"
          className="mono w-full min-w-0 bg-transparent text-[11.5px] text-fg outline-none placeholder:text-dim"
        />
      </div>
      {open && results.length > 0 && (
        <div className="scroll-thin absolute right-0 top-8 z-50 max-h-[60vh] w-[min(420px,90vw)] overflow-y-auto rounded-[2px] border border-line bg-panel">
          {results.map((c, i) => (
            <button
              key={c.id}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(c)}
              className={`block w-full border-b border-line px-3 py-2 text-left last:border-0 ${i === active ? 'bg-panel-2' : ''}`}
            >
              <div className="flex items-center gap-2 text-[10.5px] text-mut">
                <span className="truncate">{c.outlet}</span>
                <SourceBadge type={c.sourceType} />
                <RelTime iso={c.firstSeenAt} className="ml-auto text-dim" />
              </div>
              <div className="mt-0.5 line-clamp-2 text-[12px] text-fg">{c.title}</div>
              <LocationTag place={c.geo?.place} country={c.geo?.country} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
