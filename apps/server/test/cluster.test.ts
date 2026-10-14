import type { Item } from '@gw/shared';
import { describe, expect, it } from 'vitest';
import { Store } from '../src/flow/store.js';
import { similarity, tokenSet } from '../src/pipeline/cluster.js';

let n = 0;
function item(title: string, outlet: string, extra: Partial<Item> = {}): Item {
  n++;
  const now = new Date().toISOString();
  return {
    id: `i${n}`,
    sourceId: outlet,
    sourceType: 'news',
    outlet,
    url: `https://example.com/${n}`,
    title,
    snippet: '',
    publishedAt: now,
    firstSeenAt: now,
    verified: true,
    weight: 0.8,
    category: 'conflict',
    ...extra,
  };
}

const athens = { place: 'Athens', country: 'GR', lat: 37.98, lon: 23.72, precision: 'city' as const, confidence: 0.9, method: 'gazetteer' as const };
const lima = { place: 'Lima', country: 'PE', lat: -12.04, lon: -77.03, precision: 'city' as const, confidence: 0.9, method: 'gazetteer' as const };

describe('title similarity', () => {
  it('scores rewrites of the same headline high and unrelated headlines low', () => {
    const a = tokenSet("World's oldest shipwreck found off coast of Turkey");
    const b = tokenSet("World's oldest known shipwreck found in Turkiye");
    const c = tokenSet('Central bank holds interest rates steady');
    expect(similarity(a, b)).toBeGreaterThan(0.42);
    expect(similarity(a, c)).toBe(0);
  });
});

describe('dedupe & clustering', () => {
  it('collapses the same story from several outlets into one cluster with a count', () => {
    const s = new Store();
    s.addItem(item("World's oldest shipwreck found off coast of Turkey", 'BBC'));
    s.addItem(item("World's oldest shipwreck discovered off Turkey's Mediterranean coast", 'Euronews'));
    s.addItem(item("World's oldest known shipwreck found off coast of Turkiye", 'Al Jazeera'));
    expect(s.clusters.size).toBe(1);
    const c = [...s.clusters.values()][0]!;
    expect(c.outletCount).toBe(3);
    expect(s.view(c).sources).toHaveLength(3);
  });

  it('keeps different stories apart', () => {
    const s = new Store();
    s.addItem(item('Earthquake of magnitude 6 strikes near Athens', 'A', { geo: athens }));
    s.addItem(item('Central bank raises interest rates again', 'B'));
    expect(s.clusters.size).toBe(2);
  });

  it('does not merge similar wording about far-apart places', () => {
    const s = new Store();
    s.addItem(item('Strong earthquake strikes, buildings damaged', 'A', { geo: athens }));
    s.addItem(item('Strong earthquake strikes, buildings damaged', 'B', { geo: lima }));
    expect(s.clusters.size).toBe(2);
  });

  it('merges items with the same URL (e.g. a Reddit post linking to an outlet article)', () => {
    const s = new Store();
    const a = item('Government collapses after no-confidence vote', 'Outlet');
    s.addItem(a);
    s.addItem(item('PM ousted in parliament vote', 'reddit', { url: a.url, sourceType: 'reddit', subreddit: 'europe', weight: 0.5, id: 'r1' }));
    expect(s.clusters.size).toBe(1);
    const v = s.view([...s.clusters.values()][0]!);
    expect(v.outlet).toBe('Outlet'); // lead = highest-weight outlet
    expect(v.subreddit).toBe('europe');
  });

  it('emits "grew" when a new outlet joins a cluster', () => {
    const s = new Store();
    const kinds: string[] = [];
    s.on('change', (ch) => kinds.push(ch.kind));
    s.addItem(item('Volcano erupts in Iceland forcing evacuations', 'A'));
    s.addItem(item('Iceland volcano erupts, evacuations ordered', 'B'));
    expect(kinds).toEqual(['new', 'grew']);
  });
});
