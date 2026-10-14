import type { GeoLocation } from '@gw/shared';
import { useMemo } from 'react';
import type { Position } from 'geojson';
import { worldFeatures } from '../lib/world';

/** Small equirectangular map snippet around a location (no tiles, no network). */
export function MiniMap({ geo, width = 320, height = 150 }: { geo: GeoLocation; width?: number; height?: number }) {
  const span = geo.precision === 'city' ? 9 : geo.precision === 'region' ? 14 : 26;
  const lonSpan = span * (width / height) / Math.max(0.35, Math.cos((geo.lat * Math.PI) / 180));
  const x0 = geo.lon - lonSpan / 2;
  const y0 = geo.lat + span / 2;
  const sx = width / lonSpan;
  const sy = height / span;
  const path = useMemo(() => {
    const proj = ([lon, lat]: Position) => `${((lon! - x0) * sx).toFixed(1)},${((y0 - lat!) * sy).toFixed(1)}`;
    const ringPath = (ring: Position[]) => 'M' + ring.map(proj).join('L') + 'Z';
    const parts: string[] = [];
    for (const f of worldFeatures()) {
      const g = f.geometry;
      if (g.type === 'Polygon') parts.push(g.coordinates.map(ringPath).join(''));
      else if (g.type === 'MultiPolygon') parts.push(g.coordinates.map((p) => p.map(ringPath).join('')).join(''));
    }
    return parts.join('');
  }, [x0, y0, sx, sy]);
  const cx = (geo.lon - x0) * sx;
  const cy = (y0 - geo.lat) * sy;
  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} className="block rounded-[2px] border border-line bg-[#0C1117]">
      <defs>
        <pattern id="mm-grid" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M20 0H0V20" fill="none" stroke="#151C25" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width={width} height={height} fill="url(#mm-grid)" />
      <path d={path} fill="#151D27" stroke="#2B3846" strokeWidth={0.8} />
      <circle cx={cx} cy={cy} r={geo.precision === 'country' ? 18 : geo.precision === 'region' ? 11 : 6} fill="none" stroke="#F2A93B" strokeOpacity={0.35} />
      <circle cx={cx} cy={cy} r={2.6} fill="#F2A93B" />
      <path d={`M${cx - 12},${cy}H${cx - 5}M${cx + 5},${cy}H${cx + 12}M${cx},${cy - 12}V${cy - 5}M${cx},${cy + 5}V${cy + 12}`} stroke="#F2A93B" strokeWidth={0.8} />
    </svg>
  );
}
