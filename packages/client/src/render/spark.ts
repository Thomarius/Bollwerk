import type { Graphics } from 'pixi.js';

/*
 * Electric's lightning, drawn by its theme, its sea life and its finish alike: a jagged arc
 * between two points, a forked bolt, and a ball of lightning. Cosmetic, so drawn from any
 * random source; an arc is drawn afresh each frame it shows, which is what makes it crackle.
 */

/** The white of an arc's core, and the cool halo round it: the storm's, never a player's. */
export const ARC_WHITE = 0xf4f8ff;
export const ARC_HALO = 0xa8c4ff;
export const COPPER = 0xc87a3e;
export const COPPER_DARK = 0x7a4420;
export const BRASS = 0xd8b060;

/**
 * Points of a jagged arc from (x0, y0) to (x1, y1) in `n` steps, each pushed aside by up to
 * `amp` pixels at right angles, least at its ends: flat, x and y by turns.
 */
export function jag(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  n: number,
  amp: number,
  rand: () => number = Math.random,
): number[] {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const length = Math.hypot(dx, dy) || 1;
  const nx = -dy / length;
  const ny = dx / length;
  const out = [x0, y0];
  for (let k = 1; k < n; k++) {
    const f = k / n;
    const push = (rand() - 0.5) * 2 * amp * Math.sin(f * Math.PI);
    out.push(x0 + dx * f + nx * push, y0 + dy * f + ny * push);
  }
  out.push(x1, y1);
  return out;
}

/** Strokes a set of points as one line, straight segment to straight segment. */
export function line(g: Graphics, points: readonly number[]): void {
  g.moveTo(points[0]!, points[1]!);
  for (let i = 2; i < points.length; i += 2) g.lineTo(points[i]!, points[i + 1]!);
}

/**
 * An arc as lightning is drawn: a white core inside a band of `colour`, and — in `glow`, an
 * added layer, where given — a wide soft halo. `width` is the core's.
 */
export function drawArc(
  g: Graphics,
  glow: Graphics | null,
  points: readonly number[],
  colour: number,
  width: number,
  alpha = 1,
): void {
  if (glow !== null) {
    line(glow, points);
    glow.stroke({ width: width * 6, color: colour, alpha: 0.18 * alpha });
  }
  line(g, points);
  g.stroke({ width: width * 2.6, color: colour, alpha: 0.75 * alpha });
  line(g, points);
  g.stroke({ width, color: ARC_WHITE, alpha });
}

/**
 * A forked bolt: the main arc from (x0, y0) to (x1, y1), and a branch or two breaking off it
 * part-way, shorter and fainter.
 */
export function drawBolt(
  g: Graphics,
  glow: Graphics | null,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  colour: number,
  width: number,
  alpha = 1,
  rand: () => number = Math.random,
): void {
  const length = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.max(4, Math.round(length / (width * 7)));
  const main = jag(x0, y0, x1, y1, steps, length * 0.08, rand);
  drawArc(g, glow, main, colour, width, alpha);
  const branches = 1 + Math.floor(rand() * 2);
  for (let b = 0; b < branches; b++) {
    const at = 1 + Math.floor(rand() * (steps - 2));
    const bx = main[at * 2]!;
    const by = main[at * 2 + 1]!;
    const a = Math.atan2(y1 - y0, x1 - x0) + (rand() < 0.5 ? -1 : 1) * (0.4 + rand() * 0.5);
    const reach = length * (0.2 + rand() * 0.2);
    const branch = jag(
      bx,
      by,
      bx + Math.cos(a) * reach,
      by + Math.sin(a) * reach,
      4,
      reach * 0.15,
      rand,
    );
    drawArc(g, glow, branch, colour, width * 0.6, alpha * 0.7);
  }
}

/**
 * A ball of lightning, centred, for a stamp: a halo in `light`, a body in `colour`, a white
 * core. `r` is the body's radius.
 */
export function drawBall(g: Graphics, r: number, colour: number, light: number): void {
  g.circle(0, 0, r * 2.1);
  g.fill({ color: light, alpha: 0.14 });
  g.circle(0, 0, r * 1.45);
  g.fill({ color: light, alpha: 0.28 });
  g.circle(0, 0, r);
  g.fill({ color: colour });
  g.circle(0, 0, r * 0.55);
  g.fill({ color: ARC_WHITE });
}
