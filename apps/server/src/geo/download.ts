import fs from 'node:fs';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { config } from '../config.js';
import { httpFetch } from '../http/fetch.js';
import { fromServerRoot } from '../paths.js';

const BASE = 'https://download.geonames.org/export/dump/';
const FILES = ['countryInfo.txt', 'admin1CodesASCII.txt'];

export function geoDataDir(): string {
  return fromServerRoot(config.geo.dataDir);
}

export function geoDataPresent(): boolean {
  const dir = geoDataDir();
  return ['cities15000.txt', ...FILES].every((f) => fs.existsSync(path.join(dir, f)));
}

/** Downloads the GeoNames gazetteer (cities ≥15k, countries, admin-1 regions). ~3 MB zipped. */
export async function downloadGeoData(): Promise<void> {
  const dir = geoDataDir();
  fs.mkdirSync(dir, { recursive: true });
  for (const f of FILES) {
    const res = await httpFetch(BASE + f, { checkRobots: false, timeoutMs: 60_000 });
    fs.writeFileSync(path.join(dir, f), Buffer.from(await res.arrayBuffer()));
  }
  const res = await httpFetch(BASE + 'cities15000.zip', { checkRobots: false, timeoutMs: 120_000 });
  const zip = unzipSync(new Uint8Array(await res.arrayBuffer()));
  const txt = zip['cities15000.txt'];
  if (!txt) throw new Error('cities15000.txt missing from archive');
  fs.writeFileSync(path.join(dir, 'cities15000.txt'), txt);
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  downloadGeoData()
    .then(() => console.log(`GeoNames data written to ${geoDataDir()}`))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
