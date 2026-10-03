import type { Graphics } from 'pixi.js';

/*
 * Sakura's motifs, drawn by its theme, its sea life and its finish alike: the woodblock
 * print's curling wave, its cloud swirl, a cherry petal and a maple leaf.
 */

/** Cherry blossom, palest to deepest. */
export const PETALS = [0xfbe4ea, 0xf7c6d4, 0xf2a9bf] as const;

/** Autumn maple, for when the season turns. */
export const MAPLE = [0xd8452a, 0xe8742a, 0xb8301e, 0xf0a030] as const;

/**
 * A wave crest as the prints draw it: a body of water rising and curling over toward `dir`,
 * a lip of foam along its top, and foam breaking off its tip in claws. `rise` from 0 to 1
 * says how far it has risen; `size` is its length in pixels; (x, y) its foot.
 */
export function drawCrest(
  g: Graphics,
  x: number,
  y: number,
  size: number,
  dir: 1 | -1,
  rise: number,
  body: number,
  foam: number,
  ink: number,
  alpha = 1,
): void {
  if (rise <= 0.02 || alpha <= 0) return;
  const s = size;
  const h = s * 0.7 * rise;
  const X = (u: number): number => x + dir * u * s;
  // The body: up the back in a long curve, over the top, and down the hollow under the curl.
  g.moveTo(X(-0.5), y);
  g.quadraticCurveTo(X(-0.15), y - h * 0.15, X(0.08), y - h);
  g.quadraticCurveTo(X(0.32), y - h * 1.18, X(0.46), y - h * 0.62);
  g.quadraticCurveTo(X(0.3), y - h * 0.7, X(0.26), y - h * 0.4);
  g.quadraticCurveTo(X(0.24), y - h * 0.1, X(0.5), y);
  g.closePath();
  g.fill({ color: body, alpha });
  g.stroke({ width: Math.max(1, s * 0.035), color: ink, alpha: 0.55 * alpha, join: 'round' });
  // The lip of foam over the top.
  g.moveTo(X(-0.12), y - h * 0.62);
  g.quadraticCurveTo(X(0.05), y - h * 1.02, X(0.2), y - h * 1.05);
  g.quadraticCurveTo(X(0.38), y - h * 1.05, X(0.46), y - h * 0.62);
  g.stroke({ width: Math.max(1.5, s * 0.09), color: foam, alpha, cap: 'round' });
  // Claws of foam breaking off the tip, once it has curled.
  if (rise < 0.55) return;
  const claw = (rise - 0.55) / 0.45;
  for (let k = 0; k < 3; k++) {
    const bx = X(0.42 - k * 0.08);
    const by = y - h * (0.66 + k * 0.12);
    g.moveTo(bx, by).quadraticCurveTo(
      bx + dir * s * 0.1 * claw,
      by + s * 0.02,
      bx + dir * s * 0.08 * claw,
      by + s * 0.11 * claw,
    );
  }
  g.stroke({ width: Math.max(1, s * 0.045), color: foam, alpha, cap: 'round' });
}

/**
 * The prints' cloud: three rounded lobes, each with a curl wound into it, outlined in ink.
 * Sakura's smoke, dust and puff of a hit.
 */
export function drawCloudCurl(
  g: Graphics,
  x: number,
  y: number,
  r: number,
  colour: number,
  ink: number,
  alpha: number,
): void {
  if (alpha <= 0 || r <= 0) return;
  const lobes: [number, number, number][] = [
    [0, 0, 1],
    [-0.85, 0.25, 0.7],
    [0.85, 0.2, 0.75],
  ];
  for (const [dx, dy, k] of lobes) g.circle(x + dx * r, y + dy * r, r * k);
  g.fill({ color: colour, alpha });
  for (const [dx, dy, k] of lobes) {
    // A spiral wound in from the lobe's edge, a turn and a half.
    const cx = x + dx * r;
    const cy = y + dy * r;
    const steps = 14;
    for (let n = 0; n <= steps; n++) {
      const u = n / steps;
      const a = Math.PI * 0.5 + u * Math.PI * 3;
      const rr = r * k * 0.75 * (1 - u * 0.85);
      const px = cx + Math.cos(a) * rr;
      const py = cy + Math.sin(a) * rr;
      if (n === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
  }
  g.stroke({ width: Math.max(1, r * 0.12), color: ink, alpha: 0.6 * alpha, cap: 'round' });
}

/** A cherry petal: a teardrop notched at its broad end, turned by `angle`. */
export function drawPetal(
  g: Graphics,
  x: number,
  y: number,
  size: number,
  angle: number,
  colour: number,
  alpha: number,
): void {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const at = (u: number, v: number): [number, number] => [
    x + (c * u - s * v) * size,
    y + (s * u + c * v) * size,
  ];
  g.poly([
    ...at(-1, 0),
    ...at(-0.1, -0.55),
    ...at(0.8, -0.45),
    ...at(0.55, 0),
    ...at(0.8, 0.45),
    ...at(-0.1, 0.55),
  ]);
  g.fill({ color: colour, alpha });
}

/** A maple leaf: five points round a stalk, turned by `angle`. */
export function drawMapleLeaf(
  g: Graphics,
  x: number,
  y: number,
  size: number,
  angle: number,
  colour: number,
  alpha: number,
): void {
  const points: number[] = [];
  for (let k = 0; k < 10; k++) {
    const a = angle - Math.PI / 2 + (k / 10) * Math.PI * 2;
    const r = k % 2 === 0 ? size : size * 0.45;
    points.push(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  g.poly(points);
  g.fill({ color: colour, alpha });
}
