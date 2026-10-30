import { variantCost, variantKind, type ArtConfig, type SpecialKind } from '@bollwerk/config';
import {
  FREEZE_PENDING,
  FROZEN_TO_END,
  inRepairReach,
  isAwake,
  isFrozen,
  sleepThreshold,
  repairRadiusOf,
  subwooferOf,
  ticksFor,
  waveRays,
  waveReach,
  type CannonKind,
  type Freeze,
  type MatchState,
} from '@bollwerk/sim';
import { Container, Graphics } from 'pixi.js';

import { motionReduced } from '../motion.js';
import { EMBLEMS } from '../towerIcons.js';
import { clearDrawn } from './clearDrawn.js';
import { viewKey } from './stamps.js';
import { drawSnowflake } from './yule.js';
import {
  IMPACT_GLOW,
  playerColour,
  tileX,
  tileY,
  type Ghost,
  type ViewTransform,
} from './theme.js';

/**
 * The special towers on the board (docs/SPECIAL_TOWERS.md §3.4), one layer over both looks,
 * as the main castle's crown is one mark in every style: each style draws a tower as its own
 * cannon, and this puts the tower's emblem at its foot, in its owner's colour from the look in
 * front. Also the ghost's emblem while the right button has switched to the tower, and the
 * towers' effects — Big Bertha's blast, the Architect's walls coming back — generic and cheap:
 * nothing is drawn while none of it is going on.
 *
 * And what a tower will do, shown where it is decided (play-testing, 2026-10-16): the player's
 * own Architects' reach outlined faintly while they build and place guns — the circle was
 * invisible, so nobody knew which walls would come back — and the ghost's while placing one;
 * while a Big Bertha is ready, her cross outlined under the cursor and flames round it.
 */

/**
 * An emblem's badge: a dark disc this wide, in tiles, its centre this far below its gun's
 * foot, the emblem inside it at `INNER` of its width. Bare shapes in the owner's colour
 * read as their outline alone at a tile of 16 pixels, and vanished on a ground of the same
 * colour; on the disc they read in every style.
 */
const BADGE = 1.05;
const DROP = 0.05;
const INNER = 0.68;
/**
 * The cost's pips under the badge, one a cannon it cost (every tower comes at two costs,
 * 2026-10-16): each this wide in tiles, this far apart, on a dark backing as the badge is.
 */
const PIP = 0.17;
const PIP_GAP = 0.27;

function drawEmblem(
  g: Graphics,
  view: ViewTransform,
  kind: SpecialKind,
  cost: number,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: number,
  alpha = 1,
): void {
  const cx = tileX(view, x + w / 2);
  const cy = tileY(view, y + h) + view.tile * DROP;
  const radius = (view.tile * BADGE) / 2;
  g.circle(cx, cy, radius);
  g.fill({ color: 0x0a0a12, alpha: 0.82 * alpha });
  g.stroke({ width: Math.max(1, view.tile / 14), color: fill, alpha });
  const size = radius * 2 * INNER;
  const left = cx - size / 2;
  const top = cy - size / 2;
  for (const part of EMBLEMS[kind]) {
    const points: number[] = [];
    for (let i = 0; i < part.length; i += 2) {
      points.push(left + (part[i] as number) * size, top + (part[i + 1] as number) * size);
    }
    g.poly(points);
    g.fill({ color: fill, alpha });
  }
  const pip = (view.tile * PIP) / 2;
  const py = cy + radius + pip * 0.6;
  const first = cx - ((cost - 1) * view.tile * PIP_GAP) / 2;
  for (let k = 0; k < cost; k++) g.circle(first + k * view.tile * PIP_GAP, py, pip * 1.55);
  g.fill({ color: 0x0a0a12, alpha: 0.82 * alpha });
  for (let k = 0; k < cost; k++) g.circle(first + k * view.tile * PIP_GAP, py, pip);
  g.fill({ color: fill, alpha });
}

/** Arcs drawn behind a wave's front on each lane, a tile apart in this share of a tile. */
const WAVE_ARCS = 3;
const WAVE_ARC_GAP = 0.42;

/** A Bertha's blast as it plays: where, the tiles it cleared round there, and how far through. */
interface Blast {
  x: number;
  y: number;
  crater: readonly (readonly [number, number])[];
  /** How far the crater reaches from its middle, in tiles, for the ring and the length. */
  reach: number;
  ms: number;
}

/** Whether a gun's landing sets off a blast: either Bertha's. */
export function hasBlast(kind: CannonKind): boolean {
  return kind === 'bertha' || kind === 'biggest';
}

/** How far a crater reaches from its middle, in whole tiles. */
function craterReach(crater: readonly (readonly [number, number])[]): number {
  let most = 0;
  for (const [dx, dy] of crater) most = Math.max(most, Math.abs(dx), Math.abs(dy));
  return most;
}

/** A Lightning Tower's bolt as it plays: its jagged course, in screen-independent tiles. */
interface Bolt {
  /** The course from the tower through every strike, kinked between, in tile units. */
  points: { x: number; y: number }[];
  /** Where each strike falls in `points`, for its flash as the bolt reaches it. */
  strikes: number[];
  colour: number;
  ms: number;
}

/** A Laser Tower's beam as it plays: from the tower to its end, in tiles, and what it cleared. */
interface Beam {
  fromX: number;
  fromY: number;
  endX: number;
  endY: number;
  /** The walls it cleared, each flashing as the beam reaches it. */
  hits: { x: number; y: number }[];
  colour: number;
  ms: number;
}

/** A Frost Cannon's shot landing: a burst of frost over the tile it froze. */
interface FrostBurst {
  x: number;
  y: number;
  ms: number;
}

/** Walls an Architect rebuilt, shimmering as they come back. */
interface Repair {
  tiles: readonly number[];
  width: number;
  colour: number;
  ms: number;
}

const BLAST_MS = 520;

/** A blast's length: Bertha's, and longer by half again for every tile more a crater reaches. */
function blastMs(blast: Blast): number {
  return BLAST_MS * (1 + 0.5 * Math.max(0, blast.reach - 1));
}
const REPAIR_MS = 900;
/** Between one strike of a chain and the next, so the bolt is seen jumping; then its fade. */
const BOLT_STEP_MS = 90;
const BOLT_FADE_MS = 420;
/** A strike's flash, from the bolt reaching it to gone. */
const FLASH_MS = 180;
/** Electric white-blue for the cursor's crackle, read in every style as the amber is. */
const SPARK = 0xc8ecff;
/**
 * A beam is drawn out from the tower over `BEAM_REACH_MS`, so its direction is seen, holds for
 * `BEAM_HOLD_MS` and fades over `BEAM_FADE_MS`.
 */
const BEAM_REACH_MS = 70;
const BEAM_HOLD_MS = 110;
const BEAM_FADE_MS = 380;
const BEAM_MS = BEAM_REACH_MS + BEAM_HOLD_MS + BEAM_FADE_MS;

/** A frozen tile's ice: its body, its rims and its shine, the same in every style. */
const ICE = 0xc6ecff;
const ICE_RIM = 0xffffff;
const ICE_DARK = 0x0c2a44;
/** Its margin inside the tile, as a share of it: the block is the tile, nearly to its edges. */
const ICE_INSET = 0.07;
/** A glint across each block every so often, and how long it takes. */
const GLINT_EVERY_MS = 3200;
const GLINT_MS = 420;
/** A Frost Cannon's landing burst, and a freeze's shatter as it goes. */
const FROST_BURST_MS = 520;
const SHATTER_MS = 420;
/** The cracks a block takes on as its thaw nears, in a unit box, one after another. */
const CRACKS: readonly (readonly number[])[] = [
  [0.5, 0.5, 0.62, 0.36, 0.7, 0.12],
  [0.5, 0.5, 0.36, 0.62, 0.2, 0.74],
  [0.5, 0.5, 0.68, 0.6, 0.88, 0.66],
  [0.5, 0.5, 0.44, 0.3, 0.3, 0.16],
  [0.5, 0.5, 0.56, 0.74, 0.5, 0.9],
];

/**
 * How much of a freeze is left, 1 to 0: whole until its build phase opens, then melting towards
 * its thaw — a whole phase's towards the phase's end, and all but gone in the overtime.
 */
function iceLeft(state: MatchState, f: Freeze): number {
  if (state.phase !== 'build' || f.thawTick === FREEZE_PENDING) return 1;
  const phaseTicks = ticksFor(state.ruleset.phases.buildMs, state.ruleset.tickRateHz);
  if (f.thawTick === FROZEN_TO_END) {
    if (state.overtime) return 0.05;
    return Math.min(1, Math.max(0, (state.phaseEndTick - state.tick) / phaseTicks));
  }
  const span = Math.max(1, Math.ceil(f.share * phaseTicks));
  return Math.min(1, Math.max(0, (f.thawTick - state.tick) / span));
}

/** The Lullaby Tower's own colour, for its reach under the cursor: a soft lavender. */
const LULLABY = 0xc9b8ff;
/** The Zs circling the cursor while a Lullaby Tower is ready, and one turn's length. */
const LULLABY_ZS = 4;
const LULLABY_TURN_MS = 2600;

/**
 * Zs, each a stroke dark round white so it reads on any ground: the sleeping guns' and the
 * cursor's alike.
 */
function drawZs(
  g: Graphics,
  zs: readonly { x: number; y: number; size: number; alpha: number }[],
  tile: number,
): void {
  for (const [width, colour] of [
    [Math.max(3, tile / 5), 0x0a0a20],
    [Math.max(1.5, tile / 11), 0xffffff],
  ] as const) {
    for (const z of zs) {
      const h = z.size;
      g.moveTo(z.x - h / 2, z.y - h / 2)
        .lineTo(z.x + h / 2, z.y - h / 2)
        .lineTo(z.x - h / 2, z.y + h / 2)
        .lineTo(z.x + h / 2, z.y + h / 2);
      g.stroke({ width, color: colour, alpha: z.alpha, join: 'round', cap: 'round' });
    }
  }
}

/**
 * Where a line from (fromX, fromY) through (toX, toY) leaves a board this big, in tiles as a
 * shot's coordinates are (a tile's centre its index, its edges half a tile either side).
 */
function edgeOf(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  width: number,
  height: number,
): { x: number; y: number } {
  const dx = toX - fromX;
  const dy = toY - fromY;
  let t = Infinity;
  if (dx !== 0) t = Math.min(t, ((dx > 0 ? width - 0.5 : -0.5) - fromX) / dx);
  if (dy !== 0) t = Math.min(t, ((dy > 0 ? height - 0.5 : -0.5) - fromY) / dy);
  if (!Number.isFinite(t)) return { x: toX, y: toY };
  return { x: fromX + dx * t, y: fromY + dy * t };
}

/** A jagged course from one point to another, `kinks` bends sideways along it, in tiles. */
function kinked(
  from: { x: number; y: number },
  to: { x: number; y: number },
  kinks: number,
  random: () => number,
): { x: number; y: number }[] {
  const out = [from];
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  for (let k = 1; k <= kinks; k++) {
    const t = k / (kinks + 1);
    const side = (random() - 0.5) * Math.min(1.2, length * 0.3);
    out.push({
      x: from.x + dx * t - (dy / length) * side,
      y: from.y + dy * t + (dx / length) * side,
    });
  }
  out.push(to);
  return out;
}

/** A small seeded random source, so the cursor's crackle holds still between its beats. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let r = Math.imul(a ^ (a >>> 15), 1 | a);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The Lightning Tower's crackle round the cursor while it is ready (the user's, 2026-10-17):
 * jagged bolts running along the ring itself, a few at a time, drawn afresh on a beat, a glow
 * under them. Leaping out from the ring at first; along it, as the user asked, they read as
 * the cursor charged.
 */
function drawCrackle(g: Graphics, cx: number, cy: number, r: number, nowMs: number): void {
  const beat = motionReduced() ? 0 : Math.floor(nowMs / 85);
  const random = seeded(beat * 7919 + 17);
  g.circle(cx, cy, r);
  g.stroke({ width: r * 0.18, color: SPARK, alpha: 0.25 });
  const bolts: { x: number; y: number }[][] = [];
  for (let k = 0; k < 3; k++) {
    // An arc of the ring, 30 to 65 degrees, its ends on the ring and its kinks either side.
    const start = random() * Math.PI * 2;
    const span = 0.5 + random() * 0.6;
    const steps = 6;
    const bolt: { x: number; y: number }[] = [];
    for (let i = 0; i <= steps; i++) {
      const a = start + (span * i) / steps;
      const out = i === 0 || i === steps ? 1 : 1 + (random() - 0.5) * 0.24;
      bolt.push({ x: cx + Math.cos(a) * r * out, y: cy + Math.sin(a) * r * out });
    }
    bolts.push(bolt);
  }
  for (const [width, colour, alpha] of [
    [Math.max(3, r * 0.26), SPARK, 0.5],
    [Math.max(1.5, r * 0.08), 0xffffff, 1],
  ] as const) {
    for (const bolt of bolts) {
      g.moveTo(bolt[0]!.x, bolt[0]!.y);
      for (const p of bolt.slice(1)) g.lineTo(p.x, p.y);
    }
    g.stroke({ width, color: colour, alpha, join: 'round', cap: 'round' });
  }
}

/**
 * Outlines a set of tiles, given as `y * width + x`: the edges between a tile in the set and
 * one out of it, so a reach or a crater reads as one shape rather than a grid of squares.
 */
function outlineTiles(
  g: Graphics,
  view: ViewTransform,
  tiles: ReadonlySet<number>,
  width: number,
): void {
  const has = (x: number, y: number): boolean =>
    x >= 0 && x < width && y >= 0 && tiles.has(y * width + x);
  for (const i of tiles) {
    const x = i % width;
    const y = (i - x) / width;
    const [left, top, right, bottom] = [
      tileX(view, x),
      tileY(view, y),
      tileX(view, x + 1),
      tileY(view, y + 1),
    ];
    if (!has(x, y - 1)) g.moveTo(left, top).lineTo(right, top);
    if (!has(x, y + 1)) g.moveTo(left, bottom).lineTo(right, bottom);
    if (!has(x - 1, y)) g.moveTo(left, top).lineTo(left, bottom);
    if (!has(x + 1, y)) g.moveTo(right, top).lineTo(right, bottom);
  }
}

/** The tiles of an island an Architect standing here, at this cost, would rebuild. */
function reachOf(
  state: MatchState,
  island: number,
  footprint: { x: number; y: number; w: number; h: number },
  cost: number,
  into: Set<number>,
): void {
  const r = repairRadiusOf(state.ruleset, cost);
  const out = Math.ceil(r);
  for (
    let y = Math.max(0, footprint.y - out);
    y < Math.min(state.height, footprint.y + footprint.h + out);
    y++
  ) {
    for (
      let x = Math.max(0, footprint.x - out);
      x < Math.min(state.width, footprint.x + footprint.w + out);
      x++
    ) {
      const i = y * state.width + x;
      if (state.islandId[i] === island && inRepairReach(footprint, r, x, y)) into.add(i);
    }
  }
}

/** Phases whose player plans walls, where an Architect's reach is worth seeing. */
const REACH_PHASES: ReadonlySet<string> = new Set(['cannon_place', 'build']);

/** Big Bertha's flames: tongues round the cursor's ring, flickering on beats of their own. */
const FLAMES = 12;
const FLAME_OUTER = 0xff5a1f;
const FLAME_INNER = 0xffd23f;

function drawFlames(g: Graphics, cx: number, cy: number, r: number, nowMs: number): void {
  const t = motionReduced() ? 0 : nowMs;
  g.circle(cx, cy, r);
  g.stroke({ width: r * 0.22, color: FLAME_OUTER, alpha: 0.3 });
  const half = (Math.PI / FLAMES) * 0.9;
  for (const [colour, alpha, reach, narrow] of [
    [FLAME_OUTER, 0.85, 1, 1],
    [FLAME_INNER, 0.95, 0.5, 0.5],
  ] as const) {
    for (let k = 0; k < FLAMES; k++) {
      const a = (k / FLAMES) * Math.PI * 2;
      const flicker = 0.5 + 0.5 * Math.sin(t * 0.013 + k * 1.7) * Math.cos(t * 0.007 + k * 2.3);
      // Fire rises: the tongues over the ring are the longest, those under it short, and
      // every tip bends upward and sways, so the ring burns rather than shines.
      const upness = 0.5 - 0.5 * Math.sin(a);
      const length = r * reach * (0.32 + 0.38 * flicker) * (0.55 + 0.9 * upness);
      const sway = r * 0.12 * Math.sin(t * 0.009 + k * 1.3);
      const w = half * narrow;
      const [bx, by] = [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
      const tipX = bx + Math.cos(a) * length * 0.45 + sway;
      const tipY = by + Math.sin(a) * length * 0.45 - length * 0.75;
      const [lx, ly] = [cx + Math.cos(a - w) * r, cy + Math.sin(a - w) * r];
      const [rx, ry] = [cx + Math.cos(a + w) * r, cy + Math.sin(a + w) * r];
      g.moveTo(lx, ly);
      g.quadraticCurveTo(lx + (tipX - bx) * 0.3, ly + (tipY - by) * 0.6, tipX, tipY);
      g.quadraticCurveTo(rx + (tipX - bx) * 0.3, ry + (tipY - by) * 0.6, rx, ry);
      g.closePath();
    }
    g.fill({ color: colour, alpha });
  }
}

/** The Frost Cannon's snowflakes circling the cursor while it is ready, and one turn's length. */
const FROST_FLAKES = 6;
const FROST_TURN_MS = 5200;

/**
 * The Frost Cannon's sign round the cursor while it is ready (the user's, 2026-10-30): a ring of
 * frost and snowflakes drifting slowly round it, each turning on its own, dark under white so
 * they read on snow-white styles as on the sea.
 */
function drawFrostFlakes(g: Graphics, cx: number, cy: number, r: number, nowMs: number): void {
  const t = motionReduced() ? 0 : nowMs;
  g.circle(cx, cy, r);
  g.stroke({ width: r * 0.22, color: ICE, alpha: 0.3 });
  g.circle(cx, cy, r);
  g.stroke({ width: Math.max(1, r * 0.05), color: ICE_RIM, alpha: 0.7 });
  const turn = (t / FROST_TURN_MS) * Math.PI * 2;
  const flakes = [];
  for (let k = 0; k < FROST_FLAKES; k++) {
    const a = turn + (k / FROST_FLAKES) * Math.PI * 2;
    // Every other flake a little smaller and further out, so the ring is not a clock face.
    const out = k % 2 === 0 ? 1 : 1.12;
    flakes.push({
      x: cx + Math.cos(a) * r * out,
      y: cy + Math.sin(a) * r * out,
      size: r * (k % 2 === 0 ? 0.3 : 0.22),
      angle: t / (900 + 130 * k) + k,
    });
  }
  for (const f of flakes) drawSnowflake(g, f.x, f.y, f.size * 1.15, f.angle, ICE_DARK, 0.55);
  for (const f of flakes) drawSnowflake(g, f.x, f.y, f.size, f.angle, ICE_RIM, 1);
}

/** The Subwoofer's rings pulsing out from the cursor while it is ready, and one ring's life. */
const BASS_RINGS = 3;
const BASS_PULSE_MS = 1100;

/**
 * The Subwoofer's sign round the cursor while it is ready (the user's, 2026-10-30): rings of
 * sound pulsing out from the cursor's ring and fading as they go, a beat apart, in the player's
 * colour round a white core as its wave is; under reduced motion, standing still at their steps.
 */
function drawBassRings(
  g: Graphics,
  cx: number,
  cy: number,
  r: number,
  colour: number,
  nowMs: number,
): void {
  const reduced = motionReduced();
  for (let k = 0; k < BASS_RINGS; k++) {
    const age = reduced ? (k + 0.5) / BASS_RINGS : (nowMs / BASS_PULSE_MS + k / BASS_RINGS) % 1;
    const radius = r * (0.6 + 0.9 * age);
    const fade = 1 - age;
    g.circle(cx, cy, radius);
    g.stroke({ width: Math.max(3, r * 0.2), color: colour, alpha: 0.35 * fade });
    g.circle(cx, cy, radius);
    g.stroke({ width: Math.max(1, r * 0.06), color: 0xffffff, alpha: 0.85 * fade });
  }
}

export class TowerMarks {
  readonly root = new Container({ label: 'towers' });
  /** The player's Architects' reach, drawn again only when it changes. */
  private readonly reach = new Graphics();
  private reachKey = '';
  /**
   * The reach shown whatever the phase: the tower menu's preview plays a combat, and the
   * Architect's circle is what it is there to show.
   */
  reachAlways = false;
  /** The Frost Cannons' ice, every frame while any tile is frozen, melting as it thaws. */
  private readonly ice = new Graphics();
  private iceShown = false;
  /** The tiles frozen last frame, so a freeze gone since shatters. */
  private frozenTiles = new Set<number>();
  private shatters: FrostBurst[] = [];
  /** The guns a Lullaby Tower has put to sleep, every frame while any sleeps. */
  private readonly sleep = new Graphics();
  private sleepShown = false;
  /** The Subwoofers' waves and cooldowns, every frame while any counts down or travels. */
  private readonly waves = new Graphics();
  private wavesShown = false;
  /** The towers' emblems, drawn again only when one changes. */
  private readonly emblems = new Graphics();
  /** The ghost's emblem, every frame while there is one. */
  private readonly ghost = new Graphics();
  /** The effects, every frame while any plays. */
  private readonly effects = new Graphics();
  private key = '';
  private blasts: Blast[] = [];
  private bolts: Bolt[] = [];
  private beams: Beam[] = [];
  private frostBursts: FrostBurst[] = [];
  private repairs: Repair[] = [];

  constructor() {
    this.root.addChild(
      this.reach,
      this.ice,
      this.emblems,
      this.waves,
      this.sleep,
      this.effects,
      this.ghost,
    );
  }

  /** Every tower's emblem: its owner's light colour while it fires, stone grey while inert. */
  draw(state: MatchState, view: ViewTransform, art: ArtConfig, humanPlayer: number): void {
    this.drawReach(state, view, art, humanPlayer);
    this.drawIce(state, view);
    this.drawSleep(state, view);
    let key = `${viewKey(view)}|${art.players.map((p) => p.light).join(',')}`;
    for (const c of state.cannons) {
      if (c.kind !== 'cannon')
        key += `|${c.kind}${c.cost}${c.owner}:${c.x},${c.y},${c.w},${c.h},${c.active}`;
    }
    if (key === this.key) return;
    this.key = key;
    clearDrawn(this.emblems);
    for (const c of state.cannons) {
      if (c.kind === 'cannon') continue;
      const fill = c.active ? playerColour(art, c.owner, 'light') : 0x9a9aa4;
      drawEmblem(this.emblems, view, c.kind, c.cost, c.x, c.y, c.w, c.h, fill);
    }
  }

  /**
   * Every frozen tile as a block of ice over the board (the user's Frost Cannon, 2026-10-21):
   * whole until its build phase opens, then shrinking and puddling as it thaws, so a player sees
   * when it will take a piece again. Cleared once, then left alone, while nothing is frozen.
   */
  private drawIce(state: MatchState, view: ViewTransform): void {
    // Every freeze gone since the last frame shatters: thawed, swept by the phase's end or by an
    // Architect alike.
    const now = new Set(state.frozen.map((f) => f.tile));
    for (const tile of this.frozenTiles) {
      if (!now.has(tile)) {
        this.shatters.push({ x: tile % state.width, y: Math.floor(tile / state.width), ms: 0 });
      }
    }
    this.frozenTiles = now;
    if (state.frozen.length === 0) {
      if (this.iceShown) clearDrawn(this.ice);
      this.iceShown = false;
      return;
    }
    this.iceShown = true;
    const g = this.ice;
    g.clear();
    const t = view.tile;
    const clock = motionReduced() ? 0 : performance.now();
    for (const f of state.frozen) {
      const x = f.tile % state.width;
      const y = (f.tile - x) / state.width;
      // Whole and solid to the end, a full tile (the user's, 2026-10-21: shrinking read as
      // passable); the time left shows in its cracks, and its going in a shatter.
      const [bx, by] = [tileX(view, x) + t * ICE_INSET, tileY(view, y) + t * ICE_INSET];
      const size = t * (1 - 2 * ICE_INSET);
      g.roundRect(bx + t * 0.06, by + t * 0.08, size, size, size * 0.16);
      g.fill({ color: 0x000000, alpha: 0.3 });
      g.roundRect(bx, by, size, size, size * 0.16);
      g.fill({ color: ICE, alpha: 0.95 });
      // A dark rim outside a light one: the ice alone vanished on light grounds and pale colours.
      g.stroke({ width: Math.max(2, t / 7), color: ICE_DARK, alpha: 0.9, alignment: 1 });
      g.roundRect(bx, by, size, size, size * 0.16);
      g.stroke({ width: Math.max(1, t / 16), color: ICE_RIM, alpha: 1, alignment: 0 });
      g.moveTo(bx + size * 0.18, by + size * 0.46).lineTo(bx + size * 0.46, by + size * 0.18);
      g.stroke({ width: Math.max(1, t / 10), color: 0xffffff, alpha: 0.9, cap: 'round' });
      // A glint running across it now and then, each tile on a beat of its own.
      const beat = (clock + f.tile * 977) % GLINT_EVERY_MS;
      if (clock > 0 && beat < GLINT_MS) {
        const along = beat / GLINT_MS;
        const gx = bx - size * 0.3 + along * size * 1.6;
        g.moveTo(
          Math.max(bx, gx - size * 0.3),
          by + size * Math.min(1, (gx - bx) / size + 0.3),
        ).lineTo(
          Math.min(bx + size, gx + size * 0.3),
          by + size * Math.max(0, (gx - bx) / size - 0.3),
        );
        g.stroke({
          width: Math.max(2, t / 6),
          color: 0xffffff,
          alpha: 0.75 * Math.sin(along * Math.PI),
          cap: 'round',
        });
      }
      // Cracks spreading as the thaw nears, one after another.
      const cracked = Math.floor((1 - iceLeft(state, f)) * (CRACKS.length + 1));
      for (let k = 0; k < Math.min(cracked, CRACKS.length); k++) {
        const crack = CRACKS[(k + f.tile) % CRACKS.length] as readonly number[];
        g.moveTo(bx + (crack[0] as number) * size, by + (crack[1] as number) * size);
        for (let p = 2; p < crack.length; p += 2) {
          g.lineTo(bx + (crack[p] as number) * size, by + (crack[p + 1] as number) * size);
        }
      }
      if (cracked > 0) g.stroke({ width: Math.max(1, t / 14), color: ICE_DARK, alpha: 0.75 });
    }
  }

  /**
   * The Subwoofers' waves (the user's, 2026-10-30): on each lane still travelling, a few arcs bowed
   * forward across it, in its owner's colour round a white core, a fraction of a tick on so they
   * glide. Read from the match, where the waves are, so nothing is kept here; cleared once, then
   * left alone, while there are none.
   */
  drawWaves(state: MatchState, view: ViewTransform, art: ArtConfig, tickFraction: number): void {
    if (state.waves.length === 0) {
      if (this.wavesShown) clearDrawn(this.waves);
      this.wavesShown = false;
      return;
    }
    this.wavesShown = true;
    const g = this.waves;
    g.clear();
    const t = view.tile;
    for (const wave of state.waves) {
      // Its front, in tiles along the line's longer axis from the tower's centre: a tile's wall
      // falls as it passes the tile's middle (`advanceWaves`).
      const reach = waveReach(state, wave, state.tick + tickFraction);
      const colour = playerColour(art, wave.owner, 'light');
      for (const lane of wave.lanes) {
        if (lane.done) continue;
        // In tiles: the lane's start, a step a tile along the longer axis, and its direction.
        const longer = Math.max(Math.abs(lane.dx), Math.abs(lane.dy));
        const [sx, sy] = [lane.dx / longer, lane.dy / longer];
        const norm = Math.hypot(lane.dx, lane.dy);
        const [ux, uy] = [lane.dx / norm, lane.dy / norm];
        for (let k = 0; k < WAVE_ARCS; k++) {
          const along = reach - k * WAVE_ARC_GAP;
          if (along < 0) break;
          const [fx, fy] = [lane.ax / 2 + sx * along, lane.ay / 2 + sy * along];
          if (fx < -0.5 || fy < -0.5 || fx > state.width - 0.5 || fy > state.height - 0.5) continue;
          // Across the lane, from one side to the other, bowed forward through its middle.
          const [px, py] = [-uy * 0.42, ux * 0.42];
          const bow = 0.22;
          const at = (x: number, y: number) => ({
            x: tileX(view, x + 0.5),
            y: tileY(view, y + 0.5),
          });
          const a = at(fx + px - ux * bow, fy + py - uy * bow);
          const m = at(fx + ux * bow, fy + uy * bow);
          const b = at(fx - px - ux * bow, fy - py - uy * bow);
          const alpha = 1 - k / WAVE_ARCS;
          for (const [width, tint, strength] of [
            [Math.max(3, t * 0.3), colour, 0.45],
            [Math.max(1, t / 12), 0xffffff, 0.9],
          ] as const) {
            g.moveTo(a.x, a.y).quadraticCurveTo(m.x, m.y, b.x, b.y);
            g.stroke({ width, color: tint, alpha: strength * alpha, cap: 'round' });
          }
        }
      }
    }
  }

  /**
   * Every gun asleep (the user's Lullaby Tower, 2026-10-21), and every tower lulled towards it: a
   * gun asleep has its footprint dimmed, and over it a
   * rising stack of Zs, one for every second of sleep left, the last fading as it wakes — so the
   * time left is counted out. Dark round white, as the ice is, to read on any ground.
   */
  private drawSleep(state: MatchState, view: ViewTransform): void {
    const asleep = state.cannons.filter((c) => !isAwake(state, c));
    const lulled = state.cannons.filter((c) => c.lulled !== undefined && isAwake(state, c));
    if (asleep.length === 0 && lulled.length === 0) {
      if (this.sleepShown) clearDrawn(this.sleep);
      this.sleepShown = false;
      return;
    }
    this.sleepShown = true;
    const g = this.sleep;
    g.clear();
    const t = view.tile;
    const clock = motionReduced() ? 0 : performance.now();
    // A tower lulled short of its sleep: a pip for every lullaby it needs under its emblem's badge
    // row, those it has taken filled — so its owner, and its rival, see it is coming.
    for (const c of lulled) {
      const lullaby = state.ruleset.specials.lullaby;
      const threshold = sleepThreshold(c, lullaby?.['3'] ?? lullaby?.['2'] ?? null);
      const r = t * 0.13;
      const gap = t * 0.38;
      const [cx, cy] = [tileX(view, c.x + c.w / 2), tileY(view, c.y) + t * 0.22];
      for (let k = 0; k < threshold; k++) {
        const x = cx + (k - (threshold - 1) / 2) * gap;
        g.circle(x, cy, r);
        g.fill({ color: k < (c.lulled as number) ? 0xffffff : 0x0a0a20, alpha: 0.95 });
        g.circle(x, cy, r);
        g.stroke({ width: Math.max(1.5, t / 12), color: 0x0a0a20, alpha: 0.95 });
      }
    }
    for (const c of asleep) {
      g.rect(tileX(view, c.x), tileY(view, c.y), c.w * t, c.h * t);
      g.fill({ color: 0x0a0a20, alpha: 0.35 });
    }
    // The Zs' strokes, outlined in a second pass, so every Z reads over every other.
    const zs: { x: number; y: number; size: number; alpha: number }[] = [];
    for (const c of asleep) {
      const leftMs = (((c.asleepUntil as number) - state.tick) * 1000) / state.ruleset.tickRateHz;
      const count = Math.min(3, Math.max(1, Math.ceil(leftMs / 1000)));
      // The last of a second fades out with it, so the stack is seen to count down.
      const fadeLast = Math.min(1, leftMs / 1000 - (count - 1));
      const [cx, cy] = [tileX(view, c.x + c.w * 0.7), tileY(view, c.y + c.h * 0.35)];
      for (let k = 0; k < count; k++) {
        const bob = clock === 0 ? 0 : Math.sin(clock / 400 + k * 1.3 + c.id) * t * 0.06;
        zs.push({
          x: cx + k * t * 0.36 + bob,
          y: cy - k * t * 0.55,
          size: t * (0.58 - 0.1 * k),
          alpha: k === count - 1 ? Math.max(0.25, fadeLast) : 1,
        });
      }
    }
    drawZs(g, zs, t);
  }

  /**
   * The player's own Architects' reach while they place guns and build, a faint line in their
   * colour round the island's tiles it covers — grey for one standing inert, which rebuilds
   * nothing. Only their own: everyone's would clutter the busy styles (the user's, 2026-10-16).
   */
  private drawReach(state: MatchState, view: ViewTransform, art: ArtConfig, human: number): void {
    const player = state.players[human];
    const shown =
      player !== undefined &&
      !player.eliminated &&
      (this.reachAlways || REACH_PHASES.has(state.phase));
    let key = shown ? `${viewKey(view)}|${playerColour(art, human, 'light')}` : '';
    if (shown) {
      for (const c of state.cannons) {
        if (c.owner === human && c.kind === 'architect')
          key += `|${c.cost}:${c.x},${c.y},${c.active}`;
      }
    }
    if (key === this.reachKey) return;
    this.reachKey = key;
    clearDrawn(this.reach);
    if (!shown) return;
    const active = new Set<number>();
    const inert = new Set<number>();
    for (const c of state.cannons) {
      if (c.owner !== human || c.kind !== 'architect') continue;
      reachOf(state, player.islandId, c, c.cost, c.active ? active : inert);
    }
    for (const i of active) inert.delete(i);
    const width = Math.max(1, view.tile / 12);
    outlineTiles(this.reach, view, inert, state.width);
    this.reach.stroke({ width, color: 0x9a9aa4, alpha: 0.4 });
    outlineTiles(this.reach, view, active, state.width);
    this.reach.stroke({ width, color: playerColour(art, human, 'light'), alpha: 0.55 });
  }

  /**
   * Every frame: the emblem on the cannon ghost while it would place the player's tower, with
   * an Architect's reach from there; while a Big Bertha is ready, her cross and her flames.
   */
  drawGhost(
    state: MatchState,
    view: ViewTransform,
    ghost: Ghost,
    art: ArtConfig,
    humanPlayer: number,
  ): void {
    clearDrawn(this.ghost);
    this.drawBertha(state, view, ghost);
    if (
      ghost.aiming &&
      ghost.tile !== null &&
      ghost.impact?.ready === true &&
      ghost.nextTower?.kind === 'lightning'
    ) {
      const { x, y } = ghost.tile;
      drawCrackle(
        this.ghost,
        tileX(view, x + 0.5),
        tileY(view, y + 0.5),
        view.tile * 1.1,
        performance.now(),
      );
    }
    const own = playerColour(art, humanPlayer, 'light');
    this.drawLaserLine(state, view, ghost, own);
    this.drawSubwoofer(state, view, ghost, own);
    if (
      ghost.aiming &&
      ghost.tile !== null &&
      ghost.impact?.ready === true &&
      ghost.nextTower?.kind === 'frost'
    ) {
      const { x, y } = ghost.tile;
      drawFrostFlakes(
        this.ghost,
        tileX(view, x + 0.5),
        tileY(view, y + 0.5),
        view.tile * 1.1,
        performance.now(),
      );
    }
    this.drawLullaby(state, view, ghost);
    this.drawFrozenUnderPiece(state, view, ghost);
    const variant = ghost.tower;
    if (
      variant === null ||
      variant === undefined ||
      ghost.tile === null ||
      ghost.footprint === null
    ) {
      return;
    }
    const { w, h } = ghost.footprint;
    const fill = ghost.valid ? playerColour(art, humanPlayer, 'light') : 0x9a9aa4;
    const [kind, cost] = [variantKind(variant), variantCost(variant)];
    const player = state.players[humanPlayer];
    if (kind === 'architect' && player !== undefined) {
      const tiles = new Set<number>();
      reachOf(state, player.islandId, { ...ghost.tile, w, h }, cost, tiles);
      outlineTiles(this.ghost, view, tiles, state.width);
      this.ghost.stroke({ width: Math.max(1, view.tile / 10), color: fill, alpha: 0.75 });
    }
    drawEmblem(this.ghost, view, kind, cost, ghost.tile.x, ghost.tile.y, w, h, fill, 0.85);
  }

  /**
   * A ready Bertha's crater under the cursor, the tiles her shot would clear, and flames — the
   * Allerdickste's ring of them as wide as her crater, so the size of what is coming shows.
   */
  private drawBertha(state: MatchState, view: ViewTransform, ghost: Ghost): void {
    const next = ghost.nextTower;
    if (!ghost.aiming || ghost.tile === null || next === null || next === undefined) return;
    if (!hasBlast(next.kind)) return;
    if (ghost.impact?.ready !== true) return;
    const { x, y } = ghost.tile;
    if (ghost.valid) {
      const tiles = new Set<number>();
      for (const [dx, dy] of next.crater) {
        const [tx, ty] = [x + dx, y + dy];
        if (tx < 0 || ty < 0 || tx >= state.width || ty >= state.height) continue;
        tiles.add(ty * state.width + tx);
        this.ghost.rect(tileX(view, tx), tileY(view, ty), view.tile, view.tile);
      }
      this.ghost.fill({ color: IMPACT_GLOW, alpha: 0.16 });
      outlineTiles(this.ghost, view, tiles, state.width);
      this.ghost.stroke({ width: Math.max(1.5, view.tile / 9), color: IMPACT_GLOW, alpha: 0.9 });
    }
    drawFlames(
      this.ghost,
      tileX(view, x + 0.5),
      tileY(view, y + 0.5),
      view.tile * (next.kind === 'biggest' ? craterReach(next.crater) + 0.6 : 1.1),
      performance.now(),
    );
  }

  /**
   * A ready Lullaby Tower under the cursor (the user's, 2026-10-23): its reach outlined round the
   * tile aimed at, a soft circle where a gun's nearest tile is still within `sleepRadius` — none
   * for one that reaches anywhere — and Zs circling the cursor, as the guns it puts to sleep
   * wear them.
   */
  private drawLullaby(state: MatchState, view: ViewTransform, ghost: Ghost): void {
    const next = ghost.nextTower;
    if (!ghost.aiming || ghost.tile === null || next?.kind !== 'lullaby') return;
    if (ghost.impact?.ready !== true) return;
    const t = view.tile;
    const [cx, cy] = [tileX(view, ghost.tile.x + 0.5), tileY(view, ghost.tile.y + 0.5)];
    const variant = state.ruleset.specials.lullaby?.[next.cost as 2 | 3];
    const radius = variant?.sleepRadius ?? null;
    if (radius !== null) {
      // To a tile's centre within the radius, and half a tile on to that tile's edge.
      const r = (radius + 0.5) * t;
      this.ghost.circle(cx, cy, r);
      this.ghost.fill({ color: LULLABY, alpha: 0.07 });
      this.ghost.circle(cx, cy, r);
      this.ghost.stroke({ width: Math.max(1.5, t / 10), color: 0x0a0a20, alpha: 0.35 });
      this.ghost.circle(cx, cy, r);
      this.ghost.stroke({ width: Math.max(1, t / 16), color: LULLABY, alpha: 0.85 });
    }
    // The Zs going round the cursor's ring, each rising and falling a little as it goes.
    const clock = motionReduced() ? 0 : performance.now();
    const turn = (clock / LULLABY_TURN_MS) * Math.PI * 2;
    const orbit = t * 1.25;
    const zs = [];
    for (let k = 0; k < LULLABY_ZS; k++) {
      const a = turn + (k / LULLABY_ZS) * Math.PI * 2;
      const bob = clock === 0 ? 0 : Math.sin(clock / 300 + k * 1.7) * t * 0.06;
      zs.push({
        x: cx + Math.cos(a) * orbit,
        y: cy + Math.sin(a) * orbit + bob,
        size: t * (0.36 + 0.08 * Math.sin(a + 1)),
        alpha: 1,
      });
    }
    this.ghost.circle(cx, cy, orbit);
    this.ghost.stroke({ width: Math.max(2, t * 0.18), color: LULLABY, alpha: 0.25 });
    drawZs(this.ghost, zs, t);
  }

  /**
   * A red cross on every frozen cell under the piece in hand (the user's, 2026-10-21): the ghost
   * only turned invalid, and did not say why.
   */
  private drawFrozenUnderPiece(state: MatchState, view: ViewTransform, ghost: Ghost): void {
    if (state.frozen.length === 0 || ghost.tile === null || ghost.cells.length === 0) return;
    const t = view.tile;
    let any = false;
    for (const [dx, dy] of ghost.cells) {
      const [x, y] = [ghost.tile.x + dx, ghost.tile.y + dy];
      if (x < 0 || y < 0 || x >= state.width || y >= state.height) continue;
      if (!isFrozen(state, y * state.width + x)) continue;
      const [l, top] = [tileX(view, x) + t * 0.2, tileY(view, y) + t * 0.2];
      this.ghost.moveTo(l, top).lineTo(l + t * 0.6, top + t * 0.6);
      this.ghost.moveTo(l + t * 0.6, top).lineTo(l, top + t * 0.6);
      any = true;
    }
    if (any)
      this.ghost.stroke({ width: Math.max(2, t / 6), color: 0xff2b2b, alpha: 0.95, cap: 'round' });
  }

  /**
   * A ready Laser Tower's line (the user's, 2026-10-21): faint, from the tower through the
   * cursor to the board's edge, since the click sets only its direction, in the player's colour
   * as their beam is (the users', 2026-10-21; red at first). Not the walls it would clear — that
   * is for the player to read.
   */
  private drawLaserLine(
    state: MatchState,
    view: ViewTransform,
    ghost: Ghost,
    colour: number,
  ): void {
    const next = ghost.nextTower;
    if (!ghost.aiming || ghost.tile === null || next?.kind !== 'laser') return;
    if (ghost.impact?.ready !== true) return;
    const { x, y } = ghost.tile;
    if (x === next.fromX && y === next.fromY) return;
    const end = edgeOf(next.fromX, next.fromY, x, y, state.width, state.height);
    const [ax, ay] = [tileX(view, next.fromX + 0.5), tileY(view, next.fromY + 0.5)];
    const [bx, by] = [tileX(view, end.x + 0.5), tileY(view, end.y + 0.5)];
    // A glow round a white core, as the beam is: the colour alone vanished over an island
    // of the same colour.
    for (const [width, tint, alpha] of [
      [Math.max(3, view.tile * 0.3), colour, 0.3],
      [Math.max(1, view.tile / 14), 0xffffff, 0.6],
    ] as const) {
      this.ghost.moveTo(ax, ay).lineTo(bx, by);
      this.ghost.stroke({ width, color: tint, alpha, cap: 'round' });
    }
  }

  /**
   * A ready Subwoofer under the cursor (the user's, 2026-10-30): the band its wave will sweep,
   * from the tower through the cursor to the board's edge, as wide as its lanes together — one
   * shape rather than a laser's line a lane, which did not read as a wave — and rings of sound
   * pulsing out from the cursor. The lanes as the rules send them (`waveRays`): a whole tile
   * apart across rows or columns, whichever the line runs along less, so the band's ends are cut
   * square to that axis rather than to the line.
   */
  private drawSubwoofer(
    state: MatchState,
    view: ViewTransform,
    ghost: Ghost,
    colour: number,
  ): void {
    const next = ghost.nextTower;
    if (!ghost.aiming || ghost.tile === null || next?.kind !== 'subwoofer') return;
    if (ghost.impact?.ready !== true) return;
    const t = view.tile;
    const { x, y } = ghost.tile;
    const [cx, cy] = [tileX(view, x + 0.5), tileY(view, y + 0.5)];
    const rays = waveRays(next.fromX, next.fromY, x, y, subwooferOf(state, next.cost).waveWidth);
    const first = rays?.[0];
    const last = rays?.[rays.length - 1];
    if (first !== undefined && last !== undefined) {
      // The outer lanes' centres, then half a tile beyond each across the lanes: the band's sides.
      const acrossRows = Math.abs(first.dx) >= Math.abs(first.dy);
      const side = (
        ray: typeof first,
        out: number,
      ): { ax: number; ay: number; bx: number; by: number } => {
        const [fx, fy] = [ray.ax / 2 + (acrossRows ? 0 : out), ray.ay / 2 + (acrossRows ? out : 0)];
        const end = edgeOf(fx, fy, fx + ray.dx / 2, fy + ray.dy / 2, state.width, state.height);
        return {
          ax: tileX(view, fx + 0.5),
          ay: tileY(view, fy + 0.5),
          bx: tileX(view, end.x + 0.5),
          by: tileY(view, end.y + 0.5),
        };
      };
      const a = side(first, -0.5);
      const b = side(last, 0.5);
      this.ghost.poly([a.ax, a.ay, a.bx, a.by, b.bx, b.by, b.ax, b.ay]);
      this.ghost.fill({ color: colour, alpha: 0.16 });
      // Its two long sides as the beam's line is, a glow round a white core.
      for (const [width, tint, alpha] of [
        [Math.max(3, t * 0.24), colour, 0.3],
        [Math.max(1, t / 14), 0xffffff, 0.6],
      ] as const) {
        for (const s of [a, b]) this.ghost.moveTo(s.ax, s.ay).lineTo(s.bx, s.by);
        this.ghost.stroke({ width, color: tint, alpha, cap: 'round' });
      }
    }
    drawBassRings(this.ghost, cx, cy, t * 1.1, colour, performance.now());
  }

  /**
   * A Laser Tower's beam: from the tower's centre to where it ended (in tiles, as a shot's
   * `fromX`), through the walls it cleared, in its owner's colour round a white core.
   */
  noteLaser(
    fromX: number,
    fromY: number,
    endX: number,
    endY: number,
    hits: { x: number; y: number }[],
    colour: number,
  ): void {
    this.beams.push({ fromX, fromY, endX, endY, hits, colour, ms: 0 });
  }

  /** A Frost Cannon's shot has landed here, freezing the tile. */
  noteFrost(x: number, y: number): void {
    this.frostBursts.push({ x, y, ms: 0 });
  }

  /** A Bertha's shot has landed here, clearing these tiles round it. */
  noteBlast(x: number, y: number, crater: readonly (readonly [number, number])[]): void {
    this.blasts.push({ x, y, crater, reach: craterReach(crater), ms: 0 });
  }

  /**
   * A Lightning Tower's strike: from the tower's centre (in tiles, as a shot's `fromX`) through
   * every tile struck, each the centre of its tile, kinked between, the strikes in order.
   */
  noteLightning(
    fromX: number,
    fromY: number,
    path: readonly { x: number; y: number }[],
    colour: number,
  ): void {
    const random = Math.random;
    const points: { x: number; y: number }[] = [];
    const strikes: number[] = [];
    let at = { x: fromX + 0.5, y: fromY + 0.5 };
    for (const tile of path) {
      const to = { x: tile.x + 0.5, y: tile.y + 0.5 };
      const leg = kinked(
        at,
        to,
        Math.max(2, Math.round(Math.hypot(to.x - at.x, to.y - at.y) / 1.5)),
        random,
      );
      points.push(...(points.length === 0 ? leg : leg.slice(1)));
      strikes.push(points.length - 1);
      at = to;
    }
    this.bolts.push({ points, strikes, colour, ms: 0 });
  }

  /** An Architect has rebuilt these walls, of a board this wide, for this player. */
  noteRepair(tiles: readonly number[], width: number, colour: number): void {
    this.repairs.push({ tiles, width, colour, ms: 0 });
  }

  drawEffects(view: ViewTransform, deltaMs: number): void {
    if (
      this.blasts.length === 0 &&
      this.repairs.length === 0 &&
      this.bolts.length === 0 &&
      this.beams.length === 0 &&
      this.frostBursts.length === 0 &&
      this.shatters.length === 0
    ) {
      clearDrawn(this.effects);
      return;
    }
    const g = this.effects;
    g.clear();
    // Under reduced motion each flashes once, held, rather than spreading or rising.
    const still = motionReduced();
    for (const blast of this.blasts) {
      blast.ms += deltaMs;
      const t = Math.min(1, blast.ms / blastMs(blast));
      const cx = tileX(view, blast.x + 0.5);
      const cy = tileY(view, blast.y + 0.5);
      // The crater, flashing, and a ring spreading past it: Bertha's cross reaches a tile, so
      // her ring was 0.6 to 2.2 tiles; a wider crater's spreads as much farther as it reaches.
      const fade = 1 - t;
      for (const [dx, dy] of blast.crater) {
        g.rect(tileX(view, blast.x + dx), tileY(view, blast.y + dy), view.tile, view.tile);
      }
      g.fill({ color: IMPACT_GLOW, alpha: 0.45 * fade });
      const reach = Math.max(1, blast.reach);
      const r = view.tile * reach * (still ? 1.6 : 0.6 + 1.6 * t);
      g.circle(cx, cy, r);
      g.stroke({
        width: Math.max(2, view.tile * 0.22 * Math.sqrt(reach) * fade),
        color: IMPACT_GLOW,
        alpha: fade,
      });
    }
    for (const repair of this.repairs) {
      repair.ms += deltaMs;
      const t = Math.min(1, repair.ms / REPAIR_MS);
      const fade = t < 0.3 ? t / 0.3 : 1 - (t - 0.3) / 0.7;
      const rise = still ? 0 : (1 - t) * view.tile * 0.5;
      for (const i of repair.tiles) {
        const x = i % repair.width;
        const y = (i - x) / repair.width;
        const inset = view.tile * 0.08;
        g.rect(
          tileX(view, x) + inset,
          tileY(view, y) + inset - rise,
          view.tile - 2 * inset,
          view.tile - 2 * inset,
        );
      }
      g.stroke({ width: Math.max(1.5, view.tile * 0.12), color: 0xffffff, alpha: 0.9 * fade });
      for (const i of repair.tiles) {
        const x = i % repair.width;
        const y = (i - x) / repair.width;
        g.rect(tileX(view, x), tileY(view, y), view.tile, view.tile);
      }
      g.fill({ color: repair.colour, alpha: 0.35 * fade });
    }
    for (const bolt of this.bolts) {
      bolt.ms += deltaMs;
      // The strikes come one after another: the bolt reaches the k-th at k steps, then fades.
      const reached = Math.min(bolt.strikes.length, Math.floor(bolt.ms / BOLT_STEP_MS) + 1);
      const end = bolt.strikes[reached - 1] as number;
      const done = bolt.strikes.length * BOLT_STEP_MS;
      // Never below 0: on the frame that passes its end, before it is dropped, the fade fell a
      // little under it, and a negative alpha came out of Pixi's colour packing nearly opaque —
      // the effect flashed back at its very end (the users', 2026-10-21).
      const fade = still ? 1 : Math.max(0, 1 - Math.max(0, (bolt.ms - done) / BOLT_FADE_MS));
      if (fade <= 0) continue;
      const at = (p: { x: number; y: number }) => ({ x: tileX(view, p.x), y: tileY(view, p.y) });
      for (const [width, colour, alpha] of [
        [Math.max(3, view.tile * 0.4), bolt.colour, 0.35],
        [Math.max(2, view.tile * 0.16), SPARK, 0.8],
        [Math.max(1, view.tile * 0.06), 0xffffff, 1],
      ] as const) {
        const first = at(bolt.points[0]!);
        g.moveTo(first.x, first.y);
        for (const p of bolt.points.slice(1, end + 1)) {
          const q = at(p);
          g.lineTo(q.x, q.y);
        }
        g.stroke({ width, color: colour, alpha: alpha * fade, join: 'round', cap: 'round' });
      }
      // Each strike flashes once as the bolt reaches it and dies away on its own: held to
      // the bolt's fade, every flash burned at once at the end, overlapping (the user's).
      for (let k = 0; k < reached; k++) {
        const since = bolt.ms - k * BOLT_STEP_MS;
        const flash = still ? 0.3 : 0.3 * Math.max(0, 1 - since / FLASH_MS);
        if (flash <= 0) continue;
        const p = at(bolt.points[bolt.strikes[k] as number]!);
        g.circle(p.x, p.y, view.tile * 0.45);
        g.fill({ color: SPARK, alpha: flash });
      }
    }
    for (const beam of this.beams) {
      beam.ms += deltaMs;
      // Drawn out from the tower, held, then faded and narrowed; at once and held, still.
      const reach = still ? 1 : Math.min(1, beam.ms / BEAM_REACH_MS);
      // Never below 0, as the bolt's fade.
      const fade = still
        ? 1
        : Math.max(0, 1 - Math.max(0, (beam.ms - BEAM_REACH_MS - BEAM_HOLD_MS) / BEAM_FADE_MS));
      if (fade <= 0) continue;
      const [ax, ay] = [tileX(view, beam.fromX + 0.5), tileY(view, beam.fromY + 0.5)];
      const [ex, ey] = [tileX(view, beam.endX + 0.5), tileY(view, beam.endY + 0.5)];
      const [bx, by] = [ax + (ex - ax) * reach, ay + (ey - ay) * reach];
      for (const [width, colour, alpha] of [
        [Math.max(4, view.tile * 0.55), beam.colour, 0.3],
        [Math.max(2, view.tile * 0.22), beam.colour, 0.85],
        [Math.max(1, view.tile * 0.08), 0xffffff, 1],
      ] as const) {
        g.moveTo(ax, ay).lineTo(bx, by);
        g.stroke({
          width: width * (0.4 + 0.6 * fade),
          color: colour,
          alpha: alpha * fade,
          cap: 'round',
        });
      }
      // Each wall it burns through flashes as the beam reaches it.
      const length = Math.hypot(beam.endX - beam.fromX, beam.endY - beam.fromY) || 1;
      for (const hit of beam.hits) {
        const along = Math.hypot(hit.x - beam.fromX, hit.y - beam.fromY) / length;
        if (along > reach + 1e-6) continue;
        const since = beam.ms - along * BEAM_REACH_MS;
        const flash = still ? 0.35 : 0.45 * Math.max(0, 1 - since / (BEAM_HOLD_MS + FLASH_MS));
        if (flash <= 0) continue;
        g.circle(tileX(view, hit.x + 0.5), tileY(view, hit.y + 0.5), view.tile * 0.5);
        g.fill({ color: 0xffffff, alpha: flash });
      }
    }
    for (const burst of this.frostBursts) {
      burst.ms += deltaMs;
      // A ring of frost spreading and fading, and six crystals thrown out from the tile.
      const t = still ? 0.5 : Math.min(1, burst.ms / FROST_BURST_MS);
      const fade = still ? 0.6 : 1 - t;
      const [cx, cy] = [tileX(view, burst.x + 0.5), tileY(view, burst.y + 0.5)];
      g.circle(cx, cy, view.tile * (0.5 + 1.1 * t));
      g.stroke({ width: Math.max(2, view.tile * 0.2 * fade), color: ICE, alpha: fade });
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
        const r0 = view.tile * (0.3 + 0.6 * t);
        const r1 = r0 + view.tile * 0.35;
        g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0).lineTo(
          cx + Math.cos(a) * r1,
          cy + Math.sin(a) * r1,
        );
      }
      g.stroke({
        width: Math.max(1.5, view.tile * 0.1),
        color: ICE_RIM,
        alpha: fade,
        cap: 'round',
      });
    }
    this.frostBursts = this.frostBursts.filter((b) => b.ms < FROST_BURST_MS);
    for (const shatter of this.shatters) {
      shatter.ms += deltaMs;
      // The block breaking into shards that fly apart and fade, and a splash where it stood.
      const t = still ? 0.4 : Math.min(1, shatter.ms / SHATTER_MS);
      const fade = 1 - t;
      const [cx, cy] = [tileX(view, shatter.x + 0.5), tileY(view, shatter.y + 0.5)];
      const s = view.tile * 0.24 * (1 - 0.5 * t);
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
        const r = view.tile * (0.2 + 0.7 * t);
        const [px, py] = [cx + Math.cos(a) * r, cy + Math.sin(a) * r + view.tile * 0.3 * t * t];
        g.poly([px, py - s, px + s, py, px, py + s, px - s, py]);
      }
      g.fill({ color: ICE, alpha: fade });
      g.circle(cx, cy, view.tile * (0.3 + 0.4 * t));
      g.stroke({ width: Math.max(1.5, view.tile * 0.1), color: ICE_RIM, alpha: 0.7 * fade });
    }
    this.shatters = this.shatters.filter((b) => b.ms < SHATTER_MS);
    this.beams = this.beams.filter((b) => b.ms < BEAM_MS);
    this.bolts = this.bolts.filter((b) => b.ms < b.strikes.length * BOLT_STEP_MS + BOLT_FADE_MS);
    this.blasts = this.blasts.filter((b) => b.ms < blastMs(b));
    this.repairs = this.repairs.filter((r) => r.ms < REPAIR_MS);
  }
}
