import type { Graphics } from 'pixi.js';

/**
 * The Anime style's guns: chibi figures of eight clans, one clan to a team, the hair in the
 * owner's colour (ARCHIVE 14w). Each drawing is made once per tile size and stamped
 * (`StampBook`); a state is a drawing of its own, the face and marks with it.
 *
 * Everything is in tiles, the origin at the figure's feet, facing right (+x), y down as on
 * screen; a gun is 2×2 tiles, so a figure stands about 1.7 tiles tall. Chibi: the head is
 * nearly half of it, so a face still has eyes at a 12-pixel tile.
 */

export const CLANS = [
  'karate',
  'mage',
  'maid',
  'genius',
  'soldier',
  'sword',
  'mecha',
  'idol',
] as const;
export type Clan = (typeof CLANS)[number];

export type Hairstyle = 'spiky' | 'bob' | 'long' | 'pony' | 'twin' | 'bun' | 'neat';

/** Two hairstyles a clan, by gun, so an island is one clan without being one figure. */
export const CLAN_HAIR: Record<Clan, readonly [Hairstyle, Hairstyle]> = {
  karate: ['spiky', 'bob'],
  mage: ['long', 'neat'],
  maid: ['bun', 'twin'],
  genius: ['neat', 'long'],
  soldier: ['spiky', 'pony'],
  sword: ['pony', 'long'],
  mecha: ['spiky', 'bob'],
  idol: ['twin', 'bun'],
};

/** A gun's states as the style shows them (§2.1). */
export const GUN_STATES = ['charge', 'ready', 'fire', 'inert', 'lulled', 'out'] as const;
export type GunState = (typeof GUN_STATES)[number];

type Stance = 'idle' | 'ready' | 'fire';
type Face = 'calm' | 'determined' | 'shout' | 'worried' | 'sleep' | 'spiral';

export interface HairColours {
  base: number;
  light: number;
  dark: number;
}

export interface FigureLook {
  clan: Clan;
  hairstyle: Hairstyle;
  hair: HairColours;
  state: GunState;
  /** How far the charge has come, 0 to 1: the shot's flight so far, which is the reload. */
  charge?: number;
  /** Whether the aura is drawn with the figure; the board stamps it apart, to grow it. */
  aura?: boolean;
}

export const INK = 0x2b1d2e;
const SKIN = 0xffe2cc;
const SKIN_SHADE = 0xf3b89c;
const WHITE = 0xffffff;
const BLUSH = 0xff8a9a;
const GREY_HAIR: HairColours = { base: 0x9c9aa6, light: 0xc8c6d0, dark: 0x67656f };

/** The head: chibi, nearly half the figure. */
const HX = 0.03;
const HY = -1.18;
const HR = 0.4;
/**
 * The shoulders at the torso's edges, so an arm hangs from the body's side rather than out of
 * its chest (the first sketch had them inside the torso); wider for a power suit.
 */
function shoulders(outfit: Outfit): readonly [P, P] {
  const x = outfit.bulky === true ? 0.3 : 0.19;
  return [
    { x: -x, y: -0.74 },
    { x, y: -0.74 },
  ];
}

interface P {
  x: number;
  y: number;
}

/** A pen in tiles: every coordinate scaled by the tile, every outline the same ink. */
class Pen {
  readonly ink: number;
  constructor(
    readonly g: Graphics,
    readonly t: number,
  ) {
    this.ink = Math.max(0.9, t * 0.045);
  }

  circle(x: number, y: number, r: number, fill: number, outline = true, alpha = 1): void {
    this.g.circle(x * this.t, y * this.t, r * this.t);
    this.g.fill({ color: fill, alpha });
    if (outline) this.g.stroke({ width: this.ink, color: INK, alpha });
  }

  ellipse(x: number, y: number, rx: number, ry: number, fill: number, outline = true): void {
    this.g.ellipse(x * this.t, y * this.t, rx * this.t, ry * this.t);
    this.g.fill({ color: fill });
    if (outline) this.g.stroke({ width: this.ink, color: INK });
  }

  poly(points: readonly number[], fill: number, outline = true, alpha = 1): void {
    this.g.poly(points.map((v) => v * this.t));
    this.g.fill({ color: fill, alpha });
    if (outline) this.g.stroke({ width: this.ink, color: INK, join: 'round', alpha });
  }

  rect(x: number, y: number, w: number, h: number, r: number, fill: number, outline = true): void {
    this.g.roundRect(x * this.t, y * this.t, w * this.t, h * this.t, r * this.t);
    this.g.fill({ color: fill });
    if (outline) this.g.stroke({ width: this.ink, color: INK });
  }

  /** A thick stroke with an ink edge: drawn twice, ink wider beneath. */
  limb(points: readonly P[], width: number, colour: number): void {
    for (const [w, c] of [
      [width * this.t + this.ink * 2, INK],
      [width * this.t, colour],
    ] as const) {
      const [first, ...rest] = points;
      if (first === undefined) return;
      this.g.moveTo(first.x * this.t, first.y * this.t);
      for (const p of rest) this.g.lineTo(p.x * this.t, p.y * this.t);
      this.g.stroke({ width: w, color: c, cap: 'round', join: 'round' });
    }
  }

  line(points: readonly P[], width: number, colour: number, alpha = 1): void {
    const [first, ...rest] = points;
    if (first === undefined) return;
    this.g.moveTo(first.x * this.t, first.y * this.t);
    for (const p of rest) this.g.lineTo(p.x * this.t, p.y * this.t);
    this.g.stroke({
      width: Math.max(0.8, width * this.t),
      color: colour,
      alpha,
      cap: 'round',
      join: 'round',
    });
  }

  /** A four-pointed glint, anime's sparkle. */
  glint(x: number, y: number, r: number, colour = WHITE): void {
    const k = r * 0.28;
    this.poly(
      [
        x,
        y - r,
        x + k,
        y - k,
        x + r,
        y,
        x + k,
        y + k,
        x,
        y + r,
        x - k,
        y + k,
        x - r,
        y,
        x - k,
        y - k,
      ],
      colour,
      false,
    );
  }
}

// ---------------------------------------------------------------------------------------------
// Outfits

interface Outfit {
  /** The torso's cloth, the sleeves' and the legs'. */
  top: number;
  sleeve: number;
  legs: number;
  shoes: number;
  /** A skirt or robe over the legs, from the waist: its colour and its hem's height. */
  skirt?: { colour: number; hem: number; flare: number };
  /** Bulky, as a power suit is. */
  bulky?: boolean;
}

const OUTFIT: Record<Clan, Outfit> = {
  karate: { top: 0xf7f5ef, sleeve: 0xf7f5ef, legs: 0xf7f5ef, shoes: SKIN },
  mage: {
    top: 0x2c3358,
    sleeve: 0x2c3358,
    legs: 0x2c3358,
    shoes: 0x3a2a20,
    skirt: { colour: 0x2c3358, hem: -0.02, flare: 0.36 },
  },
  maid: {
    top: 0x24232e,
    sleeve: 0x24232e,
    legs: 0xf4f2f8,
    shoes: 0x24232e,
    skirt: { colour: 0x24232e, hem: -0.2, flare: 0.4 },
  },
  genius: { top: 0x3f3a52, sleeve: 0x3f3a52, legs: 0x2e2b3a, shoes: 0x4a3426 },
  soldier: { top: 0x66733f, sleeve: 0x66733f, legs: 0x55602f, shoes: 0x3a3226 },
  sword: {
    top: 0xb9c7d6,
    sleeve: 0xb9c7d6,
    legs: 0x2c3150,
    shoes: 0x5a4632,
    skirt: { colour: 0x2c3150, hem: -0.06, flare: 0.36 },
  },
  mecha: { top: 0x8b93a3, sleeve: 0x8b93a3, legs: 0x5e6575, shoes: 0x4a505e, bulky: true },
  idol: {
    top: 0xfdfbff,
    sleeve: 0xfdfbff,
    legs: SKIN,
    shoes: 0xfdfbff,
    skirt: { colour: 0xfdfbff, hem: -0.24, flare: 0.44 },
  },
};

const GOLD = 0xf0c445;
const MECHA_GLOW = 0x5ff3e6;
const MECHA_PAD = 0x6c7486;

// ---------------------------------------------------------------------------------------------
// Hands, by clan and stance: [behind, before]

const HANDS: Record<Clan, Record<Stance, readonly [P, P]>> = {
  karate: {
    idle: [
      { x: 0.02, y: -0.55 },
      { x: 0.34, y: -0.7 },
    ],
    ready: [
      { x: -0.32, y: -0.48 },
      { x: -0.22, y: -0.44 },
    ],
    fire: [
      { x: 0.5, y: -0.7 },
      { x: 0.54, y: -0.6 },
    ],
  },
  mage: {
    idle: [
      { x: -0.26, y: -0.46 },
      { x: 0.3, y: -0.5 },
    ],
    ready: [
      { x: -0.3, y: -0.52 },
      { x: 0.32, y: -1.0 },
    ],
    fire: [
      { x: -0.3, y: -0.5 },
      { x: 0.46, y: -0.82 },
    ],
  },
  maid: {
    idle: [
      { x: 0.06, y: -0.46 },
      { x: 0.14, y: -0.44 },
    ],
    ready: [
      { x: -0.24, y: -0.5 },
      { x: 0.36, y: -0.98 },
    ],
    fire: [
      { x: -0.26, y: -0.52 },
      { x: 0.56, y: -0.72 },
    ],
  },
  genius: {
    idle: [
      { x: -0.24, y: -0.5 },
      { x: 0.2, y: -0.42 },
    ],
    ready: [
      { x: -0.24, y: -0.5 },
      { x: 0.22, y: -1.12 },
    ],
    fire: [
      { x: -0.24, y: -0.5 },
      { x: 0.56, y: -0.86 },
    ],
  },
  soldier: {
    idle: [
      { x: -0.08, y: -0.48 },
      { x: 0.22, y: -0.56 },
    ],
    ready: [
      { x: -0.02, y: -0.86 },
      { x: 0.26, y: -0.84 },
    ],
    fire: [
      { x: -0.02, y: -0.86 },
      { x: 0.26, y: -0.84 },
    ],
  },
  sword: {
    idle: [
      { x: -0.04, y: -0.5 },
      { x: 0.22, y: -0.56 },
    ],
    ready: [
      { x: 0.0, y: -0.48 },
      { x: 0.3, y: -0.58 },
    ],
    fire: [
      { x: -0.3, y: -0.56 },
      { x: 0.52, y: -0.98 },
    ],
  },
  mecha: {
    idle: [
      { x: -0.3, y: -0.38 },
      { x: 0.3, y: -0.38 },
    ],
    ready: [
      { x: -0.32, y: -0.42 },
      { x: 0.56, y: -0.74 },
    ],
    fire: [
      { x: -0.32, y: -0.42 },
      { x: 0.5, y: -0.74 },
    ],
  },
  idol: {
    idle: [
      { x: -0.24, y: -0.5 },
      { x: 0.22, y: -0.78 },
    ],
    ready: [
      { x: -0.42, y: -1.18 },
      { x: 0.3, y: -0.98 },
    ],
    fire: [
      { x: -0.36, y: -0.6 },
      { x: 0.58, y: -1.0 },
    ],
  },
};

const STATE: Record<GunState, { stance: Stance; face: Face }> = {
  charge: { stance: 'idle', face: 'calm' },
  ready: { stance: 'ready', face: 'determined' },
  fire: { stance: 'fire', face: 'shout' },
  inert: { stance: 'idle', face: 'worried' },
  lulled: { stance: 'idle', face: 'sleep' },
  out: { stance: 'idle', face: 'spiral' },
};

// ---------------------------------------------------------------------------------------------
// The figure

export function drawFigure(g: Graphics, t: number, look: FigureLook): void {
  const pen = new Pen(g, t);
  const { stance, face } = STATE[look.state];
  const hair = look.state === 'out' ? GREY_HAIR : look.hair;
  const outfit = OUTFIT[look.clan];
  const [handB, handF] = HANDS[look.clan][stance];
  const [shoulderB, shoulderF] = shoulders(outfit);

  if (look.aura !== false && (look.state === 'ready' || look.state === 'charge')) {
    aura(pen, hair, look.state === 'ready' ? 1 : (look.charge ?? 0.5));
  }
  if (look.state === 'fire') speedLines(pen);

  backProp(pen, look.clan, stance, look.state);
  hairBack(pen, look.hairstyle, hair);
  arm(pen, shoulderB, handB, outfit);
  body(pen, look.clan, outfit);
  head(pen);
  faceOf(pen, look.clan, face, look.state);
  hairFront(pen, look.hairstyle, hair);
  headwear(pen, look.clan);
  frontProp(pen, look.clan, stance, look.state, handF);
  if (!(look.clan === 'mecha' && stance !== 'idle')) arm(pen, shoulderF, handF, outfit);
  else mechaArm(pen, shoulderF, handF, look.state);
  // The suit's near shoulder pad over the arm, which comes out from under it.
  if (look.clan === 'mecha') pen.rect(0.2, -0.9, 0.22, 0.2, 0.06, MECHA_PAD);
  handProp(pen, look.clan, stance, look.state, handF);
  marks(pen, look.state);
}

/** The aura alone, its foot at the origin: at full charge, or half, scaled while charging. */
export function drawAura(g: Graphics, t: number, hair: HairColours, full: boolean): void {
  aura(new Pen(g, t), hair, full ? 1 : 0.999);
}

function aura(pen: Pen, hair: HairColours, charge: number): void {
  // Flame tongues licking upwards from the feet, crisp edged in the owner's colour: a muddy
  // glow over the grass read as a shadow (the first sketch).
  const k = 0.45 + 0.55 * charge;
  // The outline, from the right foot round over the head to the left: tongues licking up.
  const OUTLINE = [
    0.46, 0, 0.62, -0.5, 0.54, -0.86, 0.72, -1.3, 0.5, -1.4, 0.48, -1.86, 0.24, -1.7, 0.06, -2.1,
    -0.12, -1.72, -0.36, -1.96, -0.42, -1.56, -0.68, -1.5, -0.56, -1.0, -0.66, -0.56, -0.46, 0,
  ];
  const tongue = (scale: number): number[] =>
    OUTLINE.map((v, i) => (i % 2 === 0 ? v * scale : v * scale * k));
  pen.poly(tongue(1), hair.light, false, 0.55);
  pen.g.poly(tongue(1).map((v) => v * pen.t));
  pen.g.stroke({ width: pen.ink, color: hair.base, alpha: 0.9, join: 'round' });
  if (charge >= 1) pen.poly(tongue(0.7), WHITE, false, 0.6);
}

function speedLines(pen: Pen): void {
  for (const [y, len] of [
    [-1.45, 0.5],
    [-1.1, 0.7],
    [-0.75, 0.55],
    [-0.4, 0.65],
    [-0.12, 0.4],
  ] as const) {
    pen.line(
      [
        { x: -0.5, y },
        { x: -0.5 - len, y },
      ],
      0.05,
      WHITE,
      0.85,
    );
  }
}

function arm(pen: Pen, shoulder: P, hand: P, outfit: Outfit): void {
  pen.limb([shoulder, hand], outfit.bulky === true ? 0.2 : 0.13, outfit.sleeve);
  pen.circle(hand.x, hand.y, 0.075, SKIN);
}

function mechaArm(pen: Pen, shoulder: P, hand: P, state: GunState): void {
  pen.limb([shoulder, hand], 0.2, OUTFIT.mecha.sleeve);
  // The rocket punch: the fist is the shot, gone while it flies; flame at the stump on firing.
  if (state === 'fire') {
    pen.poly(
      [hand.x, hand.y - 0.09, hand.x + 0.34, hand.y, hand.x, hand.y + 0.09],
      0xffb43a,
      false,
    );
  }
  if (state === 'ready') drawFist(pen, hand.x + 0.06, hand.y);
}

function drawFist(pen: Pen, x: number, y: number): void {
  pen.rect(x - 0.13, y - 0.13, 0.26, 0.26, 0.07, 0x9aa3b4);
  pen.line(
    [
      { x: x + 0.12, y: y - 0.08 },
      { x: x + 0.12, y: y + 0.08 },
    ],
    0.05,
    MECHA_GLOW,
  );
}

function body(pen: Pen, clan: Clan, outfit: Outfit): void {
  const bulky = outfit.bulky === true;
  // Legs, short: chibi.
  for (const x of [-0.11, 0.11]) {
    pen.rect(x - 0.075, -0.32, 0.15, 0.3, 0.05, outfit.legs);
    pen.ellipse(x + 0.03, -0.03, bulky ? 0.12 : 0.1, 0.055, outfit.shoes);
  }
  const w = bulky ? 0.32 : 0.25;
  if (outfit.skirt !== undefined) {
    const { colour, hem, flare } = outfit.skirt;
    pen.poly([-w * 0.9, -0.5, w * 0.9, -0.5, flare, hem, -flare, hem], colour);
  }
  pen.rect(-w, -0.86, w * 2, 0.5, 0.13, outfit.top);
  switch (clan) {
    case 'karate':
      // The gi's crossed collar and the black belt.
      pen.line(
        [
          { x: -0.1, y: -0.84 },
          { x: 0.08, y: -0.56 },
        ],
        0.03,
        INK,
      );
      pen.line(
        [
          { x: 0.12, y: -0.84 },
          { x: 0.02, y: -0.66 },
        ],
        0.03,
        INK,
      );
      pen.rect(-0.26, -0.46, 0.52, 0.08, 0.02, 0x1c1a20, false);
      pen.line(
        [
          { x: 0.12, y: -0.4 },
          { x: 0.18, y: -0.26 },
        ],
        0.04,
        0x1c1a20,
      );
      break;
    case 'mage':
      pen.line(
        [
          { x: 0.0, y: -0.84 },
          { x: 0.0, y: -0.04 },
        ],
        0.04,
        GOLD,
      );
      pen.line(
        [
          { x: -0.34, y: -0.06 },
          { x: 0.34, y: -0.06 },
        ],
        0.04,
        GOLD,
      );
      break;
    case 'maid':
      // The white apron and its frill.
      pen.poly([-0.14, -0.62, 0.16, -0.62, 0.26, -0.24, -0.24, -0.24], WHITE);
      pen.rect(-0.12, -0.82, 0.24, 0.2, 0.04, WHITE);
      break;
    case 'genius':
      // Shirt, tie, the blazer's lapels.
      pen.poly([-0.08, -0.85, 0.12, -0.85, 0.02, -0.5], WHITE, false);
      pen.poly([0.0, -0.8, 0.05, -0.8, 0.06, -0.56, 0.025, -0.5, -0.01, -0.56], 0x2f5d50, false);
      pen.rect(-0.25, -0.42, 0.5, 0.08, 0.02, 0x2e2b3a, false);
      break;
    case 'soldier':
      pen.rect(-0.18, -0.66, 0.14, 0.12, 0.02, 0x55602f);
      pen.rect(0.05, -0.66, 0.14, 0.12, 0.02, 0x55602f);
      pen.rect(-0.25, -0.44, 0.5, 0.07, 0.02, 0x3a3226, false);
      break;
    case 'sword':
      pen.line(
        [
          { x: -0.1, y: -0.84 },
          { x: 0.1, y: -0.5 },
        ],
        0.035,
        0x2c3150,
      );
      pen.rect(-0.26, -0.5, 0.52, 0.08, 0.02, 0x2c3150, false);
      break;
    case 'mecha':
      // Shoulder pads, the chest's light, and a thruster pack behind.
      pen.rect(-0.42, -0.9, 0.22, 0.2, 0.06, MECHA_PAD);
      pen.circle(0.02, -0.66, 0.06, MECHA_GLOW);
      break;
    case 'idol':
      pen.poly([-0.12, -0.6, 0.0, -0.66, 0.12, -0.6, 0.0, -0.54], GOLD);
      pen.line(
        [
          { x: -0.36, y: -0.24 },
          { x: 0.38, y: -0.24 },
        ],
        0.035,
        GOLD,
      );
      break;
  }
}

function head(pen: Pen): void {
  pen.circle(HX, HY, HR, SKIN);
  // The ear on the far side of the face, a nub.
  pen.ellipse(HX - 0.3, HY + 0.05, 0.06, 0.08, SKIN_SHADE, false);
}

// ---------------------------------------------------------------------------------------------
// Faces: the eyes and mouth facing right, three-quarters.

const EYE_N = { x: HX + 0.06, y: HY + 0.06 };
const EYE_F = { x: HX + 0.28, y: HY + 0.06 };
const MOUTH = { x: HX + 0.2, y: HY + 0.25 };

function faceOf(pen: Pen, clan: Clan, face: Face, state: GunState): void {
  const glasses = clan === 'genius';
  const glare = glasses && (state === 'ready' || state === 'fire');
  if (!glare) eyes(pen, face, clan === 'idol' && state === 'ready');
  mouth(pen, face);
  if (face === 'calm' || face === 'shout' || face === 'sleep') {
    pen.ellipse(EYE_N.x - 0.06, EYE_N.y + 0.14, 0.06, 0.03, BLUSH, false);
  }
  if (glasses) {
    for (const e of [EYE_N, EYE_F]) {
      const w = e === EYE_F ? 0.07 : 0.1;
      pen.g.roundRect(
        (e.x - w) * pen.t,
        (e.y - 0.085) * pen.t,
        w * 2 * pen.t,
        0.17 * pen.t,
        0.04 * pen.t,
      );
      if (glare) pen.g.fill({ color: WHITE });
      pen.g.stroke({ width: pen.ink, color: INK });
    }
    if (glare) pen.glint(EYE_F.x + 0.08, EYE_F.y - 0.1, 0.13);
  }
}

function eyes(pen: Pen, face: Face, wink: boolean): void {
  for (const e of [EYE_N, EYE_F]) {
    const w = e === EYE_F ? 0.05 : 0.065;
    if (face === 'sleep' || (wink && e === EYE_F)) {
      // Closed: an arc, the lashes down — or up for the wink.
      const dy = wink ? 0.02 : -0.01;
      pen.line(
        [
          { x: e.x - w, y: e.y + dy },
          { x: e.x, y: e.y + 0.04 - dy * 2 },
          { x: e.x + w, y: e.y + dy },
        ],
        0.035,
        INK,
      );
      continue;
    }
    if (face === 'spiral') {
      const pts: P[] = [];
      for (let i = 0; i <= 16; i++) {
        const a = i * 0.8;
        const r = (i / 16) * 0.075;
        pts.push({ x: e.x + Math.cos(a) * r, y: e.y + Math.sin(a) * r });
      }
      pen.line(pts, 0.025, INK);
      continue;
    }
    if (face === 'worried') {
      // White eyes, the pupils tiny: shock.
      pen.ellipse(e.x, e.y, w, 0.085, WHITE);
      pen.circle(e.x + 0.01, e.y, 0.022, INK, false);
      continue;
    }
    if (face === 'shout') {
      // > < squeezed shut with effort.
      const s = e === EYE_N ? 1 : -1;
      pen.line(
        [
          { x: e.x - w * s, y: e.y - 0.05 },
          { x: e.x + w * s * 0.6, y: e.y },
          { x: e.x - w * s, y: e.y + 0.05 },
        ],
        0.035,
        INK,
      );
      continue;
    }
    pen.ellipse(e.x, e.y, w, 0.095, INK, false);
    pen.circle(e.x - 0.015, e.y - 0.035, 0.03, WHITE, false);
    if (face === 'determined') {
      // Brows down towards the nose.
      const inner = e === EYE_N ? 1 : -1;
      pen.line(
        [
          { x: e.x - w * inner, y: e.y - 0.17 },
          { x: e.x + w * inner, y: e.y - 0.12 },
        ],
        0.035,
        INK,
      );
    }
  }
}

function mouth(pen: Pen, face: Face): void {
  const { x, y } = MOUTH;
  switch (face) {
    case 'calm':
      pen.line(
        [
          { x: x - 0.04, y },
          { x, y: y + 0.025 },
          { x: x + 0.04, y },
        ],
        0.025,
        INK,
      );
      break;
    case 'determined':
      pen.line(
        [
          { x: x - 0.04, y: y + 0.01 },
          { x: x + 0.04, y: y + 0.01 },
        ],
        0.03,
        INK,
      );
      break;
    case 'shout':
      pen.poly(
        [x - 0.07, y - 0.04, x + 0.07, y - 0.04, x + 0.04, y + 0.08, x - 0.04, y + 0.08],
        0xb83a4a,
      );
      break;
    case 'worried':
      pen.line(
        [
          { x: x - 0.06, y },
          { x: x - 0.03, y: y - 0.02 },
          { x: x, y },
          { x: x + 0.03, y: y - 0.02 },
          { x: x + 0.06, y },
        ],
        0.025,
        INK,
      );
      break;
    case 'sleep':
      pen.circle(x, y, 0.025, INK, false);
      break;
    case 'spiral':
      pen.ellipse(x, y + 0.01, 0.04, 0.05, 0x6a2a36);
      break;
  }
}

// ---------------------------------------------------------------------------------------------
// Hair, in the owner's colour: a mass behind the head, bangs over it, a highlight band.

function hairBack(pen: Pen, style: Hairstyle, hair: HairColours): void {
  // The hair behind the head a shade darker, so the bangs stand off it.
  const c = hair.dark === hair.base ? hair.base : mix(hair.base, hair.dark, 0.45);
  switch (style) {
    case 'long':
      pen.rect(HX - 0.46, HY - 0.2, 0.74, 0.86, 0.2, c);
      break;
    case 'bob':
      // Flaring out to points at the jaw, not a bowl.
      pen.poly(
        [
          HX - 0.44,
          HY - 0.3,
          HX - 0.58,
          HY + 0.3,
          HX - 0.4,
          HY + 0.2,
          HX - 0.34,
          HY + 0.36,
          HX - 0.16,
          HY + 0.18,
          HX + 0.3,
          HY + 0.2,
          HX + 0.4,
          HY - 0.2,
        ],
        c,
      );
      break;
    case 'pony':
      pen.poly(
        [
          HX - 0.3,
          HY - 0.32,
          HX - 0.82,
          HY - 0.08,
          HX - 0.86,
          HY + 0.4,
          HX - 0.66,
          HY + 0.12,
          HX - 0.36,
          HY + 0.02,
        ],
        c,
      );
      break;
    case 'twin':
      for (const s of [-1, 1]) {
        const x = HX + s * 0.4 - 0.04;
        pen.poly(
          [
            x - 0.08,
            HY - 0.28,
            x + s * 0.24,
            HY - 0.08,
            x + s * 0.18,
            HY + 0.62,
            x + s * 0.04,
            HY + 0.3,
            x - s * 0.04,
            HY,
          ],
          c,
        );
      }
      break;
    case 'bun':
      pen.circle(HX - 0.26, HY - 0.36, 0.2, c);
      break;
    case 'spiky':
      pen.poly(spikes(HX - 0.06, HY - 0.06, 0.5, 0.36, 9, Math.PI * 0.75, Math.PI * 2.1), c);
      break;
    case 'neat':
      break;
  }
  // The cap behind the head, for every style.
  pen.circle(HX - 0.03, HY - 0.05, HR + 0.05, c);
}

function hairFront(pen: Pen, style: Hairstyle, hair: HairColours): void {
  const c = hair.base;
  const r = HR + 0.05;
  // The bangs: the top of the head, its lower edge in points over the brow.
  const pts: number[] = [];
  const steps = 14;
  const from = Math.PI * 1.02;
  const to = Math.PI * 2.0;
  for (let i = 0; i <= steps; i++) {
    const a = from + ((to - from) * i) / steps;
    pts.push(HX - 0.02 + Math.cos(a) * r, HY - 0.03 + Math.sin(a) * r);
  }
  const fringe =
    style === 'neat'
      ? [HX + 0.42, HY - 0.08, HX + 0.2, HY - 0.2, HX - 0.1, HY - 0.06, HX - 0.4, HY + 0.08]
      : style === 'spiky'
        ? [
            HX + 0.44,
            HY + 0.02,
            HX + 0.3,
            HY - 0.16,
            HX + 0.24,
            HY - 0.02,
            HX + 0.1,
            HY - 0.18,
            HX + 0.02,
            HY - 0.02,
            HX - 0.12,
            HY - 0.16,
            HX - 0.4,
            HY + 0.12,
          ]
        : [
            HX + 0.42,
            HY + 0.06,
            HX + 0.32,
            HY - 0.12,
            HX + 0.22,
            HY - 0.04,
            HX + 0.12,
            HY - 0.14,
            HX + 0.02,
            HY - 0.06,
            HX - 0.1,
            HY - 0.14,
            HX - 0.42,
            HY + 0.12,
          ];
  pen.poly([...pts, ...fringe], c);
  if (style === 'spiky') {
    pen.poly(
      [
        HX - 0.3,
        HY - 0.32,
        HX - 0.2,
        HY - 0.66,
        HX - 0.04,
        HY - 0.4,
        HX + 0.1,
        HY - 0.68,
        HX + 0.18,
        HY - 0.4,
        HX + 0.38,
        HY - 0.56,
        HX + 0.36,
        HY - 0.26,
      ],
      c,
    );
  }
  if (style === 'long' || style === 'bob' || style === 'twin') {
    // A lock down the near cheek.
    pen.poly([HX + 0.38, HY - 0.1, HX + 0.46, HY + 0.3, HX + 0.36, HY + 0.18], c);
  }
  // The ahoge, anime's one stray strand standing up from the crown.
  if (style !== 'spiky') {
    pen.line(
      [
        { x: HX - 0.04, y: HY - r + 0.02 },
        { x: HX + 0.02, y: HY - r - 0.16 },
        { x: HX + 0.14, y: HY - r - 0.2 },
      ],
      0.06,
      INK,
    );
    pen.line(
      [
        { x: HX - 0.04, y: HY - r + 0.02 },
        { x: HX + 0.02, y: HY - r - 0.16 },
        { x: HX + 0.14, y: HY - r - 0.2 },
      ],
      0.035,
      c,
    );
  }
  if (style === 'neat' || style === 'bob' || style === 'bun' || style === 'pony') {
    // Locks before the far ear and down the near cheek, so short hair is hair, not a helmet.
    pen.poly(
      [HX - 0.36, HY - 0.1, HX - 0.4, HY + 0.22, HX - 0.26, HY + 0.1, HX - 0.24, HY - 0.04],
      c,
    );
    pen.poly([HX + 0.4, HY - 0.08, HX + 0.44, HY + 0.2, HX + 0.34, HY + 0.12], c);
  }
  // Anime's highlight band across the crown.
  pen.line(
    [
      { x: HX - 0.22, y: HY - 0.3 },
      { x: HX - 0.08, y: HY - 0.37 },
      { x: HX + 0.1, y: HY - 0.36 },
    ],
    0.05,
    hair.light,
  );
}

function mix(a: number, b: number, k: number): number {
  const ch = (shift: number): number =>
    Math.round(((a >> shift) & 0xff) * (1 - k) + ((b >> shift) & 0xff) * k) << shift;
  return ch(16) | ch(8) | ch(0);
}

function spikes(
  cx: number,
  cy: number,
  outer: number,
  inner: number,
  n: number,
  from: number,
  to: number,
): number[] {
  const pts: number[] = [];
  for (let i = 0; i <= n * 2; i++) {
    const a = from + ((to - from) * i) / (n * 2);
    const r = i % 2 === 0 ? inner : outer;
    pts.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  pts.push(cx, cy);
  return pts;
}

/** What sits on the hair, never hiding it: a headband, a circlet, a frill, a beret. */
function headwear(pen: Pen, clan: Clan): void {
  switch (clan) {
    case 'karate':
      pen.line(
        [
          { x: HX - 0.4, y: HY - 0.08 },
          { x: HX + 0.42, y: HY - 0.14 },
        ],
        0.07,
        0x1c1a20,
      );
      pen.line(
        [
          { x: HX - 0.4, y: HY - 0.08 },
          { x: HX - 0.66, y: HY + 0.1 },
          { x: HX - 0.6, y: HY - 0.14 },
        ],
        0.045,
        0x1c1a20,
      );
      break;
    case 'mage':
      pen.line(
        [
          { x: HX - 0.38, y: HY - 0.2 },
          { x: HX + 0.42, y: HY - 0.22 },
        ],
        0.035,
        GOLD,
      );
      pen.circle(HX + 0.2, HY - 0.24, 0.05, 0xd94a3a);
      break;
    case 'maid':
      pen.rect(HX - 0.26, HY - 0.48, 0.48, 0.1, 0.05, WHITE);
      break;
    case 'soldier':
      pen.ellipse(HX - 0.06, HY - 0.38, 0.38, 0.13, 0x3f4a26);
      pen.circle(HX + 0.24, HY - 0.4, 0.035, GOLD, false);
      break;
    case 'idol':
      pen.glint(HX + 0.28, HY - 0.36, 0.1, GOLD);
      break;
    case 'mecha':
      // A headset, the head itself bare.
      pen.line(
        [
          { x: HX - 0.3, y: HY + 0.08 },
          { x: HX - 0.26, y: HY + 0.26 },
          { x: HX + 0.06, y: HY + 0.3 },
        ],
        0.03,
        0x4a505e,
      );
      pen.circle(HX - 0.3, HY + 0.06, 0.07, 0x4a505e);
      break;
    case 'genius':
    case 'sword':
      break;
  }
}

// ---------------------------------------------------------------------------------------------
// Props

function backProp(pen: Pen, clan: Clan, stance: Stance, state: GunState): void {
  if (clan === 'mecha') {
    pen.rect(-0.46, -0.98, 0.2, 0.5, 0.06, 0x5e6575);
    if (state === 'fire' || state === 'ready') {
      pen.poly([-0.42, -0.48, -0.3, -0.48, -0.36, -0.28], 0xffb43a, false);
    }
  }
  if (clan === 'sword' && stance !== 'fire') {
    // The sheath at the hip, hilt forward.
    pen.limb(
      [
        { x: -0.5, y: -0.3 },
        { x: 0.22, y: -0.56 },
      ],
      0.06,
      0x1e1c26,
    );
    pen.limb(
      [
        { x: 0.22, y: -0.56 },
        { x: 0.38, y: -0.62 },
      ],
      0.05,
      0x8a6a3a,
    );
  }
}

function frontProp(pen: Pen, clan: Clan, stance: Stance, state: GunState, hand: P): void {
  switch (clan) {
    case 'mage': {
      // The staff through the hand, its orb above.
      const lean = stance === 'fire' ? 0.55 : 0;
      const top = { x: hand.x + lean * 0.7, y: hand.y - (stance === 'fire' ? 0.42 : 0.8) };
      const foot = { x: hand.x - lean * 0.5, y: hand.y + (stance === 'fire' ? 0.3 : 0.44) };
      pen.limb([foot, top], 0.05, 0x8a5a32);
      pen.circle(top.x, top.y, 0.1, 0xffb03a);
      if (stance === 'ready') pen.poly(flame(top.x, top.y - 0.06, 0.16), 0xffd85a, false, 0.9);
      break;
    }
    case 'soldier': {
      // The bazooka: on the shoulder when ready or firing, held down otherwise.
      if (stance === 'idle') {
        pen.limb(
          [
            { x: -0.36, y: -0.3 },
            { x: 0.5, y: -0.64 },
          ],
          0.17,
          0x4b5530,
        );
      } else {
        pen.limb(
          [
            { x: -0.52, y: -0.98 },
            { x: 0.62, y: -0.98 },
          ],
          0.2,
          0x4b5530,
        );
        pen.rect(0.04, -0.9, 0.08, 0.14, 0.02, 0x3a3226);
        if (state === 'ready') pen.poly([0.68, -1.06, 0.84, -0.98, 0.68, -0.9], 0xc23a2a);
        if (state === 'fire') {
          pen.circle(-0.66, -0.98, 0.16, 0xdedad0, false, 0.85);
          pen.circle(-0.82, -0.9, 0.12, 0xdedad0, false, 0.7);
          pen.poly(spikes(0.76, -0.98, 0.2, 0.08, 6, 0, Math.PI * 2), 0xffd24a, false);
        }
      }
      break;
    }
    case 'idol':
      if (stance === 'ready') {
        // Notes are the Lullaby Tower's; the idol sings hearts.
        pen.poly(heart(-0.52, -1.38, 0.09), 0xff6fa0);
      }
      break;
    default:
      break;
  }
}

function handProp(pen: Pen, clan: Clan, stance: Stance, state: GunState, hand: P): void {
  switch (clan) {
    case 'karate':
      if (stance === 'ready') {
        // The energy ball gathered at the hip: the moment before the strike.
        pen.circle(-0.3, -0.52, 0.16, 0x9ff3ff, false, 0.6);
        pen.circle(-0.3, -0.52, 0.09, WHITE, false);
      }
      if (stance === 'fire') pen.circle(0.66, -0.66, 0.15, 0x9ff3ff, false, 0.8);
      break;
    case 'maid':
      if (stance === 'ready') {
        pen.ellipse(hand.x, hand.y - 0.06, 0.22, 0.05, 0xd8dce4);
        drawTeacup(pen, hand.x + 0.02, hand.y - 0.18, 0.7);
      }
      if (stance === 'fire') pen.ellipse(hand.x + 0.04, hand.y - 0.04, 0.06, 0.2, 0xd8dce4);
      break;
    case 'genius':
      if (stance === 'idle') pen.rect(-0.36, -0.62, 0.18, 0.24, 0.02, 0x2f5d50);
      if (stance === 'ready')
        pen.line(
          [
            { x: hand.x, y: hand.y },
            { x: hand.x + 0.04, y: hand.y - 0.08 },
          ],
          0.04,
          SKIN,
        );
      break;
    case 'sword':
      if (stance === 'fire') {
        pen.limb(
          [
            { x: hand.x, y: hand.y },
            { x: hand.x + 0.5, y: hand.y - 0.56 },
          ],
          0.045,
          0xdfe6ee,
        );
        pen.line(
          [
            { x: hand.x - 0.06, y: hand.y + 0.06 },
            { x: hand.x + 0.06, y: hand.y - 0.06 },
          ],
          0.06,
          0x1e1c26,
        );
      }
      break;
    case 'idol':
      // The microphone.
      pen.line(
        [
          { x: hand.x, y: hand.y },
          { x: hand.x + 0.04, y: hand.y - 0.16 },
        ],
        0.04,
        0x3a3a46,
      );
      pen.circle(hand.x + 0.05, hand.y - 0.2, 0.06, 0xb8bcc8);
      break;
    default:
      break;
  }
  if (state === 'ready' && clan === 'karate') pen.glint(EYE_F.x + 0.1, EYE_F.y - 0.12, 0.12);
}

/** What floats round a gun: the sweat drop and "…", the snot bubble, frost, the glint. */
function marks(pen: Pen, state: GunState): void {
  switch (state) {
    case 'ready':
      pen.glint(HX + 0.5, HY - 0.36, 0.14);
      break;
    case 'inert':
      pen.poly(drop(HX - 0.42, HY - 0.2, 0.1), 0x8fd0ff);
      pen.rect(HX + 0.12, HY - 0.82, 0.46, 0.22, 0.1, WHITE);
      for (const dx of [0.24, 0.35, 0.46]) pen.circle(HX + dx, HY - 0.71, 0.025, INK, false);
      break;
    case 'lulled':
      // The snot bubble: anime's sleep.
      pen.g.circle((MOUTH.x + 0.2) * pen.t, (MOUTH.y - 0.1) * pen.t, 0.14 * pen.t);
      pen.g.fill({ color: 0xcdeeff, alpha: 0.75 });
      pen.g.stroke({ width: pen.ink, color: 0x5aa8d8 });
      pen.circle(MOUTH.x + 0.16, MOUTH.y - 0.15, 0.035, WHITE, false);
      zed(pen, HX + 0.3, HY - 0.56, 0.16);
      zed(pen, HX + 0.5, HY - 0.78, 0.11);
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------------------------------------
// Shapes

function zed(pen: Pen, x: number, y: number, s: number): void {
  pen.line(
    [
      { x: x - s / 2, y: y - s / 2 },
      { x: x + s / 2, y: y - s / 2 },
      { x: x - s / 2, y: y + s / 2 },
      { x: x + s / 2, y: y + s / 2 },
    ],
    0.045,
    0x3a6aa0,
  );
}

function flame(x: number, y: number, r: number): number[] {
  return [
    x,
    y - r * 1.6,
    x + r * 0.7,
    y - r * 0.2,
    x + r * 0.5,
    y + r * 0.6,
    x,
    y + r * 0.8,
    x - r * 0.5,
    y + r * 0.6,
    x - r * 0.7,
    y - r * 0.2,
  ];
}

function heart(x: number, y: number, r: number): number[] {
  const pts: number[] = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const hx = 16 * Math.sin(a) ** 3;
    const hy = -(13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a));
    pts.push(x + (hx / 16) * r, y + (hy / 16) * r);
  }
  return pts;
}

function drop(x: number, y: number, r: number): number[] {
  const pts: number[] = [x, y - r * 1.8];
  for (let i = 0; i <= 10; i++) {
    const a = -0.3 + (i / 10) * (Math.PI + 0.6);
    pts.push(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  return pts;
}

function drawTeacup(pen: Pen, x: number, y: number, k: number): void {
  pen.ellipse(x, y + 0.1 * k, 0.16 * k, 0.04 * k, 0xf4f4fa);
  pen.poly(
    [
      x - 0.12 * k,
      y - 0.08 * k,
      x + 0.12 * k,
      y - 0.08 * k,
      x + 0.08 * k,
      y + 0.08 * k,
      x - 0.08 * k,
      y + 0.08 * k,
    ],
    0xf4f4fa,
  );
  pen.g.circle((x + 0.14 * k) * pen.t, y * pen.t, 0.05 * k * pen.t);
  pen.g.stroke({ width: pen.ink, color: INK });
  pen.line(
    [
      { x: x - 0.08 * k, y: y - 0.02 * k },
      { x: x + 0.08 * k, y: y - 0.02 * k },
    ],
    0.02 * k,
    0x5aa0e0,
  );
}

/** Each clan's shot, centred at the origin, flying right. */
export function drawShot(g: Graphics, t: number, clan: Clan): void {
  const pen = new Pen(g, t);
  switch (clan) {
    case 'karate':
      pen.poly([-0.5, -0.1, -0.1, -0.16, -0.1, 0.16, -0.5, 0.1], 0x9ff3ff, false, 0.45);
      pen.circle(0, 0, 0.2, 0x9ff3ff, false, 0.75);
      pen.circle(0, 0, 0.11, WHITE, false);
      break;
    case 'mage':
      pen.poly([-0.55, 0, -0.05, -0.18, 0.18, 0, -0.05, 0.18], 0xff7a2a, false, 0.85);
      pen.circle(0.04, 0, 0.15, 0xffa83a, false);
      pen.circle(0.07, 0, 0.08, 0xffe57a, false);
      break;
    case 'maid':
      drawTeacup(pen, 0, 0, 1);
      break;
    case 'genius':
      pen.poly([0.26, 0, -0.24, -0.16, -0.12, 0, -0.24, 0.12], WHITE);
      pen.line(
        [
          { x: 0.26, y: 0 },
          { x: -0.12, y: 0 },
        ],
        0.02,
        0xb8bcc8,
      );
      break;
    case 'soldier':
      pen.circle(-0.42, 0.02, 0.1, 0xdedad0, false, 0.7);
      pen.circle(-0.6, -0.02, 0.08, 0xdedad0, false, 0.5);
      pen.rect(-0.28, -0.07, 0.42, 0.14, 0.04, 0x4b5530);
      pen.poly([0.14, -0.08, 0.3, 0, 0.14, 0.08], 0xc23a2a);
      break;
    case 'sword': {
      const pts: number[] = [];
      for (let i = 0; i <= 12; i++) {
        const a = -1.1 + (i / 12) * 2.2;
        pts.push(Math.cos(a) * 0.36 - 0.12, Math.sin(a) * 0.48);
      }
      for (let i = 12; i >= 0; i--) {
        const a = -1.1 + (i / 12) * 2.2;
        pts.push(Math.cos(a) * 0.16 - 0.12, Math.sin(a) * 0.36);
      }
      pen.poly(pts, 0xe6f8ff, false, 0.95);
      pen.g.poly(pts.map((v) => v * t));
      pen.g.stroke({ width: pen.ink, color: 0x5aa8e8 });
      break;
    }
    case 'mecha':
      pen.poly([-0.5, 0, -0.16, -0.08, -0.16, 0.08], 0xffb43a, false);
      drawFist(pen, 0, 0);
      break;
    case 'idol':
      pen.g.circle(0, 0, 0.3 * t);
      pen.g.stroke({ width: Math.max(1, t * 0.03), color: 0xff6fa0, alpha: 0.6 });
      pen.poly(heart(0, 0.02, 0.2), 0xff6fa0);
      pen.circle(-0.05, -0.04, 0.04, WHITE, false);
      break;
  }
}
