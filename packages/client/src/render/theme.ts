import type { ArtConfig, ArtStyle } from '@rampart/config';
import { findReadyCannon, type MatchState, type Shot } from '@rampart/sim';
import type { Container, Graphics } from 'pixi.js';

import type { DrainWash, SealGlow } from '../seal.js';

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
  /** The first row of the canvas not under the HUD bar. */
  top: number;
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
  /** Ground lost to a breach, draining away; the build look's alone (`drainWash`). */
  drain: readonly DrainWash[];
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
  /**
   * The ring the castle under the pointer would get if chosen — tile indices from the
   * sim's own `startingRingTiles` — and whose colour to draw it in. Absent otherwise.
   */
  ring?: { tiles: readonly number[]; width: number; owner: number };
  /** The player's castles, when none of them is sealed. */
  unsealed: readonly { x: number; y: number; w: number; h: number }[];
  /**
   * Where the build phase's last seconds stand within the current one, 0 as a tick
   * sounds (`countdownBeat`); null or absent outside them.
   */
  beat?: number | null;
  /** Whether to draw the aiming cursor: in combat, and while it is announced. */
  aiming: boolean;
  /** Ground the piece in hand would seal, when the sealing preview is on (`sealPreview.ts`). */
  sealing?: readonly Cell[];
  /**
   * While aiming with no gun ready: how far the next is from firing again, 0 to 1
   * (`nextReload`), which the cursor fills as it comes round. Null or absent otherwise.
   */
  reload?: number | null;
}

/**
 * The sealing preview: the ground the piece in hand would seal, washed faintly in the
 * valid ink and outlined, under the piece. Shared by every style, as the other things a
 * player builds by are.
 */
export function drawSealPreview(
  g: Graphics,
  view: ViewTransform,
  ghost: Ghost,
  art: ArtConfig,
): void {
  const cells = ghost.sealing;
  if (cells === undefined || cells.length === 0 || !ghost.valid) return;
  const inside = new Set(cells.map((c) => `${c.x},${c.y}`));
  for (const c of cells) g.rect(tileX(view, c.x), tileY(view, c.y), view.tile, view.tile);
  g.fill({ color: hex(art.palette.uiValid), alpha: 0.12 });
  for (const { x, y } of cells) {
    const left = tileX(view, x);
    const top = tileY(view, y);
    const right = left + view.tile;
    const bottom = top + view.tile;
    if (!inside.has(`${x},${y - 1}`)) g.moveTo(left, top).lineTo(right, top);
    if (!inside.has(`${x + 1},${y}`)) g.moveTo(right, top).lineTo(right, bottom);
    if (!inside.has(`${x},${y + 1}`)) g.moveTo(left, bottom).lineTo(right, bottom);
    if (!inside.has(`${x - 1},${y}`)) g.moveTo(left, top).lineTo(left, bottom);
  }
  g.stroke({ width: Math.max(1, view.tile / 12), color: hex(art.palette.uiValid), alpha: 0.6 });
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
  // No gun ready: the next one's reload, filling round the cursor from the top — where
  // the eye already is while aiming, which rings round each gun on the player's own
  // island never were. At the ready ring's radius, so as it closes it becomes that ring.
  const reload = ghost.reload;
  if (reload === null || reload === undefined) return;
  const ring = view.tile * 1.1;
  const ink = playerColour(art, humanPlayer, 'light');
  g.circle(cx, cy, ring);
  g.stroke({ width: width + 3, color: 0x000000, alpha: 0.45 });
  g.circle(cx, cy, ring);
  g.stroke({ width: width + 1, color: ink, alpha: 0.25 });
  if (reload <= 0) return;
  g.moveTo(cx, cy - ring);
  g.arc(cx, cy, ring, -Math.PI / 2, -Math.PI / 2 + reload * Math.PI * 2);
  g.stroke({ width: width + 1, color: ink });
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
  // Over the countdown's last seconds, a red flash on every tick, fading through the
  // second, round the outline (PLAN 11.15): still unsealed, and heard and seen at once.
  // Outside the ink, so the ink still reads on the red player's own island.
  const beat = ghost.beat;
  if (beat === undefined || beat === null) return;
  const flash = (1 - beat) * (1 - beat);
  const reach = Math.max(4, Math.round(view.tile / 5));
  for (const castle of ghost.unsealed) {
    g.rect(
      tileX(view, castle.x) - 2 - reach,
      tileY(view, castle.y) - 2 - reach,
      castle.w * view.tile + 4 + reach * 2,
      castle.h * view.tile + 4 + reach * 2,
    );
  }
  g.stroke({ width: reach, color: hex(art.palette.uiInvalid), alpha: 0.25 + 0.75 * flash });
}

/**
 * The front of newly sealed ground, lit as it floods out from the castle. Shared by
 * both styles: it shows exactly what the last piece sealed.
 */
/**
 * Ground lost to a breach, washed dark red and running out through the gap as the
 * "Rebuild" banner reveals the board (PLAN 11.15). Shared by every style, like the flood
 * it reverses: it says what the barrage cost. Dark as well as red, so the red player's
 * lost ground reads too, and faint enough that the island under it still shows.
 */
export function drawDrain(
  g: Graphics,
  view: ViewTransform,
  drain: readonly DrainWash[],
  art: ArtConfig,
): void {
  if (drain.length === 0) return;
  const red = hex(art.palette.uiInvalid);
  for (const { x, y, strength } of drain) {
    g.rect(tileX(view, x), tileY(view, y), view.tile, view.tile);
    g.fill({ color: 0x1a0204, alpha: 0.3 * strength });
    g.rect(tileX(view, x), tileY(view, y), view.tile, view.tile);
    g.fill({ color: red, alpha: 0.38 * strength });
  }
}

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

/** A crown's outline in units of its width, from the left end of its band, y down. */
const CROWN: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, 0],
  [1, -0.62],
  [0.76, -0.32],
  [0.5, -0.72],
  [0.24, -0.32],
  [0, -0.62],
];

/**
 * A crown over each player's main castle — the one they chose, worth the first castle's
 * reward (`cannonReward`) — sealed or not, since which castle counts double matters most
 * once it is breached. One shared mark rather than new art in every style (PLAN 11.14),
 * in the owner's colour with a dark rim so it reads on any ground. Bright while the
 * castle is sealed; dimmed to stone grey with a crack across it, once breached
 * (11.15), by the look's own `castleSealed`, so the combat look holds it through combat
 * as it holds every other sign of sealed. None over a player who is out, or between a
 * continue and the castle chosen after it.
 */
export function drawMainCastles(
  g: Graphics,
  view: ViewTransform,
  state: MatchState,
  art: ArtConfig,
  castleSealed: readonly boolean[],
): void {
  const width = view.tile * 1.35;
  const rim = Math.max(1, Math.round(view.tile / 10));
  for (const player of state.players) {
    if (player.eliminated || player.startingCastleId === null) continue;
    const castle = state.castles.find((c) => c.id === player.startingCastleId);
    if (castle === undefined) continue;
    // Centred on the castle's block, not over it where the flag flies (the test
    // sessions); the crown is 0.72 of its width tall, so its band sits that much below.
    const left = tileX(view, castle.x + castle.w / 2) - width / 2;
    const base = tileY(view, castle.y + castle.h / 2) + width * 0.36;
    const sealed = castleSealed[castle.id] === true;
    g.poly(CROWN.flatMap(([x, y]) => [left + x * width, base + y * width]));
    // Breached, stone grey rather than the owner's dark shade, which vanished into a
    // castle of the same colour.
    g.fill(
      sealed ? { color: playerColour(art, player.id, 'light') } : { color: 0x9a9aa4, alpha: 0.9 },
    );
    g.stroke({ width: rim, color: 0x0a0a12, alpha: 0.85, join: 'round' });
    if (!sealed) {
      // The crack: a zigzag down through the band from the middle spike's valley.
      const crack = [
        [0.46, -0.52],
        [0.56, -0.34],
        [0.44, -0.18],
        [0.54, 0],
      ];
      g.moveTo(left + crack[0]![0]! * width, base + crack[0]![1]! * width);
      for (const [x, y] of crack.slice(1)) g.lineTo(left + x! * width, base + y! * width);
      g.stroke({ width: rim, color: 0x0a0a12, alpha: 0.9, join: 'round' });
    }
  }
}

/**
 * Where one of the watching player's own shots will come down, pulsing faster as it
 * nears. Only their own (PLAN 11.14): opponents' marks, and the red warning over their
 * own wall, gave away where every shot was going; the balls in flight still show.
 * Nothing for a spectator, who has no shots.
 */
export function drawShotTarget(
  g: Graphics,
  view: ViewTransform,
  shot: Shot,
  t: number,
  art: ArtConfig,
  humanPlayer: number,
): void {
  if (shot.owner !== humanPlayer) return;
  // The phase runs ever faster: three beats early in the flight, a flutter at the end.
  const beat = 0.5 + 0.5 * Math.sin(Math.PI * 2 * (2 * t + 6 * t * t));
  const r = view.tile * (0.4 + 0.12 * beat);
  g.circle(tileX(view, shot.toX + 0.5), tileY(view, shot.toY + 0.5), r);
  g.stroke({
    width: 1,
    color: playerColour(art, shot.owner, 'light'),
    alpha: 0.3 + 0.4 * t * beat,
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
 * The piece in hand, held: a soft shadow cast under it to the south-east, as if lifted
 * off the board, and on each turn a quick swing of its outline from where it pointed into
 * where it points now. Shared by every style; the shadow goes in `under`, beneath the
 * style's own drawing of the piece, the swing in `over`.
 */
export class GhostMotion {
  private last: { x: number; y: number; key: string; n: number } | null = null;
  private turnedAt = Number.NEGATIVE_INFINITY;

  draw(under: Graphics, over: Graphics, view: ViewTransform, ghost: Ghost, art: ArtConfig): void {
    const tile = ghost.tile;
    if (tile === null || ghost.cells.length === 0) {
      this.last = null;
      return;
    }
    const now = performance.now();
    const key = JSON.stringify(ghost.cells);
    const last = this.last;
    if (
      last !== null &&
      last.x === tile.x &&
      last.y === tile.y &&
      last.n === ghost.cells.length &&
      last.key !== key
    ) {
      this.turnedAt = now;
    }
    this.last = { x: tile.x, y: tile.y, key, n: ghost.cells.length };

    const t = view.tile;
    for (const [dx, dy] of ghost.cells) {
      under.rect(tileX(view, tile.x + dx + 0.14), tileY(view, tile.y + dy + 0.2), t, t);
    }
    under.fill({ color: hex(art.palette.shadow), alpha: 0.22 });

    const turnMs = 130;
    const k = (now - this.turnedAt) / turnMs;
    if (k >= 1) return;
    // Swinging from a quarter turn back into place about the piece's middle.
    const xs = ghost.cells.map(([dx]) => dx);
    const ys = ghost.cells.map(([, dy]) => dy);
    const px = tile.x + (Math.min(...xs) + Math.max(...xs) + 1) / 2;
    const py = tile.y + (Math.min(...ys) + Math.max(...ys) + 1) / 2;
    const angle = (-Math.PI / 2) * (1 - k) * (1 - k);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    for (const [dx, dy] of ghost.cells) {
      const corners = [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ].flatMap(([cx, cy]) => {
        const rx = tile.x + dx + (cx as number) - px;
        const ry = tile.y + dy + (cy as number) - py;
        return [tileX(view, px + rx * cos - ry * sin), tileY(view, py + rx * sin + ry * cos)];
      });
      over.poly(corners);
    }
    over.stroke({
      width: Math.max(1, t / 14),
      color: hex(art.palette.uiValid),
      alpha: 0.7 * (1 - k),
    });
  }
}

/**
 * A knocked-out island's castles burning: flames for a while as the player goes out, and
 * a thin column of smoke from each for the rest of the match, drifting on the wind. The
 * greying of the island says who is out; this says it happened. Shared by every style, in
 * each one's colours; no flames where a style has none to give.
 */
export class RuinSmoke {
  /** When each island was first seen out, by this look's clock. */
  private readonly since = new Map<number, number>();
  private clock = 0;

  draw(
    g: Graphics,
    view: ViewTransform,
    state: MatchState,
    smoke: number,
    flame: number | null,
    deltaMs: number,
  ): void {
    this.clock += deltaMs;
    const burnMs = 8000;
    for (const player of state.players) {
      if (!player.eliminated) continue;
      if (!this.since.has(player.islandId)) this.since.set(player.islandId, this.clock);
      const age = this.clock - (this.since.get(player.islandId) as number);
      const burning = flame !== null && age < burnMs ? 1 - age / burnMs : 0;
      for (const castle of state.castles) {
        if (castle.islandId !== player.islandId) continue;
        const cx = castle.x + castle.w / 2;
        const cy = castle.y + castle.h * 0.4;
        for (let k = 0; k < 5; k++) {
          const t = (this.clock / 2600 + k / 5 + castle.id * 0.31) % 1;
          const x = cx + t * 0.9 + Math.sin(t * 6 + castle.id) * 0.12;
          const y = cy - t * 2.2;
          g.circle(tileX(view, x), tileY(view, y), view.tile * (0.16 + t * 0.35));
          g.fill({ color: smoke, alpha: (0.3 + 0.25 * burning) * (1 - t) });
        }
        if (burning > 0 && flame !== null) {
          for (let k = 0; k < 3; k++) {
            const flicker = 0.7 + 0.3 * Math.sin(this.clock / 90 + k * 2 + castle.id);
            g.circle(
              tileX(view, castle.x + castle.w * (0.25 + k * 0.25)),
              tileY(view, castle.y + castle.h * 0.45),
              view.tile * 0.22 * flicker * burning,
            );
          }
          g.fill({ color: flame, alpha: 0.85 * burning });
        }
      }
    }
  }
}

/**
 * Scenery knocked flat by a piece landing on it, for the styles drawn from shapes: a few
 * specks thrown out and settling, in whatever colour the style draws its scenery in.
 * The pixel style throws leaves of its own.
 */
export class ClearingPuffs {
  private puffs: { x: number; y: number; age: number; colour: number }[] = [];

  add(cells: readonly Cell[], colour: number): void {
    for (const cell of cells) this.puffs.push({ x: cell.x + 0.5, y: cell.y + 0.5, age: 0, colour });
  }

  draw(g: Graphics, view: ViewTransform, deltaMs: number): void {
    const span = 480;
    for (const puff of this.puffs) {
      puff.age += deltaMs;
      const t = Math.min(1, puff.age / span);
      for (let k = 0; k < 6; k++) {
        const angle = (k / 6) * Math.PI * 2 + puff.x;
        const d = 0.15 + 0.45 * t;
        g.circle(
          tileX(view, puff.x + Math.cos(angle) * d),
          tileY(view, puff.y + Math.sin(angle) * d * 0.7 - 0.2 * t),
          Math.max(1, view.tile * 0.06 * (1 - t * 0.5)),
        );
      }
      g.fill({ color: puff.colour, alpha: 0.8 * (1 - t) });
    }
    this.puffs = this.puffs.filter((puff) => puff.age < span);
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

  // The ring the castle under the pointer would get, faint, in the chooser's colour:
  // where the guns will have to fit, seen before committing to it (PLAN 11.15).
  const ring = ghost.ring;
  if (ring === undefined || ring.tiles.length === 0) return;
  const inset = Math.max(1, view.tile * 0.12);
  for (const i of ring.tiles) {
    const x = i % ring.width;
    const y = (i - x) / ring.width;
    g.rect(
      tileX(view, x) + inset,
      tileY(view, y) + inset,
      view.tile - inset * 2,
      view.tile - inset * 2,
    );
  }
  const colour = playerColour(art, ring.owner, 'light');
  g.fill({ color: colour, alpha: 0.28 });
  g.stroke({ width: Math.max(1, view.tile / 12), color: colour, alpha: 0.7 });
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
