import type { Graphics } from 'pixi.js';

/*
 * Cartoon's things, drawn by its theme, its sea life and its finish alike: the ink, the
 * paper, a white glove, a star and a puff of cloud — the stock of a 1930s rubber-hose reel.
 */

/** The ink every line is drawn in, and the paper white under it. */
export const INK = 0x111111;
export const PAPER = 0xfafaf8;

/** The weight of an ink line at this tile size: thick, as the era drew. */
export function inkWidth(tile: number): number {
  return Math.max(1.5, tile * 0.09);
}

/**
 * A white four-fingered glove, the era's hand, at (x, y) — the middle of its palm — `r`
 * across the palm, its fingers along `angle` (0 up). `open` spreads the fingers, the three
 * stitches on its back; `point` raises the forefinger, the rest curled. Every part is
 * stroked before any is filled, so the ink runs round the whole hand and not each part.
 */
export function drawGlove(
  g: Graphics,
  x: number,
  y: number,
  r: number,
  angle: number,
  pose: 'open' | 'point' = 'open',
  alpha = 1,
): void {
  const parts: [number, number, number, number][] =
    pose === 'open'
      ? [
          [0, 0, 0.55, 0.55],
          [-0.36, -0.55, 0.2, 0.32],
          [0, -0.68, 0.2, 0.34],
          [0.36, -0.55, 0.2, 0.32],
          [-0.62, -0.02, 0.28, 0.17],
        ]
      : [
          [0, 0, 0.55, 0.55],
          [0.08, -0.82, 0.17, 0.45],
          [-0.25, -0.42, 0.2, 0.2],
          [0.36, -0.38, 0.18, 0.18],
          [-0.55, 0.05, 0.26, 0.16],
        ];
  // Turned first and then moved: Pixi's turn turns whatever move came before it too.
  g.save();
  g.rotateTransform(angle);
  g.translateTransform(x, y);
  const shape = (): void => {
    for (const [u, v, a, b] of parts) g.ellipse(u * r, v * r, a * r, b * r);
    // The cuff, rolled, below the palm.
    g.roundRect(-0.5 * r, 0.45 * r, r, 0.38 * r, 0.15 * r);
  };
  shape();
  g.stroke({ width: Math.max(1.5, r * 0.22), color: INK, alpha, join: 'round' });
  shape();
  g.fill({ color: PAPER, alpha });
  if (pose === 'open') {
    for (const u of [-0.2, 0, 0.2]) g.moveTo(u * r, -0.05 * r).lineTo(u * r * 1.1, 0.3 * r);
    g.stroke({ width: Math.max(1, r * 0.08), color: INK, alpha });
  }
  g.moveTo(-0.5 * r, 0.6 * r).lineTo(0.5 * r, 0.6 * r);
  g.stroke({ width: Math.max(1, r * 0.08), color: INK, alpha });
  g.restore();
}

/** A five-pointed star at (x, y), `r` to its points, turned by `angle`, inked round. */
export function drawStar(
  g: Graphics,
  x: number,
  y: number,
  r: number,
  angle: number,
  fill: number,
  alpha = 1,
): void {
  const points: number[] = [];
  for (let k = 0; k < 10; k++) {
    const a = angle - Math.PI / 2 + (k * Math.PI) / 5;
    const d = k % 2 === 0 ? r : r * 0.45;
    points.push(x + Math.cos(a) * d, y + Math.sin(a) * d);
  }
  g.poly(points);
  g.fill({ color: fill, alpha });
  g.stroke({ width: Math.max(1, r * 0.2), color: INK, alpha, join: 'round' });
}

/** Puffs making up a cloud, in units of its radius: across, down, and each one's radius. */
const PUFFS: readonly (readonly [number, number, number])[] = [
  [0, 0, 1],
  [-0.75, 0.2, 0.7],
  [0.75, 0.2, 0.75],
  [-0.38, -0.5, 0.66],
  [0.36, -0.45, 0.7],
];

/**
 * A puff of cloud at (x, y), `r` the middle puff's radius: its puffs stroked first and then
 * filled over, so the ink runs round the outside alone, as a cartoon's dust and smoke are.
 */
export function drawCloud(
  g: Graphics,
  x: number,
  y: number,
  r: number,
  fill = PAPER,
  alpha = 1,
  ink = Math.max(1.5, r * 0.22),
): void {
  for (const [u, v, k] of PUFFS) g.circle(x + u * r, y + v * r, k * r);
  g.stroke({ width: ink, color: INK, alpha });
  for (const [u, v, k] of PUFFS) g.circle(x + u * r, y + v * r, k * r);
  g.fill({ color: fill, alpha });
}

/**
 * A pie-cut eye: a white oval, inked, and its pupil a black oval with a wedge cut from its
 * upper right — the era's eye. (x, y) its middle, `w` and `h` its half-width and height;
 * the pupil looks along (`lookX`, `lookY`), each -1 to 1.
 */
export function drawPieEye(
  g: Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  lookX = 0,
  lookY = 0,
  alpha = 1,
): void {
  g.ellipse(x, y, w, h);
  g.fill({ color: PAPER, alpha });
  g.stroke({ width: Math.max(1, w * 0.3), color: INK, alpha });
  const px = x + lookX * w * 0.35;
  const py = y + h * 0.15 + lookY * h * 0.3;
  g.ellipse(px, py, w * 0.55, h * 0.62);
  g.fill({ color: INK, alpha });
  g.poly([px + w * 0.05, py - h * 0.12, px + w * 0.5, py - h * 0.5, px + w * 0.15, py - h * 0.7]);
  g.fill({ color: PAPER, alpha });
}
