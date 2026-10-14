/** Screen-space placement for floating cards. Pure functions so they can be unit-reasoned and kept cheap per frame. */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Anchor {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  priority: number;
}

export interface Placement {
  id: string;
  /** leader length (px, upward) */
  L: number;
  side: 1 | -1;
  rect: Rect;
}

/** Candidate (leader length, side) pairs, in preference order. */
export const CANDIDATES: [number, 1 | -1][] = [
  [58, 1],
  [58, -1],
  [100, 1],
  [100, -1],
  [142, 1],
  [142, -1],
  [32, 1],
  [32, -1],
  [184, 1],
  [184, -1],
];

const PAD = 6;

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w + PAD && a.x + a.w + PAD > b.x && a.y < b.y + b.h + PAD && a.y + a.h + PAD > b.y;
}

export function rectFor(a: Anchor, L: number, side: 1 | -1): Rect {
  return { x: side === 1 ? a.x - 1 : a.x - a.w + 1, y: a.y - L - a.h, w: a.w, h: a.h };
}

/**
 * Greedy placement by priority. `prev` gives hysteresis: a card keeps its last slot while it still fits,
 * so cards don't jump around as the globe rotates. Markers themselves are treated as small obstacles.
 */
export function placeCards(anchors: Anchor[], bounds: Rect, prev: Map<string, number>, markers: { x: number; y: number }[]): Placement[] {
  const placed: Placement[] = [];
  const obstacles: Rect[] = markers.map((m) => ({ x: m.x - 5, y: m.y - 5, w: 10, h: 10 }));
  const sorted = [...anchors].sort((a, b) => b.priority - a.priority);
  for (const a of sorted) {
    const order = prev.has(a.id) ? [prev.get(a.id)!, ...CANDIDATES.map((_, i) => i).filter((i) => i !== prev.get(a.id))] : CANDIDATES.map((_, i) => i);
    for (const idx of order) {
      const [L, side] = CANDIDATES[idx]!;
      const r = rectFor(a, L, side);
      if (r.x < bounds.x || r.y < bounds.y || r.x + r.w > bounds.x + bounds.w || r.y + r.h > bounds.y + bounds.h) continue;
      if (placed.some((p) => overlaps(p.rect, r))) continue;
      if (obstacles.some((o) => overlaps(o, r) && !(Math.abs(o.x + 5 - a.x) < 1 && Math.abs(o.y + 5 - a.y) < 1))) continue;
      placed.push({ id: a.id, L, side, rect: r });
      prev.set(a.id, idx);
      break;
    }
  }
  return placed;
}

export interface Group {
  ids: string[];
  x: number;
  y: number;
}

/** Collapse markers closer than `radius` px into groups (leader = highest priority). */
export function groupNearby(points: { id: string; x: number; y: number; priority: number }[], radius: number): Group[] {
  const sorted = [...points].sort((a, b) => b.priority - a.priority);
  const used = new Set<string>();
  const groups: Group[] = [];
  for (const p of sorted) {
    if (used.has(p.id)) continue;
    used.add(p.id);
    const members = [p];
    for (const q of sorted) {
      if (used.has(q.id)) continue;
      if ((q.x - p.x) ** 2 + (q.y - p.y) ** 2 <= radius * radius) {
        used.add(q.id);
        members.push(q);
      }
    }
    groups.push({ ids: members.map((m) => m.id), x: members.reduce((s, m) => s + m.x, 0) / members.length, y: members.reduce((s, m) => s + m.y, 0) / members.length });
  }
  return groups;
}
