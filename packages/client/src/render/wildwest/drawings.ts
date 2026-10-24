import type { Graphics } from 'pixi.js';

/**
 * The Wild West style's drawings (ARCHIVE 14y): the frontier as the westerns showed
 * it, in warm flat colour outlined in a dark brown. Each is drawn at its origin for a tile of
 * `t` pixels, so a style can stamp it (`StampBook`); a shape drawn white takes its stamp's tint
 * as the owner's colour.
 */

/**
 * The canyon floor far below: greyer and cooler than the mesas, as distance and haze make it,
 * so with the cliffs it reads as lower ground rather than paler ground (the first sketch).
 */
export const FLOOR = 0xcdbfa6;
export const FLOOR_DARK = 0x9c8a74;
export const FLOOR_LINE = 0xdcd2bf;
export const PEBBLE = 0xb4a48a;
/** How far a mesa's cliff drops below its south edge, in tiles. */
export const CLIFF = 1.1;
/** The mesas' tops, a dusty ochre paler than the amber player. */
export const MESA = 0xe8b46c;
export const MESA_LIGHT = 0xf2c88a;
/** The cliffs' bands of red rock. */
export const ROCK = [0xb4502c, 0xc8683a, 0x9a4024, 0xd47a46] as const;
export const OUTLINE = 0x3a2416;
export const WOOD = 0x9a6a3e;
export const WOOD_DARK = 0x6a4426;
export const ADOBE = 0xd49a68;
export const SAGE = 0x8a9a5a;
export const IRON = 0x3a3634;

export function inkWidth(t: number): number {
  return Math.max(1, t * 0.06);
}

// ---------------------------------------------------------------------------------------------
// The mortar barrel (docs §3)

export type BarrelState = 'ready' | 'fire' | 'reload' | 'silenced' | 'out';

/**
 * The barrel, its foot's middle at the origin: staves of wood, bulging, a dark rim at its top.
 * Its hoops are a stamp of their own (`drawHoops`), tinted the owner's colour. `staved` for a
 * player who is out: a stave pushed in, the wood grey.
 */
export function drawBarrel(g: Graphics, t: number, staved: boolean): void {
  const u = (v: number): number => v * t;
  const ink = inkWidth(t);
  const wood = staved ? 0x8a8478 : WOOD;
  g.ellipse(0, -u(0.02), u(0.5), u(0.1));
  g.fill({ color: 0x000000, alpha: 0.22 });
  g.moveTo(-u(0.36), 0)
    .bezierCurveTo(-u(0.5), -u(0.4), -u(0.5), -u(0.7), -u(0.36), -u(1.04))
    .lineTo(u(0.36), -u(1.04))
    .bezierCurveTo(u(0.5), -u(0.7), u(0.5), -u(0.4), u(0.36), 0)
    .closePath();
  g.fill({ color: wood });
  g.stroke({ width: ink, color: OUTLINE, join: 'round' });
  for (const x of [-0.18, 0, 0.18]) {
    g.moveTo(u(x * 0.9), -u(0.04)).quadraticCurveTo(u(x * 1.25), -u(0.52), u(x * 0.9), -u(1.0));
  }
  g.stroke({ width: Math.max(0.8, u(0.025)), color: WOOD_DARK });
  g.ellipse(0, -u(1.04), u(0.36), u(0.08));
  g.fill({ color: WOOD_DARK });
  g.stroke({ width: ink, color: OUTLINE });
  if (staved) {
    g.poly([u(0.05), -u(0.95), u(0.22), -u(0.95), u(0.18), -u(0.5), u(0.04), -u(0.55)]);
    g.fill({ color: 0x2a2420 });
  }
}

/** The barrel's two hoops and a stencilled star, white for their tint. */
export function drawHoops(g: Graphics, t: number): void {
  const u = (v: number): number => v * t;
  // Broad bands, so the owner's colour reads on a barrel at a small tile.
  for (const y of [-0.24, -0.82]) {
    g.moveTo(-u(0.45), u(y)).lineTo(u(0.45), u(y));
    g.stroke({ width: Math.max(2, u(0.14)), color: 0xffffff });
  }
  star(g, 0, -u(0.53), u(0.16));
  g.fill({ color: 0xffffff });
}

/** A five-pointed star, centred. */
export function star(g: Graphics, x: number, y: number, r: number): void {
  const pts: number[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
    const k = i % 2 === 0 ? 1 : 0.45;
    pts.push(x + Math.cos(a) * r * k, y + Math.sin(a) * r * k);
  }
  g.poly(pts);
}

/**
 * The mortar, its pivot at the origin, its muzzle along +x so a stamp tilts it: a short iron tube,
 * banded, and while `fused` a stick of dynamite's fuse just showing at the muzzle, sparking.
 */
export function drawMortar(g: Graphics, t: number, fused: boolean): void {
  const u = (v: number): number => v * t;
  const ink = inkWidth(t);
  g.roundRect(-u(0.06), -u(0.13), u(0.5), u(0.26), u(0.06));
  g.fill({ color: IRON });
  g.stroke({ width: ink, color: 0x161412 });
  g.rect(u(0.36), -u(0.15), u(0.08), u(0.3));
  g.fill({ color: 0x55504a });
  g.stroke({ width: ink * 0.7, color: 0x161412 });
  if (fused) {
    g.moveTo(u(0.44), 0).quadraticCurveTo(u(0.52), -u(0.08), u(0.58), -u(0.04));
    g.stroke({ width: Math.max(1, u(0.03)), color: 0xe8d8b0 });
    g.circle(u(0.6), -u(0.05), u(0.05));
    g.fill({ color: 0xffd040 });
  }
}

/** The lid nailed shut, two planks across it in an X: a silenced gun. */
export function drawLid(g: Graphics, t: number): void {
  const u = (v: number): number => v * t;
  const ink = inkWidth(t);
  g.ellipse(0, -u(1.04), u(0.36), u(0.08));
  g.fill({ color: WOOD });
  g.stroke({ width: ink, color: OUTLINE });
  for (const s of [-1, 1]) {
    g.poly([
      -u(0.42),
      -u(1.12 + s * 0.05),
      u(0.42),
      -u(1.12 - s * 0.05),
      u(0.42),
      -u(1.0 - s * 0.05),
      -u(0.42),
      -u(1.0 + s * 0.05),
    ]);
    g.fill({ color: 0xd8b07a });
    g.stroke({ width: ink, color: OUTLINE, join: 'round' });
  }
  // The nails' heads.
  for (const x of [-0.32, 0.32]) g.circle(u(x), -u(1.06), u(0.035));
  g.fill({ color: OUTLINE });
}

/** A puff of smoke from a fired mortar, white. */
export function drawPuff(g: Graphics, t: number): void {
  const u = (v: number): number => v * t;
  for (const [x, y, r] of [
    [0, 0, 0.22],
    [0.18, -0.08, 0.16],
    [-0.15, -0.06, 0.15],
    [0.04, -0.2, 0.15],
  ] as const) {
    g.circle(u(x), u(y), u(r));
  }
  g.fill({ color: 0xf6f0e4 });
}

/** Dynamite, the shot: a red stick, its fuse and a spark, centred, along +x. */
export function drawDynamite(g: Graphics, t: number): void {
  const u = (v: number): number => v * t;
  const ink = inkWidth(t) * 0.8;
  g.roundRect(-u(0.2), -u(0.07), u(0.36), u(0.14), u(0.03));
  g.fill({ color: 0xc8302a });
  g.stroke({ width: ink, color: OUTLINE });
  g.rect(-u(0.05), -u(0.07), u(0.05), u(0.14));
  g.fill({ color: 0xf2e6c8 });
  g.moveTo(u(0.16), 0).quadraticCurveTo(u(0.24), -u(0.08), u(0.3), -u(0.05));
  g.stroke({ width: Math.max(1, u(0.03)), color: OUTLINE });
  g.circle(u(0.31), -u(0.06), u(0.05));
  g.fill({ color: 0xffd040 });
}

// ---------------------------------------------------------------------------------------------
// Buildings and windpumps (docs §2)

/**
 * A frontier building, its foot's middle at the origin, by `kind`: a saloon with swinging doors,
 * a sheriff's office with a star, a bank with a strongbox sign, a general store under an awning.
 * Boarded up once its player is out.
 */
export function drawBuilding(g: Graphics, t: number, kind: number, out: boolean): void {
  const u = (v: number): number => v * t;
  const ink = inkWidth(t);
  const wall = [0xc89a64, 0xb88a5a, 0xd8b088, 0xa87a4e][kind % 4] as number;
  g.ellipse(u(0.1), -u(0.02), u(1.1), u(0.12));
  g.fill({ color: 0x000000, alpha: 0.22 });
  // The false front, taller than the building, a sign board across it.
  g.rect(-u(0.95), -u(1.0), u(1.9), u(1.0));
  g.fill({ color: wall });
  g.stroke({ width: ink, color: OUTLINE });
  g.poly([
    -u(0.7),
    -u(1.0),
    -u(0.7),
    -u(1.5),
    -u(0.45),
    -u(1.62),
    u(0.45),
    -u(1.62),
    u(0.7),
    -u(1.5),
    u(0.7),
    -u(1.0),
  ]);
  g.fill({ color: wall });
  g.stroke({ width: ink, color: OUTLINE, join: 'round' });
  for (let k = 0; k < 6; k++) {
    g.moveTo(-u(0.9), -u(0.15 + k * 0.15)).lineTo(u(0.9), -u(0.15 + k * 0.15));
  }
  g.stroke({ width: Math.max(0.6, u(0.02)), color: WOOD_DARK, alpha: 0.5 });
  g.rect(-u(0.55), -u(1.48), u(1.1), u(0.32));
  g.fill({ color: 0xf2e6c8 });
  g.stroke({ width: ink * 0.8, color: OUTLINE });
  // The sign's device, no words: a glass, a star, a strongbox, a sack.
  const sx = 0;
  const sy = -u(1.32);
  switch (kind % 4) {
    case 0:
      g.poly([sx - u(0.1), sy - u(0.1), sx + u(0.1), sy - u(0.1), sx, sy + u(0.04)]);
      g.moveTo(sx, sy + u(0.04)).lineTo(sx, sy + u(0.12));
      g.fill({ color: 0xc8302a });
      g.stroke({ width: Math.max(0.8, u(0.025)), color: OUTLINE });
      break;
    case 1:
      star(g, sx, sy, u(0.12));
      g.fill({ color: 0xe0b030 });
      break;
    case 2:
      g.rect(sx - u(0.12), sy - u(0.08), u(0.24), u(0.16));
      g.fill({ color: 0x4a4a52 });
      g.circle(sx, sy, u(0.03));
      g.fill({ color: 0xe0b030 });
      break;
    default:
      g.ellipse(sx, sy + u(0.02), u(0.1), u(0.08));
      g.fill({ color: 0xb8925a });
      g.stroke({ width: Math.max(0.8, u(0.025)), color: OUTLINE });
      break;
  }
  if (kind % 4 === 3) {
    // The store's striped awning.
    for (let k = 0; k < 6; k++) {
      g.rect(-u(0.9) + k * u(0.3), -u(0.95), u(0.3), u(0.18));
      g.fill({ color: k % 2 === 0 ? 0xf2e6c8 : 0x6a8a9a });
    }
  }
  // The door, and two windows.
  g.rect(-u(0.15), -u(0.55), u(0.3), u(0.55));
  g.fill({ color: 0x3a2416 });
  if (kind % 4 === 0) {
    g.rect(-u(0.14), -u(0.42), u(0.13), u(0.26));
    g.rect(u(0.01), -u(0.42), u(0.13), u(0.26));
    g.fill({ color: 0xb88a56 });
  }
  for (const x of [-0.62, 0.38]) g.rect(u(x), -u(0.62), u(0.24), u(0.24));
  g.fill({ color: out ? 0x3a2416 : 0x9ad0e8 });
  if (out) {
    // Boarded up: planks across the door and the windows.
    for (const [x, w] of [
      [-0.66, 0.32],
      [-0.2, 0.4],
      [0.34, 0.32],
    ] as const) {
      g.poly([u(x), -u(0.55), u(x + w), -u(0.45), u(x + w), -u(0.38), u(x), -u(0.48)]);
    }
    g.fill({ color: 0xb88a56 });
  }
}

/**
 * The windpump's tower, its foot's middle at the origin: a lattice of three legs, a platform, a
 * trough at its foot. The wheel and tail are stamps of their own.
 */
export function drawPumpTower(g: Graphics, t: number, full: boolean): void {
  const u = (v: number): number => v * t;
  const ink = Math.max(1, t * 0.045);
  g.moveTo(-u(0.3), 0).lineTo(-u(0.05), -u(1.6));
  g.moveTo(u(0.3), 0).lineTo(u(0.05), -u(1.6));
  g.moveTo(0, 0).lineTo(0, -u(1.6));
  for (let k = 0; k < 4; k++) {
    const y0 = -u(k * 0.4);
    const y1 = -u((k + 1) * 0.4);
    const w0 = 0.3 - k * 0.0625;
    const w1 = 0.3 - (k + 1) * 0.0625;
    g.moveTo(-u(w0), y0).lineTo(u(w1), y1);
    g.moveTo(u(w0), y0).lineTo(-u(w1), y1);
  }
  g.stroke({ width: ink, color: OUTLINE });
  // The trough, water in it while the pump turns.
  g.rect(u(0.25), -u(0.2), u(0.5), u(0.18));
  g.fill({ color: WOOD });
  g.stroke({ width: ink, color: OUTLINE });
  if (full) {
    g.rect(u(0.29), -u(0.18), u(0.42), u(0.05));
    g.fill({ color: 0x6ab0d8 });
  }
}

/** The wheel of vanes, centred, white for its tint; and its hub, dark. */
export function drawPumpWheel(g: Graphics, t: number, broken: boolean): void {
  const u = (v: number): number => v * t;
  const n = 12;
  for (let k = 0; k < n; k++) {
    if (broken && k % 3 === 0) continue;
    const a = (k / n) * Math.PI * 2;
    const b = a + 0.2;
    g.poly([
      Math.cos(a) * u(0.12),
      Math.sin(a) * u(0.12),
      Math.cos(a) * u(0.48),
      Math.sin(a) * u(0.48),
      Math.cos(b) * u(0.48),
      Math.sin(b) * u(0.48),
      Math.cos(b) * u(0.12),
      Math.sin(b) * u(0.12),
    ]);
  }
  g.fill({ color: 0xffffff });
  g.circle(0, 0, u(0.08));
  g.fill({ color: OUTLINE });
}

/** The tail vane, from the hub to the left, white for its tint. */
export function drawPumpTail(g: Graphics, t: number): void {
  const u = (v: number): number => v * t;
  g.moveTo(0, 0).lineTo(-u(0.5), 0);
  g.stroke({ width: Math.max(1, u(0.04)), color: OUTLINE });
  g.poly([-u(0.4), -u(0.16), -u(0.72), -u(0.22), -u(0.72), u(0.12), -u(0.4), u(0.06)]);
  g.fill({ color: 0xffffff });
}

// ---------------------------------------------------------------------------------------------
// Tumbleweeds, scenery, the locomotive

/** A tumbleweed, centred: a ball of tangled dry stems, `r` tiles across from its middle. */
export function drawTumbleweed(g: Graphics, t: number, r = 0.32): void {
  const u = (v: number): number => v * t;
  const R = u(r);
  g.circle(0, 0, R);
  g.fill({ color: 0xc8a060, alpha: 0.35 });
  for (let k = 0; k < 9; k++) {
    const a = k * 2.39;
    const b = a + 2.2 + (k % 3) * 0.4;
    g.moveTo(Math.cos(a) * R, Math.sin(a) * R);
    g.quadraticCurveTo(
      Math.cos(a + 1.3) * R * 0.2,
      Math.sin(a + 1.3) * R * 0.2,
      Math.cos(b) * R,
      Math.sin(b) * R,
    );
  }
  g.stroke({ width: Math.max(0.8, u(0.035)), color: 0x8a6430, cap: 'round' });
  g.circle(0, 0, R);
  g.stroke({ width: Math.max(0.8, u(0.03)), color: 0x6a4a22, alpha: 0.7 });
}

/** A saguaro, its foot at the origin: a trunk and two arms, ribbed. */
export function drawSaguaro(g: Graphics, t: number): void {
  const u = (v: number): number => v * t;
  const ink = inkWidth(t);
  const green = 0x5a8a4a;
  g.ellipse(u(0.05), 0, u(0.22), u(0.06));
  g.fill({ color: 0x000000, alpha: 0.2 });
  g.roundRect(-u(0.09), -u(0.8), u(0.18), u(0.8), u(0.09));
  g.roundRect(-u(0.32), -u(0.6), u(0.13), u(0.3), u(0.065));
  g.rect(-u(0.3), -u(0.36), u(0.24), u(0.1));
  g.roundRect(u(0.19), -u(0.66), u(0.13), u(0.34), u(0.065));
  g.rect(u(0.06), -u(0.44), u(0.24), u(0.1));
  g.fill({ color: green });
  g.moveTo(0, -u(0.75)).lineTo(0, -u(0.05));
  g.stroke({ width: Math.max(0.6, u(0.02)), color: 0x3a6a2a });
  g.roundRect(-u(0.09), -u(0.8), u(0.18), u(0.8), u(0.09));
  g.roundRect(-u(0.32), -u(0.6), u(0.13), u(0.3), u(0.065));
  g.roundRect(u(0.19), -u(0.66), u(0.13), u(0.34), u(0.065));
  g.stroke({ width: ink * 0.7, color: OUTLINE });
}

/**
 * The locomotive at its water tower, the square's middle at the origin, `s` its side: a black
 * engine with a red cowcatcher and a tall funnel, puffing; `hurried`, steam shooting up and the
 * whistle's plume; `beat` the puff's phase.
 */
export function drawLocomotive(g: Graphics, s: number, beat: number, hurried: boolean): void {
  const u = (v: number): number => v * s;
  const ink = Math.max(1, s * 0.015);
  // The rails.
  g.rect(-u(0.5), u(0.3), u(1.0), u(0.03));
  g.fill({ color: 0x5a4a3a });
  for (let k = 0; k < 8; k++) g.rect(-u(0.48) + k * u(0.13), u(0.29), u(0.06), u(0.06));
  g.fill({ color: WOOD_DARK });
  // The water tower behind, on its legs.
  for (const x of [0.22, 0.42]) g.rect(u(x), -u(0.05), u(0.03), u(0.35));
  g.fill({ color: WOOD_DARK });
  g.roundRect(u(0.16), -u(0.3), u(0.32), u(0.26), u(0.04));
  g.fill({ color: WOOD });
  g.stroke({ width: ink, color: OUTLINE });
  // The engine: cab, boiler, funnel, cowcatcher, wheels.
  g.rect(-u(0.42), -u(0.12), u(0.18), u(0.32));
  g.fill({ color: 0x2a2624 });
  g.stroke({ width: ink, color: OUTLINE });
  g.roundRect(-u(0.26), -u(0.02), u(0.44), u(0.2), u(0.06));
  g.fill({ color: 0x2a2624 });
  g.stroke({ width: ink, color: OUTLINE });
  g.poly([u(0.0), -u(0.02), u(0.1), -u(0.02), u(0.13), -u(0.2), -u(0.03), -u(0.2)]);
  g.fill({ color: 0x2a2624 });
  g.stroke({ width: ink, color: OUTLINE });
  g.poly([u(0.18), u(0.06), u(0.28), u(0.28), u(0.18), u(0.28)]);
  g.fill({ color: 0xc8302a });
  for (const x of [-0.32, -0.14, 0.06]) {
    g.circle(u(x), u(0.24), u(0.065));
    g.fill({ color: 0xc8302a });
    g.stroke({ width: ink, color: OUTLINE });
  }
  // Its puffs, from the funnel, rising and spreading.
  for (let k = 0; k < 3; k++) {
    const p = (beat + k / 3) % 1;
    g.circle(u(0.05 - p * 0.2), -u(0.24 + p * 0.3), u(0.05 + p * 0.08));
    g.fill({ color: 0xf6f0e4, alpha: 0.85 * (1 - p) });
  }
  if (hurried) {
    // The whistle's plume, straight up, white.
    g.poly([-u(0.1), -u(0.04), -u(0.07), -u(0.04), -u(0.02), -u(0.42), -u(0.16), -u(0.42)]);
    g.fill({ color: 0xffffff, alpha: 0.9 });
  }
}
