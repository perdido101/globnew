import type { GlobeInstance } from 'globe.gl';

/** The single globe instance, shared with overlays and controls that need to move the camera. */
export const globeRef: { current: GlobeInstance | null } = { current: null };

export function flyTo(lat: number, lng: number, altitude?: number, ms = 1400): void {
  const g = globeRef.current;
  if (!g) return;
  const alt = altitude ?? Math.min(g.pointOfView().altitude, 1.8);
  g.pointOfView({ lat, lng, altitude: alt }, ms);
}
