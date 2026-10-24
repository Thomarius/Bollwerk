import type { Graphics } from 'pixi.js';

/**
 * The Mythology style's drawings (ARCHIVE 14x): black-figure vase painting, black
 * glaze on the clay, details incised through the black so the clay shows in fine lines, touches
 * of white and purple-red. Each is drawn at its origin for a tile of `t` pixels, so a style can
 * stamp it (`StampBook`); a shape drawn white takes its stamp's tint as the owner's colour.
 */

/** The clay: a terracotta between the crimson and amber players, so neither is ground. */
export const CLAY = 0xd98a52;
export const CLAY_LIGHT = 0xeab07c;
export const CLAY_DARK = 0xb86a38;
/** The black glaze, a warm black as fired. */
export const GLAZE = 0x1e1612;
/** The added colours. */
export const SLIP_WHITE = 0xf2e6cc;
export const PURPLE = 0x7c2a26;

/** An arc as a path of its own: moved to its first point, then drawn. */
function arcFrom(
  g: Graphics,
  x: number,
  y: number,
  r: number,
  from: number,
  to: number,
  anticlockwise = false,
): void {
  g.moveTo(x + Math.cos(from) * r, y + Math.sin(from) * r);
  g.arc(x, y, r, from, to, anticlockwise);
}

/** An inked line's width at tile `t`. */
export function inkWidth(t: number): number {
  return Math.max(1, t * 0.06);
}

/** An incised line's width: finer than the ink, the clay showing through the black. */
function incised(t: number): number {
  return Math.max(0.8, t * 0.035);
}

// ---------------------------------------------------------------------------------------------
// The onager (docs §3): its frame and its arm two stamps, the arm turned about its pivot.

/** The arm's pivot, from the frame's origin at its feet, in tiles, facing right. */
export const PIVOT = { x: -0.42, y: -0.42 };
/**
 * The arm's angle lying back loaded, and up against the crossbar having fired: the first taken
 * the long way round from the second, so a reload in between swings back over the top.
 */
export const ARM_READY = 0.22 - Math.PI;
export const ARM_FIRED = -Math.PI / 2 + 0.32;
const ARM_LENGTH = 1.05;

/**
 * The frame, its feet's middle at the origin, facing right: two side beams on four solid
 * wheels, the torsion bundle at the back, the padded crossbar standing at the front. `broken`
 * for a player who is out: the crossbar snapped, the frame askew.
 */
export function drawFrame(g: Graphics, t: number, broken: boolean): void {
  const u = (v: number): number => v * t;
  g.ellipse(0, -u(0.02), u(0.85), u(0.1));
  g.fill({ color: 0x000000, alpha: 0.18 });
  // The beam, its grain incised.
  g.roundRect(-u(0.78), -u(0.34), u(1.5), u(0.18), u(0.04));
  g.fill({ color: GLAZE });
  g.moveTo(-u(0.7), -u(0.25)).lineTo(u(0.64), -u(0.25));
  g.stroke({ width: incised(t), color: CLAY });
  // The wheels, solid discs with an incised rim and hub.
  for (const x of [-0.5, 0.42]) {
    g.circle(u(x), -u(0.14), u(0.14));
    g.fill({ color: GLAZE });
    g.circle(u(x), -u(0.14), u(0.09));
    g.circle(u(x), -u(0.14), u(0.025));
    g.stroke({ width: incised(t), color: CLAY });
  }
  // The torsion bundle: a skein of rope between the beams, incised turns.
  g.roundRect(u(PIVOT.x - 0.13), u(PIVOT.y - 0.12), u(0.26), u(0.24), u(0.06));
  g.fill({ color: GLAZE });
  for (const k of [-0.07, 0, 0.07]) {
    g.moveTo(u(PIVOT.x + k - 0.03), u(PIVOT.y - 0.1)).lineTo(
      u(PIVOT.x + k + 0.03),
      u(PIVOT.y + 0.1),
    );
  }
  g.stroke({ width: incised(t), color: CLAY });
  // The crossbar on its two posts, a white pad where the arm strikes.
  const lean = broken ? 0.35 : 0;
  g.moveTo(u(0.28), -u(0.3)).lineTo(u(0.28 + lean), -u(broken ? 0.7 : 1.08));
  g.moveTo(u(0.46), -u(0.3)).lineTo(u(0.46 + lean * 0.5), -u(broken ? 0.62 : 1.08));
  g.stroke({ width: Math.max(1.5, u(0.08)), color: GLAZE, cap: 'round' });
  if (!broken) {
    g.roundRect(u(0.18), -u(1.16), u(0.38), u(0.12), u(0.05));
    g.fill({ color: GLAZE });
    g.roundRect(u(0.22), -u(1.13), u(0.2), u(0.06), u(0.03));
    g.fill({ color: SLIP_WHITE });
  }
}

/**
 * The arm, its pivot at the origin, lying along +x so a stamp turns it about the pivot; the
 * sling's cup at its end, a stone in it while `loaded`.
 */
export function drawArm(g: Graphics, t: number, loaded: boolean): void {
  const u = (v: number): number => v * t;
  g.moveTo(0, 0).lineTo(u(ARM_LENGTH), 0);
  g.stroke({ width: Math.max(1.5, u(0.1)), color: GLAZE, cap: 'round' });
  g.moveTo(u(0.1), 0).lineTo(u(ARM_LENGTH - 0.12), 0);
  g.stroke({ width: incised(t) * 0.8, color: CLAY });
  // The cup, open away from the arm.
  // Every arc starts with a move to its first point, or it is joined to wherever the path last
  // was — the canvas's origin, across the whole board (the first look).
  arcFrom(g, u(ARM_LENGTH + 0.04), 0, u(0.14), Math.PI * 0.35, Math.PI * 1.65, true);
  g.stroke({ width: Math.max(1.2, u(0.06)), color: GLAZE, cap: 'round' });
  if (loaded) drawStone(g, t, u(ARM_LENGTH + 0.06), 0, 0.12);
}

/** A stone: black, a white highlight incised in its curve. */
export function drawStone(g: Graphics, t: number, x: number, y: number, r: number): void {
  const u = (v: number): number => v * t;
  g.circle(x, y, u(r));
  g.fill({ color: GLAZE });
  arcFrom(g, x, y, u(r * 0.62), Math.PI * 1.1, Math.PI * 1.6);
  g.stroke({ width: Math.max(0.8, u(0.03)), color: SLIP_WHITE });
}

/** A pot of burning oil, the Berthas' shot: a black jar, flames of white and purple out of it. */
export function drawFirePot(g: Graphics, t: number): void {
  const u = (v: number): number => v * t;
  g.poly([-u(0.14), -u(0.12), u(0.14), -u(0.12), u(0.18), u(0.08), 0, u(0.2), -u(0.18), u(0.08)]);
  g.fill({ color: GLAZE });
  g.moveTo(-u(0.12), u(0.02)).lineTo(u(0.12), u(0.02));
  g.stroke({ width: incised(t), color: CLAY });
  g.poly([
    -u(0.1),
    -u(0.12),
    -u(0.16),
    -u(0.34),
    0,
    -u(0.22),
    u(0.08),
    -u(0.42),
    u(0.12),
    -u(0.12),
  ]);
  g.fill({ color: PURPLE });
  g.poly([-u(0.05), -u(0.12), -u(0.06), -u(0.26), u(0.05), -u(0.3), u(0.06), -u(0.12)]);
  g.fill({ color: SLIP_WHITE });
}

/**
 * The shield hung on the frame, round, drawn white for its tint (the owner's colour), a black
 * rim and its blazon in black: an owl, a lion, a horse or a scorpion, by `blazon`.
 */
export function drawShieldFace(g: Graphics, t: number): void {
  g.circle(0, 0, t * 0.26);
  g.fill({ color: 0xffffff });
}

/** The shield's rim and blazon, black, over its tinted face. */
export function drawShieldMarks(g: Graphics, t: number, blazon: number): void {
  const u = (v: number): number => v * t;
  g.circle(0, 0, u(0.26));
  g.stroke({ width: Math.max(1.2, u(0.07)), color: GLAZE });
  switch (blazon % 4) {
    case 0:
      // An owl: a body, two eyes incised round.
      g.ellipse(0, u(0.02), u(0.08), u(0.11));
      g.fill({ color: GLAZE });
      g.circle(-u(0.035), -u(0.03), u(0.025));
      g.circle(u(0.035), -u(0.03), u(0.025));
      g.fill({ color: 0xffffff });
      break;
    case 1:
      // A lion: a maned head and a tail's curl.
      g.circle(0, 0, u(0.1));
      g.fill({ color: GLAZE });
      g.moveTo(u(0.08), u(0.06)).quadraticCurveTo(u(0.18), u(0.1), u(0.14), -u(0.04));
      g.stroke({ width: Math.max(1, u(0.035)), color: GLAZE, cap: 'round' });
      break;
    case 2:
      // A horse's head and neck.
      g.poly([
        -u(0.08),
        u(0.14),
        -u(0.05),
        -u(0.06),
        u(0.06),
        -u(0.12),
        u(0.12),
        -u(0.06),
        u(0.02),
        -u(0.02),
        u(0.04),
        u(0.14),
      ]);
      g.fill({ color: GLAZE });
      break;
    default:
      // A scorpion: a body, claws and the tail's arch.
      g.ellipse(0, u(0.03), u(0.05), u(0.08));
      g.fill({ color: GLAZE });
      g.moveTo(0, -u(0.04)).quadraticCurveTo(u(0.02), -u(0.16), u(0.1), -u(0.12));
      g.moveTo(-u(0.03), u(0.1)).lineTo(-u(0.11), u(0.15));
      g.moveTo(u(0.03), u(0.1)).lineTo(u(0.11), u(0.15));
      g.stroke({ width: Math.max(1, u(0.035)), color: GLAZE, cap: 'round' });
      break;
  }
}

// ---------------------------------------------------------------------------------------------
// The temple (docs §2): its foot's middle at the origin.

/**
 * A temple: steps, four columns, the architrave, the pediment's tympanum in the owner's colour
 * (`colour`) inside its black frame, the altar before the steps. Toppled once its player is out.
 */
export function drawTemple(g: Graphics, t: number, colour: number, out: boolean): void {
  const u = (v: number): number => v * t;
  const ink = inkWidth(t);
  g.ellipse(0, -u(0.02), u(1.15), u(0.12));
  g.fill({ color: 0x000000, alpha: 0.18 });
  for (const [w, y] of [
    [2.1, -0.12],
    [1.9, -0.24],
  ] as const) {
    g.rect(-u(w / 2), u(y), u(w), u(0.12));
    g.fill({ color: GLAZE });
    g.moveTo(-u(w / 2 - 0.04), u(y + 0.06)).lineTo(u(w / 2 - 0.04), u(y + 0.06));
    g.stroke({ width: incised(t), color: CLAY });
  }
  if (out) {
    // Two columns standing, two fallen across the steps, the roof gone.
    for (const x of [-0.7, 0.25]) {
      g.rect(u(x), -u(0.24 + (x < 0 ? 0.9 : 0.55)), u(0.16), u(x < 0 ? 0.9 : 0.55));
    }
    g.fill({ color: GLAZE });
    g.roundRect(-u(0.25), -u(0.38), u(0.9), u(0.14), u(0.05));
    g.fill({ color: GLAZE });
    g.stroke({ width: ink * 0.6, color: CLAY });
    return;
  }
  for (const x of [-0.75, -0.3, 0.14, 0.59]) {
    g.rect(u(x), -u(1.24), u(0.16), u(1.0));
    g.fill({ color: GLAZE });
    // The fluting, incised.
    g.moveTo(u(x + 0.08), -u(1.2)).lineTo(u(x + 0.08), -u(0.28));
    g.stroke({ width: incised(t), color: CLAY });
  }
  g.rect(-u(0.95), -u(1.42), u(1.9), u(0.18));
  g.fill({ color: GLAZE });
  for (let k = 0; k < 8; k++) {
    g.rect(u(-0.88 + k * 0.23), -u(1.38), u(0.1), u(0.1));
  }
  g.fill({ color: CLAY });
  const ped = [-u(1.02), -u(1.42), u(1.02), -u(1.42), 0, -u(2.0)];
  g.poly(ped);
  g.fill({ color: GLAZE });
  g.poly([-u(0.8), -u(1.48), u(0.8), -u(1.48), 0, -u(1.88)]);
  g.fill({ color: colour });
  g.stroke({ width: ink * 0.6, color: GLAZE, join: 'round' });
  // The altar before the steps.
  g.rect(u(0.82), -u(0.38), u(0.3), u(0.3));
  g.fill({ color: GLAZE });
  g.rect(u(0.86), -u(0.34), u(0.22), u(0.05));
  g.fill({ color: CLAY });
}

/** The altar fire, its foot at the origin: white at its heart, purple-red tongues round it. */
export function drawAltarFire(g: Graphics, t: number): void {
  const u = (v: number): number => v * t;
  g.poly([
    -u(0.16),
    0,
    -u(0.2),
    -u(0.3),
    -u(0.07),
    -u(0.2),
    0,
    -u(0.48),
    u(0.08),
    -u(0.22),
    u(0.2),
    -u(0.34),
    u(0.16),
    0,
  ]);
  g.fill({ color: PURPLE });
  g.poly([-u(0.08), 0, -u(0.08), -u(0.16), 0, -u(0.3), u(0.07), -u(0.15), u(0.08), 0]);
  g.fill({ color: SLIP_WHITE });
}

// ---------------------------------------------------------------------------------------------
// The meander, the mosaic

/**
 * One tile's meander, its square's top-left at (x, y), `s` across: a Greek key, its ends at the
 * left and right edges' middles so neighbouring tiles join into one running band.
 */
export function meanderPath(x: number, y: number, s: number): number[] {
  const p = (a: number, b: number): [number, number] => [x + a * s, y + b * s];
  return [
    ...p(0, 0.5),
    ...p(0.18, 0.5),
    ...p(0.18, 0.18),
    ...p(0.82, 0.18),
    ...p(0.82, 0.82),
    ...p(0.42, 0.82),
    ...p(0.42, 0.42),
    ...p(0.6, 0.42),
    ...p(0.6, 0.62),
  ];
}

/**
 * The mosaic for sealed ground, drawn on a canvas `cell` pixels to a tessera: tesserae in the
 * owner's `colour`, a diamond of the clay's light shade every few, the grout dark between them.
 * Returned as the canvas, for a `FillPattern`.
 */
export function mosaicCanvas(cell: number, colour: number): HTMLCanvasElement {
  const n = 6;
  const canvas = document.createElement('canvas');
  canvas.width = cell * n;
  canvas.height = cell * n;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return canvas;
  const css = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;
  ctx.fillStyle = css(GLAZE);
  ctx.globalAlpha = 0.35;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalAlpha = 1;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      // A diamond of light tesserae at the pattern's middle, the rest the owner's colour.
      const d = Math.abs(x - 2.5) + Math.abs(y - 2.5);
      ctx.fillStyle = d <= 1 ? css(SLIP_WHITE) : d === 2 ? css(CLAY_LIGHT) : css(colour);
      const gap = Math.max(1, cell * 0.14);
      ctx.fillRect(x * cell + gap / 2, y * cell + gap / 2, cell - gap, cell - gap);
    }
  }
  return canvas;
}

// ---------------------------------------------------------------------------------------------
// Sisyphus, the gods

/**
 * Sisyphus in black figure, his feet's middle at the origin, facing right (up his slope): `push`
 * leaning into the boulder ahead of him, `stand` at the top watching it roll away, `walk` going
 * back down after it; `step` 0 to 1 a stride. `u` his height.
 */
export function drawSisyphus(
  g: Graphics,
  u: number,
  step: number,
  pose: 'push' | 'stand' | 'walk',
  ox = 0,
  oy = 0,
  dir = 1,
): void {
  const swing = pose === 'stand' ? 0 : Math.sin(step * Math.PI * 2) * 0.12;
  const at = (x: number, y: number): [number, number] => [ox + dir * x * u, oy + y * u];
  const lean = pose === 'push' ? 0.5 : 0.06;
  const hip = at(0, -0.48);
  const neck = at(lean * 0.55, -0.98);
  g.moveTo(...hip).lineTo(...at(-0.2 + swing, 0));
  g.moveTo(...hip)
    .lineTo(...at(0.1 - swing, -0.22))
    .lineTo(...at(0.16 - swing, 0));
  g.stroke({ width: Math.max(1.5, u * 0.09), color: GLAZE, cap: 'round', join: 'round' });
  g.moveTo(...hip).lineTo(...neck);
  g.stroke({ width: Math.max(2, u * 0.16), color: GLAZE, cap: 'round' });
  if (pose === 'push') {
    g.moveTo(...neck).lineTo(...at(0.62, -0.92));
    g.moveTo(...at(lean * 0.5, -0.9)).lineTo(...at(0.62, -0.78));
  } else {
    // Arms hanging: at the top in despair, on the way down swinging.
    g.moveTo(...neck).lineTo(...at(lean * 0.55 + 0.12 + swing * 0.5, -0.56));
    g.moveTo(...neck).lineTo(...at(lean * 0.55 - 0.12 - swing * 0.5, -0.56));
  }
  g.stroke({ width: Math.max(1.2, u * 0.07), color: GLAZE, cap: 'round' });
  g.circle(...at(lean * 0.62, -1.1), u * 0.1);
  g.fill({ color: GLAZE });
  // His beard jutting, an incised eye.
  g.poly([
    ...at(lean * 0.62 + 0.04, -1.05),
    ...at(lean * 0.62 + 0.16, -1.0),
    ...at(lean * 0.62 + 0.06, -0.94),
  ]);
  g.fill({ color: GLAZE });
  g.circle(...at(lean * 0.66, -1.12), u * 0.015);
  g.fill({ color: CLAY });
}

/** The boulder, its middle at (x, y), `u` Sisyphus's height: black, a curve incised. */
export function drawBoulder(g: Graphics, u: number, turn: number, x = 0, y = 0): void {
  g.circle(x, y, u * 0.36);
  g.fill({ color: GLAZE });
  arcFrom(g, x, y, u * 0.25, Math.PI * 1.1 + turn, Math.PI * 1.55 + turn);
  g.stroke({ width: Math.max(0.8, u * 0.03), color: CLAY });
}

/**
 * One of the gods watching, in black figure from the shoulders up, facing right, leaning out of
 * a cloud of white slip: Zeus bearded, Hera crowned, Athena helmed, Poseidon with his trident.
 * `u` the head's size.
 */
export function drawGod(g: Graphics, u: number, which: number): void {
  // The cloud he leans out of.
  for (const [x, y, r] of [
    [-1.2, 1.1, 0.9],
    [-0.2, 1.3, 1.0],
    [0.9, 1.15, 0.85],
    [1.8, 1.4, 0.7],
  ] as const) {
    g.circle(x * u, y * u, r * u);
  }
  g.fill({ color: SLIP_WHITE });
  // Shoulders, neck and head in profile, facing right: a straight Greek nose, an incised eye.
  // The shoulders low, so a beard stands out against the cloud and not against them.
  g.ellipse(-u * 0.1, u * 1.3, u * 0.95, u * 0.4);
  g.rect(-u * 0.32, u * 0.2, u * 0.36, u * 1.0);
  g.circle(0, 0, u * 0.5);
  g.poly([u * 0.4, -u * 0.2, u * 0.66, u * 0.12, u * 0.42, u * 0.16]);
  g.fill({ color: GLAZE });
  g.circle(u * 0.26, -u * 0.08, u * 0.07);
  g.fill({ color: SLIP_WHITE });
  g.circle(u * 0.28, -u * 0.08, u * 0.03);
  g.fill({ color: GLAZE });
  // The hair's incised waves over the head, and the garment's fold at the shoulder.
  g.moveTo(-u * 0.4, -u * 0.05).quadraticCurveTo(-u * 0.15, -u * 0.2, u * 0.05, -u * 0.35);
  g.moveTo(-u * 0.42, u * 0.12).quadraticCurveTo(-u * 0.2, -u * 0.02, 0, -u * 0.18);
  g.moveTo(-u * 0.6, u * 1.2).quadraticCurveTo(-u * 0.2, u * 1.05, u * 0.3, u * 1.2);
  g.stroke({ width: Math.max(0.8, u * 0.045), color: CLAY });
  const male = which % 4 === 0 || which % 4 === 3;
  if (male) {
    // The beard: full, falling to a point below the chin, its curls incised. Zeus's the longer:
    // he is not Zeus without it (the user's, 2026-10-24).
    const long = which % 4 === 0 ? 1.25 : 1.0;
    // Jutting forward and down past the neck, so its point is seen against the cloud.
    g.moveTo(-u * 0.12, u * 0.08)
      .quadraticCurveTo(u * 0.2, u * 0.32, u * 0.52, u * 0.2)
      .quadraticCurveTo(u * 0.72, u * 0.55, u * 0.78, u * long)
      .quadraticCurveTo(u * 0.5, u * (long - 0.2), u * 0.2, u * (long - 0.28))
      .quadraticCurveTo(0, u * 0.5, -u * 0.12, u * 0.08);
    g.fill({ color: GLAZE });
    for (let k = 0; k < 4; k++) {
      const y = u * (0.36 + k * (long - 0.4) * 0.24);
      g.moveTo(u * (0.18 + k * 0.05), y).quadraticCurveTo(
        u * (0.36 + k * 0.05),
        y + u * 0.1,
        u * (0.6 + k * 0.03),
        y,
      );
    }
    g.stroke({ width: Math.max(0.8, u * 0.045), color: CLAY });
    // A moustache over the beard, white-incised at its edge.
    g.moveTo(u * 0.36, u * 0.2).quadraticCurveTo(u * 0.5, u * 0.26, u * 0.56, u * 0.36);
    g.stroke({ width: Math.max(0.8, u * 0.04), color: CLAY });
  }
  switch (which % 4) {
    case 0:
      // Zeus: a fillet of purple-red round his head.
      g.moveTo(-u * 0.48, -u * 0.18).quadraticCurveTo(0, -u * 0.48, u * 0.42, -u * 0.26);
      g.stroke({ width: Math.max(1, u * 0.08), color: PURPLE });
      break;
    case 1:
      // Hera: a crown, white.
      g.poly([
        -u * 0.4,
        -u * 0.35,
        -u * 0.3,
        -u * 0.75,
        -u * 0.1,
        -u * 0.48,
        u * 0.08,
        -u * 0.8,
        u * 0.2,
        -u * 0.48,
        u * 0.4,
        -u * 0.72,
        u * 0.42,
        -u * 0.32,
      ]);
      g.fill({ color: SLIP_WHITE });
      g.stroke({ width: Math.max(0.8, u * 0.04), color: GLAZE });
      break;
    case 2:
      // Athena: a crested helmet pushed back.
      g.ellipse(-u * 0.05, -u * 0.35, u * 0.55, u * 0.32);
      g.fill({ color: GLAZE });
      g.moveTo(-u * 0.6, -u * 0.5).quadraticCurveTo(-u * 0.1, -u * 1.15, u * 0.4, -u * 0.6);
      g.stroke({ width: Math.max(1.5, u * 0.16), color: PURPLE, cap: 'round' });
      break;
    default:
      // Poseidon: his trident up behind him.
      g.moveTo(-u * 0.75, u * 1.2).lineTo(-u * 0.75, -u * 1.0);
      g.stroke({ width: Math.max(1, u * 0.08), color: GLAZE });
      g.moveTo(-u * 1.0, -u * 0.8).lineTo(-u * 1.0, -u * 1.05);
      g.moveTo(-u * 0.5, -u * 0.8).lineTo(-u * 0.5, -u * 1.05);
      g.moveTo(-u * 1.0, -u * 0.8).lineTo(-u * 0.5, -u * 0.8);
      g.stroke({ width: Math.max(1, u * 0.07), color: GLAZE, cap: 'round' });
      break;
  }
}
