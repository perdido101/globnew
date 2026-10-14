import { describe, expect, it } from 'vitest';
import { ttlFor } from '../src/flow/engine.js';
import { importance, type ScoreInput } from '../src/pipeline/score.js';

const base: ScoreInput = { outletCount: 1, leadWeight: 0.8, maxVelocity: 0, breaking: false, category: 'politics', ageMs: 0 };

describe('importance scoring', () => {
  it('stays within 0..100', () => {
    expect(importance({ ...base, outletCount: 50, leadWeight: 1, maxVelocity: 1e6, breaking: true, category: 'conflict' })).toBeLessThanOrEqual(100);
    expect(importance({ ...base, leadWeight: 0, category: 'sports', ageMs: 1e9 })).toBeGreaterThanOrEqual(0);
  });

  it('rises with more outlets, breaking, velocity and weight', () => {
    const s = importance(base);
    expect(importance({ ...base, outletCount: 6 })).toBeGreaterThan(s);
    expect(importance({ ...base, breaking: true })).toBeGreaterThan(s);
    expect(importance({ ...base, maxVelocity: 20 })).toBeGreaterThan(s);
    expect(importance({ ...base, leadWeight: 1 })).toBeGreaterThan(s);
  });

  it('decays with age and weighs categories', () => {
    expect(importance({ ...base, ageMs: 6 * 3600_000 })).toBeLessThan(importance(base));
    expect(importance({ ...base, category: 'conflict' })).toBeGreaterThan(importance({ ...base, category: 'sports' }));
  });

  it('discounts clusters made only of unverified sources', () => {
    expect(importance({ ...base, unverifiedOnly: true })).toBeLessThan(importance(base));
  });

  it('blends an LLM importance hint', () => {
    expect(importance({ ...base, llmImportance: 95 })).toBeGreaterThan(importance({ ...base, llmImportance: 10 }));
  });

  it('scales decay TTL with importance', () => {
    expect(ttlFor(90)).toBeGreaterThan(ttlFor(20));
  });
});
