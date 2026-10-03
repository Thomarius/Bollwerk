import type { Graphics } from 'pixi.js';

/*
 * Halloween's creatures, drawn by its theme and its sea life alike.
 */

/** A bat seen from above, wings spread, `flap` from -1 to 1 for the beat of its wings. */
export function drawBat(
  g: Graphics,
  x: number,
  y: number,
  size: number,
  flap: number,
  colour: number,
  alpha = 1,
): void {
  const up = flap * size * 0.4;
  for (const s of [-1, 1]) {
    g.poly([
      x,
      y - size * 0.1,
      x + s * size * 0.5,
      y - size * 0.25 - up,
      x + s * size,
      y - up * 0.6,
      x + s * size * 0.7,
      y + size * 0.05,
      x + s * size * 0.45,
      y - size * 0.02,
      x + s * size * 0.25,
      y + size * 0.15,
      x,
      y + size * 0.1,
    ]);
  }
  g.circle(x, y, size * 0.16);
  g.fill({ color: colour, alpha });
}

/**
 * A little ghost: a round head over a sheet whose hem waves, two dark eyes and a small
 * round mouth, glowing faintly in `glow`.
 */
export function drawGhost(
  g: Graphics,
  x: number,
  y: number,
  size: number,
  alpha: number,
  glow: number,
): void {
  g.circle(x, y, size * 1.5);
  g.fill({ color: glow, alpha: 0.15 * alpha });
  g.moveTo(x - size, y);
  g.arc(x, y, size, Math.PI, 0);
  g.lineTo(x + size, y + size * 1.2);
  for (let k = 0; k < 3; k++) {
    const x1 = x + size - (size * 2 * (k + 0.5)) / 3;
    const x2 = x + size - (size * 2 * (k + 1)) / 3;
    g.quadraticCurveTo(x1, y + size * 0.85, x2, y + size * 1.2);
  }
  g.closePath();
  g.fill({ color: 0xf4f0ff, alpha: 0.88 * alpha });
  for (const s of [-1, 1]) g.ellipse(x + s * size * 0.35, y - size * 0.05, size * 0.14, size * 0.2);
  g.ellipse(x, y + size * 0.4, size * 0.12, size * 0.16);
  g.fill({ color: 0x120d1a, alpha });
}
