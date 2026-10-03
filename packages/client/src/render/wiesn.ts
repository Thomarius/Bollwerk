import type { Graphics } from 'pixi.js';

/*
 * Oktoberfest's things, drawn by its theme, its sea life and its finish alike: a pretzel, a
 * gingerbread heart, a Maß of beer and a reveller asleep.
 */

/** Baked pretzel, its glaze and its salt. */
export const PRETZEL = 0x9a5520;
const PRETZEL_DARK = 0x5e3010;
/** Gingerbread, and the icing piped on it. */
export const GINGER = 0x8a4a22;
export const ICING = [0xffffff, 0xff8fb3, 0x7fd47a, 0xffd23f] as const;
/** Lager, its foam, and the glass it is in. */
export const LAGER = 0xf2b632;
export const FOAM = 0xfffaf0;
const GLASS = 0xdff1f5;

/** A pretzel's strands in units of its size, as polylines: the belly, two loops, the arms. */
const PRETZEL_STRANDS: readonly (readonly [number, number])[][] = (() => {
  const arc = (cx: number, cy: number, r: number, a0: number, a1: number): [number, number][] => {
    const out: [number, number][] = [];
    for (let n = 0; n <= 10; n++) {
      const a = a0 + ((a1 - a0) * n) / 10;
      out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    return out;
  };
  return [
    // The belly, round the bottom from one end to the other.
    arc(0, -0.1, 0.62, Math.PI * 0.95, Math.PI * 0.05),
    // The two loops at the top.
    arc(-0.28, -0.12, 0.3, Math.PI * 0.2, Math.PI * 1.9),
    arc(0.28, -0.12, 0.3, Math.PI * -0.9, Math.PI * 0.8),
    // The arms, crossing in the middle and down to the belly.
    [
      [-0.05, -0.05],
      [0.35, 0.42],
    ],
    [
      [0.05, -0.05],
      [-0.35, 0.42],
    ],
  ];
})();

/** A pretzel, turned by `angle`, `size` its half-width in pixels, glazed brown, salted. */
export function drawPretzel(
  g: Graphics,
  x: number,
  y: number,
  size: number,
  angle: number,
  alpha = 1,
): void {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const at = (u: number, v: number): [number, number] => [
    x + (c * u - s * v) * size,
    y + (s * u + c * v) * size,
  ];
  const path = (): void => {
    for (const strand of PRETZEL_STRANDS) {
      strand.forEach(([u, v], n) => {
        const [px, py] = at(u, v);
        if (n === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      });
    }
  };
  path();
  g.stroke({
    width: Math.max(2, size * 0.34),
    color: PRETZEL_DARK,
    alpha,
    cap: 'round',
    join: 'round',
  });
  path();
  g.stroke({
    width: Math.max(1.5, size * 0.24),
    color: PRETZEL,
    alpha,
    cap: 'round',
    join: 'round',
  });
  // Coarse salt on the belly and the loops.
  for (const [u, v] of [
    [-0.45, 0.25],
    [0.4, 0.3],
    [0, 0.5],
    [-0.4, -0.3],
    [0.38, -0.32],
  ] as const) {
    const [px, py] = at(u, v);
    g.rect(px - size * 0.04, py - size * 0.04, size * 0.08, size * 0.08);
  }
  g.fill({ color: 0xffffff, alpha: 0.9 * alpha });
}

/** A heart's outline, `w` wide, centred on (x, y). */
function heartPath(g: Graphics, x: number, y: number, w: number): void {
  const h = w * 0.9;
  g.moveTo(x, y + h * 0.5);
  g.bezierCurveTo(x - w * 0.6, y + h * 0.05, x - w * 0.55, y - h * 0.55, x, y - h * 0.22);
  g.bezierCurveTo(x + w * 0.55, y - h * 0.55, x + w * 0.6, y + h * 0.05, x, y + h * 0.5);
  g.closePath();
}

/**
 * A gingerbread heart, as sold at every stall to be hung round a neck: brown, edged in a
 * piped line of icing, a squiggle across it where the words would be; on a ribbon if
 * `ribbon` is a colour.
 */
export function drawGingerHeart(
  g: Graphics,
  x: number,
  y: number,
  w: number,
  icing: number,
  alpha = 1,
  ribbon: number | null = null,
): void {
  if (ribbon !== null) {
    g.moveTo(x - w * 0.3, y - w * 0.25).quadraticCurveTo(x, y - w * 0.9, x + w * 0.3, y - w * 0.25);
    g.stroke({ width: Math.max(1, w * 0.06), color: ribbon, alpha });
  }
  heartPath(g, x, y, w);
  g.fill({ color: GINGER, alpha });
  heartPath(g, x, y, w * 0.8);
  g.stroke({ width: Math.max(1, w * 0.07), color: icing, alpha });
  g.moveTo(x - w * 0.22, y);
  for (let k = 1; k <= 4; k++) {
    g.lineTo(x - w * 0.22 + (w * 0.44 * k) / 4, y + (k % 2 === 0 ? 0 : -w * 0.08));
  }
  g.stroke({ width: Math.max(1, w * 0.05), color: 0xffffff, alpha });
}

/**
 * A Maß — the litre mug of the beer tents — seen from the side: thick glass, a handle,
 * filled to `fill` (0 to 1) with lager and a head of foam once it is nearly full. `h` is its
 * height in pixels, (x, y) the middle of its foot.
 */
export function drawMass(
  g: Graphics,
  x: number,
  y: number,
  h: number,
  fill: number,
  ink: number,
  alpha = 1,
): void {
  const w = h * 0.62;
  const left = x - w / 2;
  const top = y - h;
  // The handle, behind on the right.
  g.roundRect(left + w * 0.82, top + h * 0.22, w * 0.4, h * 0.52, w * 0.18);
  g.stroke({ width: Math.max(1.5, w * 0.14), color: GLASS, alpha });
  g.roundRect(left, top, w, h, w * 0.08);
  g.fill({ color: GLASS, alpha: 0.55 * alpha });
  if (fill > 0) {
    const level = top + h * 0.12 + h * 0.84 * (1 - fill);
    g.rect(left + w * 0.08, level, w * 0.84, y - h * 0.04 - level);
    g.fill({ color: LAGER, alpha });
    if (fill > 0.82) {
      // The head of foam, spilling a little over the rim.
      const head = (fill - 0.82) / 0.18;
      for (const [dx, r] of [
        [0.2, 0.2],
        [0.5, 0.24],
        [0.8, 0.2],
      ] as const) {
        g.circle(left + w * dx, level, w * r * (0.6 + 0.4 * head));
      }
      g.fill({ color: FOAM, alpha });
    }
  }
  // The glass's dimples, and its outline.
  for (const fx of [0.3, 0.7]) {
    for (const fy of [0.4, 0.65]) g.circle(left + w * fx, top + h * fy, w * 0.07);
  }
  g.fill({ color: 0xffffff, alpha: 0.35 * alpha });
  g.roundRect(left, top, w, h, w * 0.08);
  g.stroke({ width: Math.max(1, h * 0.05), color: ink, alpha: 0.8 * alpha });
}

/**
 * A reveller asleep — a Bierleiche — lying on his back: green hat tipped over his face,
 * white shirt, leather shorts and braces, his Maß beside him. Lying in the grass, or on a
 * lilo at sea. (x, y) his middle, `size` his length in pixels.
 */
export function drawReveller(g: Graphics, x: number, y: number, size: number, ink: number): void {
  const s = size;
  // Legs in socks and boots, the shorts, the shirt, the head under the hat.
  g.moveTo(x + s * 0.05, y - s * 0.06).lineTo(x + s * 0.42, y - s * 0.1);
  g.moveTo(x + s * 0.05, y + s * 0.06).lineTo(x + s * 0.42, y + s * 0.12);
  g.stroke({ width: Math.max(1.5, s * 0.1), color: 0xf2efe6, cap: 'round' });
  for (const dy of [-0.1, 0.12]) g.circle(x + s * 0.45, y + s * dy, s * 0.07);
  g.fill({ color: 0x3a2414 });
  g.roundRect(x - s * 0.12, y - s * 0.14, s * 0.24, s * 0.28, s * 0.06);
  g.fill({ color: 0x6b4426 });
  g.roundRect(x - s * 0.38, y - s * 0.16, s * 0.3, s * 0.32, s * 0.08);
  g.fill({ color: 0xffffff });
  g.moveTo(x - s * 0.36, y - s * 0.08).lineTo(x - s * 0.1, y - s * 0.08);
  g.moveTo(x - s * 0.36, y + s * 0.08).lineTo(x - s * 0.1, y + s * 0.08);
  g.stroke({ width: Math.max(1, s * 0.04), color: 0x6b4426 });
  g.circle(x - s * 0.45, y, s * 0.11);
  g.fill({ color: 0xf0c8a0 });
  g.ellipse(x - s * 0.47, y - s * 0.02, s * 0.13, s * 0.09);
  g.fill({ color: 0x3f6a32 });
  g.circle(x - s * 0.47, y - s * 0.1, s * 0.03);
  g.fill({ color: 0xffffff });
  // An arm flung out, and the Maß dropped beside it.
  g.moveTo(x - s * 0.25, y + s * 0.14).lineTo(x - s * 0.15, y + s * 0.32);
  g.stroke({ width: Math.max(1, s * 0.07), color: 0xffffff, cap: 'round' });
  drawMass(g, x - s * 0.02, y + s * 0.42, s * 0.24, 0.15, ink);
}

/** A musical note, a quaver: a head, a stem and its flag, in `colour`. */
export function drawNote(
  g: Graphics,
  x: number,
  y: number,
  size: number,
  colour: number,
  alpha: number,
): void {
  g.ellipse(x, y, size * 0.32, size * 0.24);
  g.fill({ color: colour, alpha });
  g.moveTo(x + size * 0.28, y).lineTo(x + size * 0.28, y - size);
  g.quadraticCurveTo(x + size * 0.55, y - size * 0.7, x + size * 0.6, y - size * 0.45);
  g.stroke({ width: Math.max(1, size * 0.12), color: colour, alpha, cap: 'round' });
}
