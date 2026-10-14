import type { Item, StreamEvent } from '@gw/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../src/config.js';
import { FlowEngine } from '../src/flow/engine.js';
import { Store } from '../src/flow/store.js';

let n = 0;
const geo = (lat: number, lon: number) => ({ place: 'X', country: 'XX', lat, lon, precision: 'city' as const, confidence: 0.9, method: 'gazetteer' as const });
function item(title: string, extra: Partial<Item> = {}): Item {
  n++;
  const now = new Date().toISOString();
  return { id: `f${n}`, sourceId: 's', sourceType: 'news', outlet: `Outlet${n}`, url: `https://e.com/${n}`, title, snippet: '', publishedAt: now, firstSeenAt: now, verified: true, weight: 0.8, category: 'politics', geo: geo(48, 2), ...extra };
}
const stats = () => ({ itemsLastHour: 0, clustersLastHour: 0, totalClusters: 0, queued: 0, sourcesOk: 0, sourcesTotal: 0, llmEnabled: false, serverTime: '' });

describe('release flow', () => {
  let store: Store;
  let flow: FlowEngine;
  let events: StreamEvent[];
  beforeEach(() => {
    vi.useFakeTimers();
    store = new Store();
    events = [];
  });
  afterEach(() => {
    flow?.stop();
    vi.useRealTimers();
  });

  const titles = ['Alpha summit opens in capital', 'Bridge collapse injures commuters', 'Port workers begin strike', 'Museum unveils ancient artefacts', 'Ferry service suspended by storms', 'Court overturns mining permit'];

  it('seeds new sessions, then releases one story per tick — never a flood', () => {
    for (const t of titles) store.addItem(item(t), { silent: true });
    const seed = config.flow.initialSeed;
    config.flow.initialSeed = 2;
    flow = new FlowEngine(store, stats);
    flow.connect(null, {}, (e) => events.push(e));
    config.flow.initialSeed = seed;
    const init = events[0];
    expect(init?.type).toBe('init');
    expect(init?.type === 'init' && init.clusters.length).toBe(2);
    vi.advanceTimersByTime(config.flow.cadenceMs * (1 + config.flow.jitter) + 10);
    expect(events.filter((e) => e.type === 'release')).toHaveLength(1);
    vi.advanceTimersByTime(config.flow.cadenceMs * 3 * (1 + config.flow.jitter));
    const rel = events.filter((e) => e.type === 'release');
    expect(rel.length).toBeGreaterThanOrEqual(2);
    expect(rel.length).toBeLessThanOrEqual(4);
    expect(new Set(rel.map((e) => e.type === 'release' && e.cluster.id)).size).toBe(rel.length);
  });

  it('updates a released card in place when its cluster grows', () => {
    store.addItem(item('Volcano erupts in Iceland forcing evacuations'), { silent: true });
    flow = new FlowEngine(store, stats);
    flow.connect(null, {}, (e) => events.push(e));
    store.addItem(item('Iceland volcano erupts, evacuations ordered'));
    const upd = events.filter((e) => e.type === 'update');
    expect(upd).toHaveLength(1);
    expect(upd[0]?.type === 'update' && upd[0].cluster.sourceCount).toBe(2);
    expect(events.filter((e) => e.type === 'release')).toHaveLength(0);
  });

  it('lets breaking, high-score stories jump the queue', () => {
    flow = new FlowEngine(store, stats);
    flow.connect(null, {}, (e) => events.push(e));
    vi.advanceTimersByTime(2000);
    store.addItem(item('BREAKING: Missile strike hits city centre', { breaking: true, category: 'conflict', weight: 1 }));
    expect(events.some((e) => e.type === 'release')).toBe(true);
  });

  it('focus mode only releases stories inside the region; pause stops the flow', () => {
    store.addItem(item('Athens metro strike halts trains', { geo: geo(37.98, 23.72) }), { silent: true });
    store.addItem(item('Lima protests over pension reform', { geo: geo(-12.04, -77.03) }), { silent: true });
    config.flow.initialSeed = 0;
    flow = new FlowEngine(store, stats);
    const id = flow.connect(null, { focusRegion: 'europe' }, (e) => events.push(e));
    vi.advanceTimersByTime(config.flow.cadenceMs * 6);
    const rel = events.filter((e) => e.type === 'release');
    expect(rel).toHaveLength(1);
    expect(rel[0]?.type === 'release' && rel[0].cluster.title).toContain('Athens');
    flow.setFilters(id, { paused: true });
    store.addItem(item('Madrid hosts climate talks', { geo: geo(40.4, -3.7) }), { silent: true });
    vi.advanceTimersByTime(config.flow.cadenceMs * 6);
    expect(events.filter((e) => e.type === 'release')).toHaveLength(1);
    config.flow.initialSeed = 14;
  });
});
