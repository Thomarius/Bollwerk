import type { Graphics } from 'pixi.js';

/*
 * Christmas's things, drawn by its theme, its sea life and its finish alike: a snowflake, a
 * stocking, a bow — and the colours none of which is a player's: snow, the night's ink,
 * gold, and the warm white of the fairy lights.
 */

export const SNOW = 0xf6faff;
export const SNOW_SHADE = 0xc4d6ea;
/** The night's ink, for every outline: a dark blue rather than black. */
export const NIGHT = 0x0c1428;
export const GOLD = 0xe8c25a;
export const WARM = 0xfff1c8;

/**
 * A six-armed snowflake at (x, y), `r` to its tips, turned by `angle`: each arm a stroke with
 * a pair of barbs along it.
 */
export function drawSnowflake(
  g: Graphics,
  x: number,
  y: number,
  r: number,
  angle: number,
  colour: number,
  alpha = 1,
): void {
  for (let k = 0; k < 6; k++) {
    const a = angle + (k * Math.PI) / 3;
    const c = Math.cos(a);
    const s = Math.sin(a);
    g.moveTo(x, y).lineTo(x + c * r, y + s * r);
    // The barbs, a pair two thirds out, swept back toward the middle.
    const bx = x + c * r * 0.6;
    const by = y + s * r * 0.6;
    for (const side of [-1, 1]) {
      const b = a + side * 0.75;
      g.moveTo(bx, by).lineTo(bx + Math.cos(b) * r * 0.32, by + Math.sin(b) * r * 0.32);
    }
  }
  g.stroke({ width: Math.max(1, r * 0.2), color: colour, alpha, cap: 'round' });
}

/**
 * A Christmas stocking hung from (x, y), `h` from its cuff to its toe: a white furry cuff over
 * a leg in `colour`, its foot turned out to the right, a white heel and toe.
 */
export function drawStocking(
  g: Graphics,
  x: number,
  y: number,
  h: number,
  colour: number,
  sway = 0,
  alpha = 1,
): void {
  const w = h * 0.42;
  const foot = y + h + sway * 0.2;
  const leg = [
    x - w / 2,
    y + h * 0.2,
    x + w / 2,
    y + h * 0.2,
    x + w / 2 + sway * 0.5,
    foot - w * 0.55,
    x + w * 1.25 + sway,
    foot - w * 0.45,
    x + w * 1.3 + sway,
    foot,
    x - w / 2 + sway * 0.6,
    foot,
  ];
  g.poly(leg);
  g.fill({ color: colour, alpha });
  g.circle(x + w * 1.15 + sway, foot - w * 0.22, w * 0.24);
  g.circle(x - w * 0.3 + sway * 0.6, foot - w * 0.2, w * 0.22);
  g.fill({ color: SNOW, alpha });
  g.poly(leg);
  g.stroke({ width: Math.max(1, h * 0.05), color: NIGHT, alpha, join: 'round' });
  g.roundRect(x - w * 0.62, y, w * 1.24, h * 0.24, h * 0.08);
  g.fill({ color: SNOW, alpha });
  g.stroke({ width: Math.max(1, h * 0.05), color: NIGHT, alpha });
}

/** A ribbon's bow at (x, y), `r` across each loop: two loops and a knot, in `colour`. */
export function drawBow(
  g: Graphics,
  x: number,
  y: number,
  r: number,
  colour: number,
  alpha = 1,
): void {
  for (const side of [-1, 1]) {
    g.poly([x, y, x + side * r, y - r * 0.6, x + side * r, y + r * 0.6]);
    g.poly([x, y, x + side * r * 0.35, y + r * 1.1, x + side * r * 0.1, y + r * 1.15]);
  }
  g.fill({ color: colour, alpha });
  g.stroke({ width: Math.max(1, r * 0.18), color: NIGHT, alpha, join: 'round' });
  g.circle(x, y, r * 0.3);
  g.fill({ color: colour, alpha });
  g.stroke({ width: Math.max(1, r * 0.18), color: NIGHT, alpha });
}
