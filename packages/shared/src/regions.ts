/** Region presets used for camera presets, focus mode and muting. Bounding boxes are [minLat, minLon, maxLat, maxLon]. */
export interface RegionDef {
  key: string;
  label: string;
  boxes: [number, number, number, number][];
  view: { lat: number; lng: number; altitude: number };
}

export const REGIONS: RegionDef[] = [
  { key: 'europe', label: 'Europe', boxes: [[34, -25, 72, 45]], view: { lat: 50, lng: 14, altitude: 1.35 } },
  { key: 'middle-east', label: 'Middle East', boxes: [[12, 25, 42, 63]], view: { lat: 29, lng: 44, altitude: 1.25 } },
  { key: 'east-asia', label: 'East Asia', boxes: [[-11, 95, 54, 150]], view: { lat: 30, lng: 118, altitude: 1.5 } },
  { key: 'south-asia', label: 'South Asia', boxes: [[5, 60, 38, 97]], view: { lat: 22, lng: 79, altitude: 1.35 } },
  { key: 'americas', label: 'Americas', boxes: [[-56, -170, 72, -30]], view: { lat: 15, lng: -80, altitude: 2.3 } },
  { key: 'africa', label: 'Africa', boxes: [[-36, -20, 37, 52]], view: { lat: 3, lng: 18, altitude: 1.8 } },
  { key: 'oceania', label: 'Oceania', boxes: [[-50, 110, 0, 180]], view: { lat: -25, lng: 140, altitude: 1.6 } },
  { key: 'greece', label: 'Greece', boxes: [[34.5, 19, 42, 30]], view: { lat: 38.5, lng: 23.7, altitude: 0.45 } },
];

export function regionByKey(key: string | null | undefined): RegionDef | undefined {
  return key ? REGIONS.find((r) => r.key === key) : undefined;
}

export function inRegion(region: RegionDef, lat: number, lon: number): boolean {
  return region.boxes.some(([a, b, c, d]) => lat >= a && lat <= c && lon >= b && lon <= d);
}
