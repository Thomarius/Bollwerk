import type { Graphics } from 'pixi.js';

/*
 * Under the sea's things, drawn by its theme, its sea life and its finish alike: a fish, a
 * bubble, a sea urchin, a pufferfish, the giant clam and the shell palace it guards.
 */

/** The pale cream of a shell, a pearl's white and the clam's pink inside. */
export const SHELL = 0xf6e8d8;
export const SHELL_DARK = 0xc9a98e;
export const PEARL = 0xfbfcff;
const NACRE = 0xe8b8c0;

/**
 * A little fish seen from above, nose along `angle` (0 to the right), `size` from nose to
 * tail: a body tapering to the tail fin, an eye near the nose. (x, y) is its middle.
 */
export function drawFish(
  g: Graphics,
  x: number,
  y: number,
  size: number,
  angle: number,
  colour: number,
  alpha = 1,
  ink = 0x071420,
): void {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const at = (u: number, v: number): [number, number] => [
    x + (c * u - s * v) * size,
    y + (s * u + c * v) * size,
  ];
  g.poly([
    ...at(0.5, 0),
    ...at(0.32, -0.16),
    ...at(0, -0.2),
    ...at(-0.28, -0.1),
    ...at(-0.32, 0),
    ...at(-0.28, 0.1),
    ...at(0, 0.2),
    ...at(0.32, 0.16),
  ]);
  g.poly([...at(-0.26, 0), ...at(-0.5, -0.2), ...at(-0.44, 0), ...at(-0.5, 0.2)]);
  g.fill({ color: colour, alpha });
  if (size < 6) return;
  g.circle(...at(0.3, 0), Math.max(0.6, size * 0.05));
  g.fill({ color: ink, alpha });
}

/** A bubble: a thin bright ring, faintly filled, a glint in its upper left. */
export function drawBubble(
  g: Graphics,
  x: number,
  y: number,
  r: number,
  alpha = 1,
  tint = 0xffffff,
): void {
  g.circle(x, y, r);
  g.fill({ color: tint, alpha: 0.12 * alpha });
  g.circle(x, y, r);
  g.stroke({ width: Math.max(1, r * 0.18), color: tint, alpha: 0.75 * alpha });
  if (r < 2) return;
  g.circle(x - r * 0.35, y - r * 0.35, r * 0.22);
  g.fill({ color: 0xffffff, alpha: 0.85 * alpha });
}

/**
 * A sea urchin, centred, for a stamp: a ball in `colour` bristling with spines in its dark
 * shade, a glint on top. `r` is the ball's radius; the spines reach twice as far.
 */
export function drawUrchin(g: Graphics, r: number, colour: number, dark: number): void {
  const spines = 14;
  for (let k = 0; k < spines; k++) {
    const a = (k / spines) * Math.PI * 2;
    const reach = k % 2 === 0 ? 2 : 1.6;
    g.moveTo(Math.cos(a) * r * 0.6, Math.sin(a) * r * 0.6).lineTo(
      Math.cos(a) * r * reach,
      Math.sin(a) * r * reach,
    );
  }
  g.stroke({ width: Math.max(1, r * 0.22), color: dark, cap: 'round' });
  g.circle(0, 0, r);
  g.fill({ color: colour });
  g.stroke({ width: Math.max(1, r * 0.15), color: dark });
  g.circle(-r * 0.3, -r * 0.3, r * 0.3);
  g.fill({ color: 0xffffff, alpha: 0.45 });
}

/** How a pufferfish is: swimming, puffed up round as it fires, or deflated and limp. */
export type PufferMood = 'calm' | 'puffed' | 'limp';

/**
 * A pufferfish seen from above, centred, its mouth pointing up (to −y), for a stamp: a body in
 * `colour` speckled in `dark`, a pale belly showing at its sides, fins and a tail, and two big
 * eyes. Puffed it is round and every spine stands out; limp it is narrow and sagging, its eyes
 * half shut. `t` is the tile.
 */
export function drawPuffer(
  g: Graphics,
  t: number,
  colour: number,
  dark: number,
  light: number,
  ink: number,
  mood: PufferMood,
): void {
  const puffed = mood === 'puffed';
  const limp = mood === 'limp';
  const rx = t * (puffed ? 0.56 : limp ? 0.3 : 0.38);
  const ry = t * (puffed ? 0.56 : limp ? 0.46 : 0.46);
  const cy = puffed ? 0 : t * 0.04;
  // A shadow on the sand under it, and the tail behind.
  g.ellipse(t * 0.08, cy + t * 0.12, rx, ry);
  g.fill({ color: 0x000000, alpha: 0.25 });
  const tailY = cy + ry;
  g.poly([0, tailY - t * 0.08, -t * 0.2, tailY + t * 0.24, t * 0.2, tailY + t * 0.24]);
  g.fill({ color: dark });
  // The side fins, fanned out.
  for (const side of [-1, 1]) {
    g.poly([
      side * rx * 0.8,
      cy - ry * 0.05,
      side * (rx + t * 0.2),
      cy - ry * 0.25,
      side * (rx + t * 0.22),
      cy + ry * 0.15,
    ]);
  }
  g.fill({ color: light, alpha: 0.85 });
  if (puffed) {
    // Every spine standing out.
    for (let k = 0; k < 20; k++) {
      const a = (k / 20) * Math.PI * 2;
      g.moveTo(Math.cos(a) * rx * 0.92, cy + Math.sin(a) * ry * 0.92).lineTo(
        Math.cos(a) * (rx + t * 0.14),
        cy + Math.sin(a) * (ry + t * 0.14),
      );
    }
    g.stroke({ width: Math.max(1, t * 0.05), color: ink, cap: 'round' });
  }
  // The body: the belly's pale edge, the back in the owner's colour, speckled.
  g.ellipse(0, cy, rx, ry);
  g.fill({ color: limp ? 0xd8d4c8 : 0xf4f0e0 });
  g.ellipse(0, cy + ry * 0.04, rx * 0.84, ry * 0.88);
  g.fill({ color: colour });
  for (const [u, v] of [
    [-0.4, 0.1],
    [0.35, 0.2],
    [0, 0.45],
    [-0.2, -0.25],
    [0.3, -0.2],
    [-0.35, 0.5],
    [0.15, 0.7],
  ] as const) {
    g.circle(u * rx, cy + v * ry, Math.max(0.8, t * 0.045));
  }
  g.fill({ color: dark, alpha: limp ? 0.4 : 0.7 });
  g.ellipse(0, cy, rx, ry);
  g.stroke({ width: Math.max(1, t * 0.05), color: ink, alpha: 0.8 });
  // The eyes, bulging out at the front, and the little round mouth.
  const ey = cy - ry * 0.55;
  for (const side of [-1, 1]) {
    const ex = side * rx * 0.62;
    g.circle(ex, ey, t * 0.11);
    g.fill({ color: 0xffffff });
    g.stroke({ width: 1, color: ink, alpha: 0.8 });
    if (limp) {
      // Half shut: a lid drawn down over the top.
      g.rect(ex - t * 0.11, ey - t * 0.11, t * 0.22, t * 0.11);
      g.fill({ color: colour });
      g.moveTo(ex - t * 0.1, ey).lineTo(ex + t * 0.1, ey);
      g.stroke({ width: Math.max(1, t * 0.04), color: ink });
    } else {
      g.circle(ex + side * t * 0.02, ey - t * 0.02, t * 0.055);
      g.fill({ color: ink });
    }
  }
  g.circle(0, cy - ry * 0.95, t * (puffed ? 0.07 : 0.05));
  g.fill({ color: ink, alpha: 0.85 });
}

/**
 * The giant clam at a shell palace's door, seen from the front: two fluted halves in `shell`,
 * their rims in the owner's `rim`; `open` 0 shut to 1 gaping, the pearl inside glowing by
 * `glow`. (x, y) is the middle of its hinge line, `w` its width.
 */
export function drawClam(
  g: Graphics,
  x: number,
  y: number,
  w: number,
  open: number,
  rim: number,
  ink: number,
  glow: number,
): void {
  const h = w * 0.42;
  const lift = open * h * 0.95;
  // The inside, the pearl and its light, seen between the halves.
  if (open > 0.05) {
    g.ellipse(x, y - lift * 0.45, w * 0.44, lift * 0.55 + 1);
    g.fill({ color: NACRE });
    if (glow > 0) {
      g.circle(x, y - lift * 0.35, w * 0.55);
      g.fill({ color: PEARL, alpha: 0.18 * glow });
      g.circle(x, y - lift * 0.35, w * 0.32);
      g.fill({ color: PEARL, alpha: 0.3 * glow });
    }
    g.circle(x, y - lift * 0.35, w * 0.13);
    g.fill({ color: PEARL });
    g.circle(x - w * 0.04, y - lift * 0.35 - w * 0.04, w * 0.04);
    g.fill({ color: 0xffffff });
  }
  // The lower half: a bowl, fluted.
  g.moveTo(x - w / 2, y);
  g.arc(x, y, w / 2, Math.PI, 0, true);
  g.closePath();
  g.fill({ color: SHELL });
  for (let k = 1; k < 5; k++) {
    const a = Math.PI - (k / 5) * Math.PI;
    g.moveTo(x, y + h * 0.1).lineTo(x + Math.cos(a) * w * 0.48, y + Math.sin(a) * w * 0.48);
  }
  g.stroke({ width: 1, color: SHELL_DARK, alpha: 0.8 });
  g.moveTo(x - w / 2, y);
  g.arc(x, y, w / 2, Math.PI, 0, true);
  g.stroke({ width: Math.max(1, w * 0.07), color: rim });
  // The upper half, raised as it opens.
  const top = y - lift;
  g.moveTo(x - w / 2, top);
  g.arc(x, top, w / 2, Math.PI, 0);
  g.closePath();
  g.fill({ color: SHELL });
  for (let k = 1; k < 5; k++) {
    const a = Math.PI + (k / 5) * Math.PI;
    g.moveTo(x, top - h * 0.1).lineTo(x + Math.cos(a) * w * 0.48, top + Math.sin(a) * w * 0.48);
  }
  g.stroke({ width: 1, color: SHELL_DARK, alpha: 0.8 });
  g.moveTo(x - w / 2, top);
  g.arc(x, top, w / 2, Math.PI, 0);
  g.stroke({ width: Math.max(1, w * 0.07), color: rim });
  g.moveTo(x - w / 2, top).lineTo(x + w / 2, top);
  g.stroke({ width: 1, color: ink, alpha: 0.6 });
}

/**
 * A shell palace: a great conch standing on its broad end, whorl on whorl narrowing to its
 * spire, a knob at every shoulder; the bands between the whorls and the spire's tip in the
 * owner's `band`, arched windows dark in it and a door at its foot. (cx, foot) is the middle
 * of its foot, `W` its width; the clam is drawn beside it with the effects.
 */
export function drawConch(
  g: Graphics,
  cx: number,
  foot: number,
  W: number,
  band: number,
  bandDark: number,
  ink: number,
): void {
  const tiers = 4;
  const tierH = W * 0.22;
  g.ellipse(cx + W * 0.06, foot, W * 0.5, W * 0.1);
  g.fill({ color: 0x000000, alpha: 0.3 });
  for (let k = 0; k < tiers; k++) {
    const bottom = foot - k * tierH;
    const wb = W * (0.86 - k * 0.19);
    const wt = W * (0.86 - (k + 1) * 0.19);
    const top = bottom - tierH;
    // The whorl: swelling out at its shoulder, cream with a blush of the shell's pink.
    g.moveTo(cx - wb / 2, bottom);
    g.quadraticCurveTo(cx - wb * 0.62, top + tierH * 0.3, cx - wt / 2, top);
    g.lineTo(cx + wt / 2, top);
    g.quadraticCurveTo(cx + wb * 0.62, top + tierH * 0.3, cx + wb / 2, bottom);
    g.closePath();
    g.fill({ color: SHELL });
    g.stroke({ width: Math.max(1, W * 0.025), color: ink, alpha: 0.75 });
    // Shading on its right, where the light from above falls off.
    g.moveTo(cx + wb * 0.2, bottom);
    g.quadraticCurveTo(cx + wb * 0.5, top + tierH * 0.3, cx + wt * 0.3, top);
    g.lineTo(cx + wt / 2, top);
    g.quadraticCurveTo(cx + wb * 0.62, top + tierH * 0.3, cx + wb / 2, bottom);
    g.closePath();
    g.fill({ color: SHELL_DARK, alpha: 0.45 });
    // The band along its foot, spiralling: slanted, in the owner's colour.
    g.poly([
      cx - wb / 2,
      bottom - tierH * 0.02,
      cx + wb / 2,
      bottom - tierH * 0.22,
      cx + wb / 2 - W * 0.02,
      bottom - tierH * 0.36,
      cx - wb / 2 + W * 0.02,
      bottom - tierH * 0.16,
    ]);
    g.fill({ color: band });
    // The knobs at its shoulder.
    for (const side of [-1, 1]) {
      g.circle(cx + side * wb * 0.5, top + tierH * 0.35, W * 0.04);
    }
    g.fill({ color: SHELL });
    // Windows, arched, along the whorl.
    if (k > 0 && k < tiers - 1) {
      for (const f of [-0.22, 0.18]) {
        const wx = cx + wb * f;
        const wy = bottom - tierH * 0.55;
        g.roundRect(wx - W * 0.035, wy - W * 0.05, W * 0.07, W * 0.09, W * 0.035);
      }
      g.fill({ color: bandDark });
    }
  }
  // The spire's tip.
  const tip = foot - tiers * tierH;
  const wt = W * (0.86 - tiers * 0.19);
  g.poly([cx - wt / 2, tip, cx + wt / 2, tip, cx + W * 0.02, tip - W * 0.2]);
  g.fill({ color: band });
  g.stroke({ width: Math.max(1, W * 0.025), color: ink, alpha: 0.75, join: 'round' });
  // The door, arched, at its foot.
  g.roundRect(cx - W * 0.1, foot - W * 0.2, W * 0.2, W * 0.2, W * 0.1);
  g.fill({ color: bandDark });
  g.rect(cx - W * 0.1, foot - W * 0.1, W * 0.2, W * 0.1);
  g.fill({ color: bandDark });
}
