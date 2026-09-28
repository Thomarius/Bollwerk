import type { ArtConfig, ArtStyle } from '@rampart/config';
import { Structure, findReadyCannon, type MatchState, type Shot } from '@rampart/sim';
import type { Container, Graphics } from 'pixi.js';

import type { SealGlow } from '../seal.js';

/**
 * A visual style.
 *
 * The scene owns the camera, the layer stack, when a redraw is needed and how input
 * maps to tiles. A theme owns only what things look like. Splitting it this way means
 * a second style costs its drawing code and nothing else — no duplicated update logic,
 * no second copy of the dirty-tracking, and no reach into the simulation, since
 * everything a style needs is derived from grid state the client already has.
 */
export interface Theme {
  readonly id: ArtStyle;

  /**
   * Prepares the style and takes ownership of its layers. Asynchronous because a
   * texture-based style generates its atlas here.
   */
  init(layers: ThemeLayers, art: ArtConfig): Promise<void>;

  /** Static for the whole match: land, water, island tint. */
  drawTerrain(state: MatchState, view: ViewTransform): void;
  /** Enclosed regions, redrawn when the solver says they changed. */
  drawTerritory(state: MatchState, view: ViewTransform): void;
  /** Walls, castles and cannons; redrawn only when the grid changes. */
  drawStructures(state: MatchState, view: ViewTransform): void;
  /** Shots in flight and impact flashes; every frame. */
  drawEffects(state: MatchState, view: ViewTransform, frame: EffectFrame): void;
  /** Reticle, piece ghost and selectable castles; every frame. */
  drawOverlay(state: MatchState, view: ViewTransform, ghost: Ghost, humanPlayer: number): void;

  /** A shot has just landed here, destroying these wall blocks. */
  noteImpact(x: number, y: number, debris: readonly Debris[]): void;
  /** A cannon has just fired this shot. */
  noteShot(shot: Shot): void;
  /** A swept wall block has just been taken away by the banner passing over it. */
  noteCrumble(block: Debris): void;
  /** A piece has just been placed: these cells, on this player's island. */
  noteLanding(cells: readonly Cell[], owner: number): void;

  /** Releases textures and display objects. */
  destroy(): void;
}

export interface ThemeLayers {
  terrain: Container;
  territory: Container;
  structures: Container;
  effects: Container;
  overlay: Container;
}

export interface ViewTransform {
  /** Side of one tile, in screen pixels. */
  tile: number;
  originX: number;
  originY: number;
  /** The canvas, in screen pixels: the board and the margin of sea round it. */
  width: number;
  height: number;
}

export interface EffectFrame {
  /** Progress through the current simulation tick, for smooth shot interpolation. */
  tickFraction: number;
  deltaMs: number;
  /**
   * Whether each castle is sealed as the board stands, by castle id — not the sim's
   * `enclosed`, which a breach in combat does not change until the next resolution.
   */
  castleSealed: readonly boolean[];
  /** The front of any flood of newly sealed ground; see `seal.ts`. */
  sealGlow: readonly SealGlow[];
  /** The player at this screen, or -1 when watching: whose wall is under threat. */
  humanPlayer: number;
  /** Castles just chosen, for the burst that marks each choice; see `drawChoices`. */
  choices: readonly Choice[];
  /** Winners' islands, by centre and owner, once the match is over: fireworks there. */
  celebrate: readonly Celebration[];
}

export interface Celebration {
  x: number;
  y: number;
  /** Player id, for the colour. */
  owner: number;
}

export interface Cell {
  x: number;
  y: number;
}

/** A wall block a shot destroyed, and whose it was. */
export interface Debris {
  x: number;
  y: number;
  owner: number;
}

export interface Ghost {
  /** Tile the pointer is over, or null when off the map. */
  tile: { x: number; y: number } | null;
  /** Cells of the held piece relative to the anchor, during build. */
  cells: readonly (readonly [number, number])[];
  valid: boolean;
  /** Footprint for the cannon ghost, during cannon placement. */
  footprint: { w: number; h: number } | null;
  /** Castles the player may choose, during castle selection. */
  selectable: readonly { x: number; y: number; w: number; h: number }[];
  /** The player's castles, when none of them is sealed. */
  unsealed: readonly { x: number; y: number; w: number; h: number }[];
  /** Whether to draw the aiming cursor: in combat, and while it is announced. */
  aiming: boolean;
}

/**
 * Greys out the island of every player who is out, for the rest of the match: their
 * rubble stays on the board, and without this it read as a player still in it.
 */
export function dimEliminated(
  g: Graphics,
  state: MatchState,
  view: ViewTransform,
  shade: number,
): void {
  const out = new Set(state.players.filter((p) => p.eliminated).map((p) => p.islandId));
  if (out.size === 0) return;
  for (let i = 0; i < state.islandId.length; i++) {
    if (!out.has(state.islandId[i] as number)) continue;
    const x = i % state.width;
    g.rect(tileX(view, x), tileY(view, (i - x) / state.width), view.tile, view.tile);
  }
  g.fill({ color: shade, alpha: 0.55 });
}

/**
 * The aiming cursor, shared by both styles because what it says matters more than how
 * it looks. It has to answer one question at a glance — will a click fire? — and a
 * slight change of colour did not: ready is a bright ring with a crosshair in the
 * player's colour, nothing ready is a small grey ring struck through. How many are
 * ready is a number beside it, drawn by the HUD.
 */
export function drawFireReticle(
  g: Graphics,
  view: ViewTransform,
  ghost: Ghost,
  art: ArtConfig,
  humanPlayer: number,
): void {
  if (ghost.tile === null) return;
  const cx = tileX(view, ghost.tile.x + 0.5);
  const cy = tileY(view, ghost.tile.y + 0.5);
  const width = Math.max(2, Math.round(view.tile / 9));
  if (ghost.valid) {
    const r = view.tile * 1.1;
    const ink = playerColour(art, humanPlayer, 'light');
    g.circle(cx, cy, r);
    g.stroke({ width: width + 1, color: ink });
    for (const [dx, dy] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ] as const) {
      g.moveTo(cx + dx * r * 0.45, cy + dy * r * 0.45);
      g.lineTo(cx + dx * r * 1.7, cy + dy * r * 1.7);
    }
    g.stroke({ width, color: ink });
    g.circle(cx, cy, Math.max(1.5, view.tile * 0.08));
    g.fill({ color: ink });
    return;
  }
  const r = view.tile * 0.7;
  const grey = hex(art.palette.rockLight);
  g.circle(cx, cy, r);
  g.stroke({ width, color: grey, alpha: 0.6 });
  g.moveTo(cx - r * 0.7, cy - r * 0.7);
  g.lineTo(cx + r * 0.7, cy + r * 0.7);
  g.stroke({ width, color: grey, alpha: 0.6 });
}

/**
 * Outlines a player's castles while none of them is sealed. Shared by both styles: it
 * is information, not decoration, and should read the same in either. It pulses, so it
 * is not mistaken for part of the board.
 */
export function drawBuildHints(
  g: Graphics,
  view: ViewTransform,
  ghost: Ghost,
  art: ArtConfig,
  nowMs: number,
): void {
  if (ghost.unsealed.length === 0) return;
  const pulse = 0.75 + 0.25 * Math.sin(nowMs / 180);
  // The UI's ink rather than its red: red vanished on the red player's own island, and
  // any one colour is some player's. Light reads on all of them.
  const warn = hex(art.palette.uiInk);
  for (const castle of ghost.unsealed) {
    g.rect(
      tileX(view, castle.x) - 2,
      tileY(view, castle.y) - 2,
      castle.w * view.tile + 4,
      castle.h * view.tile + 4,
    );
    g.stroke({ width: Math.max(3, Math.round(view.tile / 7)), color: warn, alpha: pulse });
  }
}

/**
 * The front of newly sealed ground, lit as it floods out from the castle. Shared by
 * both styles: it shows exactly what the last piece sealed.
 */
export function drawSealGlow(
  g: Graphics,
  view: ViewTransform,
  glow: readonly SealGlow[],
  art: ArtConfig,
): void {
  for (const tile of glow) {
    g.rect(tileX(view, tile.x), tileY(view, tile.y), view.tile, view.tile);
    g.fill({ color: playerColour(art, tile.owner, 'light'), alpha: 0.7 * tile.strength });
    const inset = view.tile * 0.3;
    g.rect(
      tileX(view, tile.x) + inset,
      tileY(view, tile.y) + inset,
      view.tile - inset * 2,
      view.tile - inset * 2,
    );
    g.fill({ color: hex(art.palette.uiInk), alpha: 0.6 * tile.strength });
  }
}

/**
 * A red border round the board, pulsing, while overtime lasts: the clock has run out
 * and only the piece in hand may still go down. Shared, since it is purely information.
 */
export function drawOvertimeBorder(
  g: Graphics,
  state: MatchState,
  view: ViewTransform,
  art: ArtConfig,
  nowMs: number,
): void {
  if (state.phase !== 'build' || !state.overtime) return;
  const pulse = 0.5 + 0.5 * Math.sin((nowMs / art.effects.overtimePulseMs) * Math.PI * 2);
  const width = Math.max(3, Math.round(view.tile / 3));
  // Just inside the board, whose edge is often the window's or the HUD bar's.
  g.rect(
    view.originX + width / 2,
    view.originY + width / 2,
    state.width * view.tile - width,
    state.height * view.tile - width,
  );
  g.stroke({ width, color: hex(art.palette.uiInvalid), alpha: 0.35 + 0.5 * pulse });
}

/**
 * Each castle's flag: hoisted from the foot of its pole when the castle is sealed, and
 * lowered — not whisked away — when a breach unseals it, so a player watching their
 * wall come down sees the moment their castle fell. Sealed again mid-way, it turns and
 * goes back up from wherever it had got to.
 */
export class FlagHoist {
  private readonly flags = new Map<number, { from: number; to: 0 | 1; at: number }>();

  update(castleSealed: readonly boolean[], nowMs: number, art: ArtConfig): void {
    castleSealed.forEach((sealed, id) => {
      const flag = this.flags.get(id);
      const target = sealed ? 1 : 0;
      if (flag === undefined) {
        if (sealed) this.flags.set(id, { from: 0, to: 1, at: nowMs });
        return;
      }
      if (flag.to === target) return;
      this.flags.set(id, { from: this.height(id, nowMs, art) ?? 0, to: target, at: nowMs });
    });
  }

  /** How far up its pole, 0 to 1, eased; null when the castle flies no flag. */
  raised(castleId: number, nowMs: number, art: ArtConfig): number | null {
    const height = this.height(castleId, nowMs, art);
    if (height === null) this.flags.delete(castleId);
    return height;
  }

  /** Whether the flag is on its way down, to be drawn as a castle fallen. */
  lowering(castleId: number): boolean {
    return this.flags.get(castleId)?.to === 0;
  }

  private height(castleId: number, nowMs: number, art: ArtConfig): number | null {
    const flag = this.flags.get(castleId);
    if (flag === undefined) return null;
    const span = flag.to === 1 ? art.effects.flagRaiseMs : art.effects.flagLowerMs;
    const t = Math.min(1, (nowMs - flag.at) / span);
    if (flag.to === 0 && t >= 1) return null;
    const eased = 1 - (1 - t) * (1 - t);
    return flag.from + (flag.to - flag.from) * eased;
  }
}

/**
 * Where a shot will come down, pulsing faster as it nears — and in red, thicker, when
 * it is coming down on the watching player's own wall. Shared by both styles: it is the
 * warning a player repairs by.
 */
export function drawShotTarget(
  g: Graphics,
  view: ViewTransform,
  state: MatchState,
  shot: Shot,
  t: number,
  art: ArtConfig,
  humanPlayer: number,
): void {
  const i = shot.toY * state.width + shot.toX;
  const mine =
    humanPlayer >= 0 &&
    state.islandId[i] === humanPlayer + 1 &&
    state.structure[i] === Structure.Wall;
  // The phase runs ever faster: three beats early in the flight, a flutter at the end.
  const beat = 0.5 + 0.5 * Math.sin(Math.PI * 2 * (2 * t + 6 * t * t));
  const r = view.tile * (0.4 + 0.12 * beat);
  const colour = mine ? hex(art.palette.uiInvalid) : playerColour(art, shot.owner, 'light');
  g.circle(tileX(view, shot.toX + 0.5), tileY(view, shot.toY + 0.5), r);
  g.stroke({
    width: mine ? Math.max(2, Math.round(view.tile / 8)) : 1,
    color: colour,
    alpha: (mine ? 0.55 : 0.3) + 0.4 * t * beat,
  });
}

/**
 * Pieces settling as they land: each block starts a little large and bright and eases
 * down onto its tile, which is what makes a placement feel like a stone set down
 * rather than a square switched on.
 */
export class Landings {
  private landings: { cells: readonly Cell[]; owner: number; age: number }[] = [];

  add(cells: readonly Cell[], owner: number): void {
    this.landings.push({ cells, owner, age: 0 });
  }

  draw(g: Graphics, view: ViewTransform, art: ArtConfig, deltaMs: number): void {
    const span = art.effects.landingMs;
    for (const landing of this.landings) {
      landing.age += deltaMs;
      const t = Math.min(1, landing.age / span);
      const grow = view.tile * 0.22 * (1 - t) * (1 - t);
      for (const cell of landing.cells) {
        g.rect(
          tileX(view, cell.x) - grow,
          tileY(view, cell.y) - grow,
          view.tile + grow * 2,
          view.tile + grow * 2,
        );
      }
      g.fill({ color: playerColour(art, landing.owner, 'light'), alpha: 0.55 * (1 - t) });
    }
    this.landings = this.landings.filter((landing) => landing.age < span);
  }
}

/**
 * Fireworks over the winning islands for as long as the match is over: rockets rising
 * from each island and bursting in its owner's colours. Shared by both styles — the end
 * of a match deserves the same send-off in either.
 */
export class Fireworks {
  private rockets: { x: number; y: number; peak: number; age: number; owner: number }[] = [];
  private sparks: {
    x: number;
    y: number;
    vx: number;
    vy: number;
    age: number;
    colour: number;
  }[] = [];
  private sinceLaunch = 0;

  draw(
    g: Graphics,
    view: ViewTransform,
    art: ArtConfig,
    celebrate: readonly Celebration[],
    deltaMs: number,
  ): void {
    const dt = deltaMs / 1000;
    this.sinceLaunch += deltaMs;
    if (celebrate.length > 0 && this.sinceLaunch >= art.effects.fireworkEveryMs) {
      this.sinceLaunch = 0;
      const from = celebrate[Math.floor(Math.random() * celebrate.length)] as Celebration;
      this.rockets.push({
        x: from.x + (Math.random() - 0.5) * 6,
        y: from.y + 2,
        peak: from.y - 2 - Math.random() * 4,
        age: 0,
        owner: from.owner,
      });
    }

    // Rockets climb, slowing, and burst at the top of their climb.
    const rise = 700;
    for (const rocket of this.rockets) {
      rocket.age += deltaMs;
      const t = Math.min(1, rocket.age / rise);
      const y = rocket.y + (rocket.peak - rocket.y) * (1 - (1 - t) * (1 - t));
      g.circle(tileX(view, rocket.x), tileY(view, y), Math.max(1.5, view.tile * 0.12));
      g.fill({ color: hex(art.palette.emberHot) });
      g.circle(tileX(view, rocket.x), tileY(view, y + 0.35), Math.max(1, view.tile * 0.08));
      g.fill({ color: hex(art.palette.emberMid), alpha: 0.6 });
      if (t < 1) continue;
      const colours = [
        playerColour(art, rocket.owner, 'light'),
        playerColour(art, rocket.owner, 'base'),
        hex(art.palette.uiInk),
      ];
      for (let k = 0; k < 40; k++) {
        const angle = (k / 40) * Math.PI * 2 + Math.random() * 0.2;
        const speed = 3.5 + Math.random() * 3.5;
        this.sparks.push({
          x: rocket.x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          age: 0,
          colour: colours[k % colours.length] as number,
        });
      }
    }
    this.rockets = this.rockets.filter((rocket) => rocket.age < rise);

    const life = 1200;
    for (const spark of this.sparks) {
      spark.age += deltaMs;
      const drag = Math.exp(-1.8 * dt);
      spark.vx *= drag;
      spark.vy = spark.vy * drag + 2.2 * dt;
      spark.x += spark.vx * dt;
      spark.y += spark.vy * dt;
      const t = spark.age / life;
      if (t >= 1) continue;
      const size = Math.max(2, view.tile * 0.24 * (1 - t * 0.5));
      g.rect(tileX(view, spark.x) - size / 2, tileY(view, spark.y) - size / 2, size, size);
      g.fill({ color: spark.colour, alpha: 1 - t * t });
    }
    this.sparks = this.sparks.filter((spark) => spark.age < life);
  }
}

/** A colour darkened toward black by `amount`, 0 to 1. */
export function dimmed(colour: number, amount: number): number {
  const k = 1 - amount;
  const r = Math.round(((colour >> 16) & 0xff) * k);
  const g = Math.round(((colour >> 8) & 0xff) * k);
  const b = Math.round((colour & 0xff) * k);
  return (r << 16) | (g << 8) | b;
}

/** `a` moved toward `b` by `amount`, 0 to 1. */
export function mixed(a: number, b: number, amount: number): number {
  const channel = (shift: number): number => {
    const from = (a >> shift) & 0xff;
    return Math.round(from + (((b >> shift) & 0xff) - from) * amount) << shift;
  };
  return channel(16) | channel(8) | channel(0);
}

/**
 * A ring round each of the player's own guns while its shot is in flight, filling as the
 * shot flies, and a flash off the gun as it lands: flight time is the reload, and
 * nothing else on the board says which guns a click can fire. Ready guns carry no ring,
 * so the board stays quiet where nothing is waiting. Shared by every style, in the
 * player's colour, like the aiming cursor.
 */
export class ReloadRings {
  /** Guns that had a shot in flight last frame. */
  private loading = new Set<number>();
  private flashes: { x: number; y: number; r: number; age: number }[] = [];

  draw(
    g: Graphics,
    view: ViewTransform,
    state: MatchState,
    art: ArtConfig,
    humanPlayer: number,
    tickFraction: number,
    deltaMs: number,
  ): void {
    if (humanPlayer < 0) return;
    const now = state.tick + tickFraction;
    const colour = playerColour(art, humanPlayer, 'light');
    const width = Math.max(1.5, view.tile / 9);
    const shots = new Map(state.shots.map((shot) => [shot.id, shot]));
    const loading = new Set<number>();
    for (const cannon of state.cannons) {
      if (cannon.owner !== humanPlayer) continue;
      const cx = tileX(view, cannon.x + cannon.w / 2);
      const cy = tileY(view, cannon.y + cannon.h / 2);
      const r = (Math.min(cannon.w, cannon.h) * view.tile) / 2 + view.tile * 0.08;
      if (cannon.shotId === null) {
        if (this.loading.has(cannon.id) && cannon.active) {
          this.flashes.push({ x: cx - view.originX, y: cy - view.originY, r, age: 0 });
        }
        continue;
      }
      loading.add(cannon.id);
      const shot = shots.get(cannon.shotId);
      if (shot === undefined) continue;
      const span = shot.impactTick - shot.launchTick;
      const p = span <= 0 ? 1 : Math.min(1, Math.max(0, (now - shot.launchTick) / span));
      g.circle(cx, cy, r);
      g.stroke({ width, color: colour, alpha: 0.18 });
      g.moveTo(cx, cy - r);
      g.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2);
      g.stroke({ width, color: colour, alpha: 0.8 });
    }
    this.loading = loading;

    const span = art.effects.readyFlashMs;
    for (const flash of this.flashes) {
      flash.age += deltaMs;
      const t = flash.age / span;
      if (t >= 1) continue;
      g.circle(flash.x + view.originX, flash.y + view.originY, flash.r * (1 + 0.45 * t));
      g.stroke({ width: width * (1.6 - t), color: colour, alpha: 1 - t });
    }
    this.flashes = this.flashes.filter((flash) => flash.age < span);
  }
}

/**
 * While aiming, the course a click would send a shot on: a dotted arc from the gun the
 * game would fire — `findReadyCannon`, the rule `fire` itself uses, so it is never
 * wrong — to the cursor, lifted as the shot will be, and a ring round that gun. Only
 * where a click would fire. Shared by every style.
 */
export function drawAimLine(
  g: Graphics,
  view: ViewTransform,
  state: MatchState,
  ghost: Ghost,
  art: ArtConfig,
  humanPlayer: number,
): void {
  if (!ghost.aiming || !ghost.valid || ghost.tile === null || humanPlayer < 0) return;
  const cannon = findReadyCannon(state, humanPlayer, ghost.tile.x, ghost.tile.y);
  if (cannon === null) return;
  const course = {
    fromX: cannon.x + (cannon.w - 1) / 2,
    fromY: cannon.y + (cannon.h - 1) / 2,
    toX: ghost.tile.x,
    toY: ghost.tile.y,
  };
  const colour = playerColour(art, humanPlayer, 'light');
  const alpha = art.effects.aimLineAlpha;
  const distance = Math.hypot(course.toX - course.fromX, course.toY - course.fromY);
  const dots = Math.max(3, Math.ceil(distance / 0.7));
  for (let k = 1; k < dots; k++) {
    const t = k / dots;
    const x = course.fromX + (course.toX - course.fromX) * t;
    const y = course.fromY + (course.toY - course.fromY) * t - shotLift(course, t);
    g.circle(tileX(view, x + 0.5), tileY(view, y + 0.5), Math.max(1.2, view.tile * 0.07));
  }
  g.fill({ color: colour, alpha });
  g.circle(
    tileX(view, cannon.x + cannon.w / 2),
    tileY(view, cannon.y + cannon.h / 2),
    (Math.min(cannon.w, cannon.h) * view.tile) / 2 + view.tile * 0.18,
  );
  g.stroke({ width: Math.max(1.5, view.tile / 9), color: colour, alpha: Math.min(1, alpha * 1.8) });
}

/**
 * The castles a player may choose, outlined and breathing, so the choice asks to be
 * made rather than sitting there as a frame. Shared by every style, in its accent.
 */
export function drawSelectable(
  g: Graphics,
  view: ViewTransform,
  ghost: Ghost,
  art: ArtConfig,
  nowMs: number,
): void {
  if (ghost.selectable.length === 0) return;
  const pulse = 0.5 + 0.5 * Math.sin(nowMs / 260);
  const accent = hex(art.palette.uiAccent);
  for (const castle of ghost.selectable) {
    const grow = view.tile * 0.12 * pulse;
    g.rect(
      tileX(view, castle.x) - grow,
      tileY(view, castle.y) - grow,
      castle.w * view.tile + grow * 2,
      castle.h * view.tile + grow * 2,
    );
  }
  g.stroke({ width: Math.max(2, view.tile / 7), color: accent, alpha: 0.55 + 0.45 * pulse });
  for (const castle of ghost.selectable) {
    g.rect(
      tileX(view, castle.x),
      tileY(view, castle.y),
      castle.w * view.tile,
      castle.h * view.tile,
    );
  }
  g.fill({ color: accent, alpha: 0.12 * pulse });
}

/** A castle just chosen, by whom and how long ago. */
export interface Choice {
  castle: { x: number; y: number; w: number; h: number };
  owner: number;
  ageMs: number;
}

/**
 * The moment a castle is chosen, for everyone to see: two rings in the chooser's colour
 * breaking outward from it, the second a beat after the first. Shared by every style.
 */
export function drawChoices(
  g: Graphics,
  view: ViewTransform,
  choices: readonly Choice[],
  art: ArtConfig,
): void {
  const span = art.effects.choiceBurstMs;
  for (const choice of choices) {
    for (const lag of [0, 0.25]) {
      const t = choice.ageMs / span - lag;
      if (t <= 0 || t >= 1) continue;
      const grow = view.tile * 2 * t;
      const { x, y, w, h } = choice.castle;
      g.rect(
        tileX(view, x) - grow,
        tileY(view, y) - grow,
        w * view.tile + grow * 2,
        h * view.tile + grow * 2,
      );
      g.stroke({
        width: Math.max(2, view.tile / 6) * (1 - t),
        color: playerColour(art, choice.owner, 'light'),
        alpha: 1 - t,
      });
    }
  }
}

/** Where a gun points, and how long ago it last fired. */
export interface Aim {
  angle: number;
  firedAgo: number;
}

/**
 * Where each gun points, for the styles drawn from shapes: at its last target once it
 * has fired, and until then at the nearest castle of another team, which is what a gun
 * faces — never a teammate's.
 */
export class GunAims {
  private readonly aims = new Map<number, Aim>();

  /** A gun has fired this shot: it turns to the target and starts its recoil. */
  fire(shot: Shot): number {
    const angle = Math.atan2(shot.toX - shot.fromX, -(shot.toY - shot.fromY));
    this.aims.set(shot.cannonId, { angle, firedAgo: 0 });
    return angle;
  }

  of(state: MatchState, cannonId: number): Aim | null {
    const known = this.aims.get(cannonId);
    if (known !== undefined) return known;
    const cannon = state.cannons.find((c) => c.id === cannonId);
    if (cannon === undefined) return null;
    const cx = cannon.x + cannon.w / 2;
    const cy = cannon.y + cannon.h / 2;
    let best = Number.POSITIVE_INFINITY;
    let angle = 0;
    for (const castle of state.castles) {
      const owner = state.players[castle.islandId - 1];
      if (owner === undefined || owner.team === state.players[cannon.owner]?.team) continue;
      const dx = castle.x + castle.w / 2 - cx;
      const dy = castle.y + castle.h / 2 - cy;
      const d = dx * dx + dy * dy;
      if (d < best) {
        best = d;
        angle = Math.atan2(dx, -dy);
      }
    }
    const aim = { angle, firedAgo: Number.POSITIVE_INFINITY };
    this.aims.set(cannonId, aim);
    return aim;
  }

  /** Forgets guns that no longer exist, so a continue's wiped island starts clean. */
  prune(state: MatchState): void {
    if (this.aims.size <= state.cannons.length) return;
    const live = new Set(state.cannons.map((c) => c.id));
    for (const id of this.aims.keys()) if (!live.has(id)) this.aims.delete(id);
  }
}

export function hex(value: string): number {
  return Number.parseInt(value.slice(1), 16);
}

/** Player colours cycle if a match ever has more players than the palette defines. */
export function playerColour(
  art: ArtConfig,
  player: number,
  shade: 'base' | 'light' | 'dark',
): number {
  const entry = art.players[player % art.players.length];
  return hex(entry ? entry[shade] : art.palette.uiInk);
}

/**
 * Fraction of its own range a shot rises at the top of its arc.
 *
 * Range, not flight time. The lift used to be `span * 0.25` where `span` is the flight
 * in ticks, which tied the picture to the reload: when flight time went from 1.05s to
 * 3.05s at twenty tiles (ARCHIVE.md 10k), the apex went from 8 tiles to 23 and most shots
 * simply left the top of the screen. A lob's height should follow how far it is thrown,
 * and then it survives any amount of balance tuning.
 */
const ARC_RISE = 0.22;

/**
 * Ceiling on the arc, so a shot across a big map still stays on it.
 *
 * Five tiles is a fifth of the height of the two-player map, which is the shortest one
 * the game generates — enough to read as a lob, not enough to leave the screen from a
 * gun near the top edge.
 */
const ARC_MAX_TILES = 5;

/** How far above the ground a shot rides, in tiles, at progress `t` through its flight. */
export function shotLift(shot: Pick<Shot, 'fromX' | 'fromY' | 'toX' | 'toY'>, t: number): number {
  const dx = shot.toX - shot.fromX;
  const dy = shot.toY - shot.fromY;
  const range = Math.sqrt(dx * dx + dy * dy);
  return Math.sin(Math.PI * t) * Math.min(range * ARC_RISE, ARC_MAX_TILES);
}

/** Top-left of a tile in screen space. */
export function tileX(view: ViewTransform, x: number): number {
  return view.originX + x * view.tile;
}

export function tileY(view: ViewTransform, y: number): number {
  return view.originY + y * view.tile;
}
