import { Rng } from '@bollwerk/sim';
import { describe, expect, it } from 'vitest';

import { circuitTraces } from './cyberpunk.js';

/** Distance to a square island in the middle of a 30x20 sea, as `seaDepth` measures it. */
function depthAround(): { depth: Float32Array; w: number; h: number } {
  const w = 30;
  const h = 20;
  const depth = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = Math.max(0, 10 - x, x - 19);
      const dy = Math.max(0, 6 - y, y - 13);
      depth[y * w + x] = Math.min(6, Math.sqrt(dx * dx + dy * dy));
    }
  }
  return { depth, w, h };
}

describe('circuit traces', () => {
  const { depth, w, h } = depthAround();
  const traces = circuitTraces(depth, w, h, 2, 3, 40, new Rng(7));

  it('lays traces, each a run of single steps in the eight directions', () => {
    expect(traces.length).toBeGreaterThan(10);
    for (const trace of traces) {
      expect(trace.points.length).toBeGreaterThanOrEqual(3);
      for (let k = 1; k < trace.points.length; k++) {
        const dx = trace.points[k]!.x - trace.points[k - 1]!.x;
        const dy = trace.points[k]!.y - trace.points[k - 1]!.y;
        expect(Math.max(Math.abs(dx), Math.abs(dy))).toBe(1);
      }
    }
  });

  it('keeps clear of the coast, so the islands sit in open water', () => {
    for (const trace of traces) for (const d of trace.depth) expect(d).toBeGreaterThanOrEqual(1.5);
  });

  it('never runs two traces through one tile', () => {
    const seen = new Set<string>();
    for (const trace of traces) {
      for (const p of trace.points) {
        const key = `${p.x},${p.y}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }
  });

  it('gives board coordinates, with the margin taken off', () => {
    const xs = traces.flatMap((t) => t.points.map((p) => p.x));
    const ys = traces.flatMap((t) => t.points.map((p) => p.y));
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(-2);
    expect(Math.max(...xs)).toBeLessThan(w - 2);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(-3);
  });

  it('lays the same board for the same seed', () => {
    expect(circuitTraces(depth, w, h, 2, 3, 40, new Rng(7))).toEqual(traces);
    expect(circuitTraces(depth, w, h, 2, 3, 40, new Rng(8))).not.toEqual(traces);
  });
});
