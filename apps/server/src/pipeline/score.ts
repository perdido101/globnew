import type { Category } from '@gw/shared';
import { config } from '../config.js';

export interface ScoreInput {
  outletCount: number;
  leadWeight: number;
  maxVelocity: number;
  breaking: boolean;
  category: Category;
  /** ms since the newest item in the cluster was published */
  ageMs: number;
  /** optional LLM importance hint 0..100 */
  llmImportance?: number | null;
  /** all members unverified (telegram only) */
  unverifiedOnly?: boolean;
}

export function scoreComponents(i: ScoreInput) {
  const s = config.score;
  return {
    outlets: Math.min(1, Math.log2(1 + Math.max(1, i.outletCount)) / Math.log2(1 + 8)),
    source: Math.max(0, Math.min(1, i.leadWeight)),
    velocity: Math.min(1, i.maxVelocity / s.velocitySaturation),
    breaking: i.breaking ? 1 : 0,
    category: s.categoryWeights[i.category] ?? 0.5,
    recency: Math.exp((-Math.LN2 * Math.max(0, i.ageMs)) / (s.recencyHalfLifeMin * 60_000)),
  };
}

/** Importance 0..100. */
export function importance(i: ScoreInput): number {
  const w = config.score.weights;
  const c = scoreComponents(i);
  const total = w.outlets + w.source + w.velocity + w.breaking + w.category + w.recency;
  let score =
    (100 *
      (w.outlets * c.outlets + w.source * c.source + w.velocity * c.velocity + w.breaking * c.breaking + w.category * c.category + w.recency * c.recency)) /
    total;
  if (i.llmImportance != null) score = 0.6 * score + 0.4 * i.llmImportance * (0.5 + 0.5 * c.recency);
  if (i.unverifiedOnly) score *= 0.85;
  return Math.round(Math.max(0, Math.min(100, score)) * 10) / 10;
}
