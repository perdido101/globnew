import type { Feature, FeatureCollection, Geometry } from 'geojson';
import { feature } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import countries110 from 'world-atlas/countries-110m.json';

let cache: Feature<Geometry, { name: string }>[] | null = null;

/** Natural Earth 1:110m country outlines (bundled, no network). */
export function worldFeatures(): Feature<Geometry, { name: string }>[] {
  if (!cache) {
    const topo = countries110 as unknown as Topology;
    const fc = feature(topo, topo.objects.countries!) as unknown as FeatureCollection<Geometry, { name: string }>;
    cache = fc.features;
  }
  return cache;
}
