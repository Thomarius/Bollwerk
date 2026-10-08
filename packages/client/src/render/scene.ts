import { defaultArtConfig, type ArtConfig, type ArtStyle } from '@bollwerk/config';
import type { MatchState, Shot } from '@bollwerk/sim';
import { Application, BigPool, Container, Graphics, RenderTexture } from 'pixi.js';

import type { CameraShot } from '../camera.js';
import type { DrainWash, SealGlow } from '../seal.js';
import type { Look } from '../transition.js';
import { withDrawBudget } from './islandParts.js';

import { BlueprintTheme } from './blueprint.js';
import { BricksTheme } from './bricks.js';
import { ChocolateTheme } from './chocolate.js';
import { HalloweenTheme } from './halloween.js';
import { OktoberfestTheme } from './oktoberfest.js';
import { OfficeTheme } from './office.js';
import { UnderseaTheme } from './undersea.js';
import { ElectricTheme } from './electric.js';
import { CartoonTheme } from './cartoon.js';
import { ChristmasTheme } from './christmas.js';
import { NoirTheme } from './noir.js';
import { OperaTheme } from './opera.js';
import { release } from './release.js';
import { SakuraTheme } from './sakura.js';
import { GlassTheme } from './glass.js';
import { CyberpunkTheme } from './cyberpunk.js';
import { FlatTheme } from './flat.js';
import { ParchmentTheme } from './parchment.js';
import { PixelTheme } from './pixel.js';
import {
  hex,
  type Celebration,
  type Choice,
  type Cell,
  type Debris,
  type Ghost,
  type Pace,
  type Theme,
  type ThemeLayers,
  type ViewTransform,
} from './theme.js';

export type { Ghost, Theme, ViewTransform } from './theme.js';

/** Every style the client can render in. */
export function createTheme(style: ArtStyle, seed = 1): Theme {
  switch (style) {
    case 'flat':
      return new FlatTheme();
    case 'pixel':
    case 'night':
      // Night is the pixel style under its own palette: the same sprites, generated
      // from different colours.
      return new PixelTheme(seed, style);
    case 'cyberpunk':
      return new CyberpunkTheme(seed);
    case 'blueprint':
      return new BlueprintTheme();
    case 'parchment':
      return new ParchmentTheme(seed);
    case 'bricks':
      return new BricksTheme();
    case 'glass':
      return new GlassTheme();
    case 'chocolate':
      return new ChocolateTheme(seed);
    case 'halloween':
      return new HalloweenTheme(seed);
    case 'sakura':
      return new SakuraTheme(seed);
    case 'oktoberfest':
      return new OktoberfestTheme(seed);
    case 'opera':
      return new OperaTheme(seed);
    case 'office':
      return new OfficeTheme(seed);
    case 'undersea':
      return new UnderseaTheme(seed);
    case 'electric':
      return new ElectricTheme(seed);
    case 'cartoon':
      return new CartoonTheme(seed);
    case 'christmas':
      return new ChristmasTheme(seed);
    case 'noir':
      return new NoirTheme(seed);
  }
}

/** One look: the theme that draws it, and the art in that theme's own colours. */
export interface SceneLook {
  theme: Theme;
  art: ArtConfig;
}

/** A theme and the layer stack it owns, under one root so it can be masked whole. */
interface Slot {
  theme: Theme;
  art: ArtConfig;
  root: Container;
  /**
   * The look's sea, filling the window behind the board. The canvas has one background
   * colour, and a look with a sea of its own would otherwise sit in the other's frame —
   * during a wipe, half in each.
   */
  backdrop: Graphics;
  layers: ThemeLayers;
  /** Screen-space rectangle this look is confined to during a wipe. */
  mask: Graphics;
  /**
   * The layers that changed while it was hidden, to be redrawn before it is shown. By
   * layer, since terrain changes only with the window and is each style's dearest drawing:
   * redrawn at every wipe, it was most of a frame of 100 ms as Opera came into view.
   */
  stale: Set<BoardLayer>;
  /**
   * What of its board is still to be rendered once offscreen before it is seen, as paths
   * from a board layer down to one island's drawing (`warmChain`), while it is primed.
   */
  warming: Container[][];
  /** Whether its effects have been drawn and rendered once, unseen (`prime`). */
  effectsPrimed: boolean;
}

/**
 * A frame's share of a look made over frames: half of one at 60 Hz, the match's own drawing
 * taking the rest.
 */
const SHARE_MS = 8;

/** Waits for the next frame once `SHARE_MS` of work has been done in this one. */
function pacer(): Pace {
  let since = performance.now();
  return async () => {
    if (performance.now() - since < SHARE_MS) return;
    await new Promise((done) => requestAnimationFrame(done));
    since = performance.now();
  };
}

/**
 * A frame's share of readying the look the next banner brings, in the pause before it
 * (`prime`): the frame's own drawing is light then, nothing moving on the board.
 */
const PRIME_MS = 6;

/** The layers a look draws from the board, as against its effects drawn every frame. */
const BOARD_LAYERS = ['terrain', 'territory', 'structures'] as const;
type BoardLayer = (typeof BOARD_LAYERS)[number];

function newLayers(): ThemeLayers {
  return {
    // Named for the frame-time readout, which says which layer's drawing is rebuilt.
    terrain: new Container({ label: 'terrain' }),
    territory: new Container({ label: 'territory' }),
    structures: new Container({ label: 'structures' }),
    effects: new Container({ label: 'effects' }),
    overlay: new Container({ label: 'overlay' }),
  };
}

/** Nothing to point out: for the look that is leaving, whose overlay must not linger. */
const NO_GHOST: Ghost = {
  tile: null,
  cells: [],
  valid: false,
  footprint: null,
  selectable: [],
  unsealed: [],
  aiming: false,
};

/** Which looks are on screen this frame, and where the line between them is. */
export interface LookFrame {
  /** The look below the banner, which is leaving. */
  from: Look;
  /** The look above it, which is arriving — the only one outside a banner. */
  to: Look;
  /** The banner's centre in screen pixels, or null when no wipe is under way. */
  lineY: number | null;
}

/**
 * The scene owns everything that does not depend on how the game looks: the Pixi
 * application, the layer stacks, the camera fit, and the mapping from screen to tile.
 * Painting is delegated entirely to the themes.
 *
 * There are two looks, one for building and one for combat (see `transition.ts`), and
 * both themes stay alive for the whole match, each in its own layer stack: the pixel
 * style empties its layers with `removeChildren()`, which would take the other style's
 * graphics with it if they shared. Outside a banner only the current look is visible
 * and drawn; the other is marked stale on every change and redrawn in full as a wipe
 * reveals it, so keeping two costs nothing between banners. The same style for both
 * looks is one slot, and a wipe then changes nothing.
 */
export class Scene {
  readonly app = new Application();

  private slots!: Record<Look, Slot>;
  private art: ArtConfig = defaultArtConfig;
  private view: ViewTransform = {
    tile: 8,
    originX: 0,
    originY: 0,
    width: 0,
    height: 0,
    top: 0,
  };
  private shown: LookFrame = { from: 'build', to: 'build', lineY: null };
  /** The looks being prepared for their next banners, and whether each is ready. */
  private pending: Partial<Record<Look, { slot: Slot; ready: boolean }>> = {};
  /** Counts changes of looks from the pause menu, which a preparation under way gives way to. */
  private generation = 0;
  /**
   * Whether the scene has been taken down. A look made in the background over frames
   * (`prepare`) outlives the frame loop: with Random looks it can still be going when a match
   * ends, and one going on into the destroyed renderer was the error a tournament's last
   * Continue met (ARCHIVE 12zo).
   */
  private destroyed = false;

  /**
   * Both looks' roots, under the camera (`camera.ts`): scaled and moved together as it
   * zooms. The wipe's masks stay on the stage outside it, since the banner's line is in
   * screen space whatever the camera does.
   */
  private readonly cameraRoot = new Container();
  /** The camera as applied: zoom, and the screen offset of the board under it. */
  private camera = { zoom: 1, x: 0, y: 0 };

  /** The last board drawn, so a stale look can be brought up to date as it is revealed. */
  private board: {
    state: MatchState | null;
    territory: Record<Look, Uint8Array> | null;
    structures: MatchState | null;
  } = { state: null, territory: null, structures: null };

  /** `art` is the shared art, for what no look restyles: the shake. */
  async init(
    canvas: HTMLCanvasElement,
    looks: Record<Look, SceneLook>,
    art: ArtConfig = defaultArtConfig,
  ): Promise<void> {
    this.art = art;
    await this.app.init({
      canvas,
      // Under the looks' own backdrops, and only ever seen before the first is drawn.
      background: hex(looks.build.art.palette.waterMid),
      antialias: false,
      resolution: Math.min(2, globalThis.devicePixelRatio || 1),
      autoDensity: true,
      width: globalThis.innerWidth,
      height: globalThis.innerHeight,
    });
    this.app.ticker.autoStart = false;
    this.app.ticker.stop();
    this.app.stage.addChild(this.cameraRoot);

    const build = await this.slotFor(looks.build);
    const combat = looks.combat === looks.build ? build : await this.slotFor(looks.combat);
    this.slots = { build, combat };
    this.applyVisibility();
  }

  /**
   * Changes the looks mid-match, from the pause menu (ARCHIVE 12b): the old themes are
   * thrown away and the new ones drawn from the board as it last stood, so nothing is lost
   * but what was in flight in the old ones' effects.
   */
  async replaceLooks(looks: Record<Look, SceneLook>): Promise<void> {
    // The new looks are made before the old go, since frames go on being drawn while
    // they are. A look being prepared is for the old ones' rotation, and goes with them.
    if (this.destroyed) return;
    const generation = ++this.generation;
    const build = await this.slotFor(looks.build);
    const combat = looks.combat === looks.build ? build : await this.slotFor(looks.combat);
    if (generation !== this.generation) {
      if (!this.destroyed) for (const slot of new Set([build, combat])) this.drop(slot);
      return;
    }
    const old = this.all();
    this.pending = {};
    this.slots = { build, combat };
    for (const slot of old) this.drop(slot);
    for (const slot of this.all()) {
      this.paintBackdrop(slot);
      this.refresh(slot);
    }
    this.applyVisibility();
    this.warmUp();
  }

  /**
   * Throws a look away, and what Pixi kept of it for reuse. Its pools of batches hold their
   * last batcher's buffers until reused, several megabytes each, and a look's drawing is
   * far larger than the next one's reuse: they grew about 45 MB a pass through the styles
   * until emptied (PLAN 11.23). Only free items go, so whatever is still drawing keeps its.
   */
  private drop(slot: Slot): void {
    slot.theme.destroy();
    release(slot.root);
    slot.mask.destroy();
    BigPool.clear();
  }

  /**
   * Makes the look `look` takes at its next banner (PLAN 11.23), hidden, over frames where
   * `gradual` — the theme, each layer of the board, then a first render of each thing in
   * them, a frame's share at a time (`pacer`) — since a look made in one frame is 75 to
   * 295 ms at eight players. It goes on screen once the look it replaces is out of sight
   * (`showLooks`); until then the old one is shown again, so a look not ready in time
   * costs only the change.
   */
  async prepare(look: Look, next: SceneLook, gradual = true): Promise<void> {
    // A match's next looks are made one after another, and the second can be asked for
    // after the first has seen the scene go (a guest's screen, a tournament's next match).
    if (this.destroyed) return;
    const generation = this.generation;
    const pace = gradual ? pacer() : undefined;
    const slot = await this.slotFor(next, pace);
    if (generation !== this.generation) {
      if (!this.destroyed) this.drop(slot);
      return;
    }
    const replaced = this.pending[look];
    // Kept up to date from now on, as every slot is: a change marks a layer stale.
    this.pending[look] = { slot, ready: false };
    if (replaced !== undefined) this.drop(replaced.slot);
    this.paintBackdrop(slot);
    // Whether it is still wanted: a change of looks, or a newer preparation, drops it.
    const wanted = async (): Promise<boolean> => {
      await pace?.();
      return generation === this.generation && this.pending[look]?.slot === slot;
    };
    // A layer a frame's share at a time, islands left for the next frame once it is spent:
    // a whole layer at once overran its share by up to 80 ms (ARCHIVE 12zm).
    for (const layer of BOARD_LAYERS) {
      do {
        if (!(await wanted())) return;
      } while (!this.refresh(slot, layer, SHARE_MS));
    }
    // Then its first render, an island's drawing at a time, as against a whole layer of
    // every island's, up to 56 ms.
    for (const chain of this.warmChains(slot)) {
      if (!(await wanted())) return;
      this.warmChain(slot, chain);
    }
    const entry = this.pending[look];
    if (entry?.slot === slot) entry.ready = true;
  }

  /** Puts a prepared look in place of one out of sight, and throws the old away. */
  private promote(): void {
    for (const look of ['build', 'combat'] as const) {
      const entry = this.pending[look];
      if (entry === undefined || !entry.ready) continue;
      const old = this.slots[look];
      if (this.isVisible(old)) continue;
      delete this.pending[look];
      this.slots = { ...this.slots, [look]: entry.slot };
      const other = look === 'build' ? 'combat' : 'build';
      if (this.slots[other] !== old) this.drop(old);
    }
  }

  private async slotFor({ theme, art }: SceneLook, pace?: Pace): Promise<Slot> {
    const layers = newLayers();
    const root = new Container();
    const backdrop = new Graphics();
    root.addChild(
      backdrop,
      layers.terrain,
      layers.territory,
      layers.structures,
      layers.effects,
      layers.overlay,
    );
    // Out of sight until shown: a look prepared over frames is on the stage meanwhile.
    root.visible = false;
    const mask = new Graphics();
    // Masks live on the stage, so the shake moves them with the board, but outside the
    // camera, whose zoom must not move the banner's line.
    // Not into a scene taken down while a look was being made: its stage is gone. The caller
    // finds its generation over and lets the look go.
    if (!this.destroyed) {
      this.cameraRoot.addChild(root);
      this.app.stage.addChild(mask);
    }
    await theme.init(layers, art, pace);
    // A new look has drawn nothing yet.
    return {
      theme,
      art,
      root,
      backdrop,
      layers,
      mask,
      stale: new Set(BOARD_LAYERS),
      warming: [],
      effectsPrimed: false,
    };
  }

  /** The styles in use, one per look. */
  get styles(): Record<Look, ArtStyle> {
    return { build: this.slots.build.theme.id, combat: this.slots.combat.theme.id };
  }

  /** The distinct slots currently on screen. */
  private visible(): Slot[] {
    const to = this.slots[this.shown.to];
    const from = this.slots[this.shown.from];
    return this.shown.lineY === null || from === to ? [to] : [to, from];
  }

  private isVisible(slot: Slot): boolean {
    return this.visible().includes(slot);
  }

  /** Every distinct slot, whether shown or not, and any being prepared. */
  private all(): Slot[] {
    const slots = new Set([this.slots.build, this.slots.combat]);
    for (const entry of Object.values(this.pending)) slots.add(entry.slot);
    return [...slots];
  }

  /**
   * Chooses what is on screen: one look, or two split at the banner's line — the
   * arriving look above it, the leaving one below. A look coming into view after
   * changes it missed is redrawn first.
   */
  showLooks(frame: LookFrame): void {
    this.shown = frame;
    this.promote();
    for (const slot of this.visible()) {
      if (slot.stale.size > 0) this.refresh(slot);
    }
    this.applyVisibility();
  }

  private applyVisibility(): void {
    const visible = this.visible();
    const split = visible.length > 1 ? this.shown.lineY : null;
    // In CSS pixels, as everything on the stage is. Pixi v8's `renderer.width` already is:
    // dividing it by the resolution, as once here, left the masks covering half the window
    // on a high-density screen, so neither look was drawn beyond them until the wipe ended.
    const { width, height } = this.app.screen;
    for (const slot of this.all()) {
      slot.root.visible = visible.includes(slot);
      slot.mask.clear();
      if (split === null || !slot.root.visible) {
        slot.root.mask = null;
        continue;
      }
      // Generous margins either side, so the shake never shows an edge.
      const line = Math.max(-64, Math.min(height + 64, split));
      if (slot === this.slots[this.shown.to]) slot.mask.rect(-64, -64, width + 128, line + 64);
      else slot.mask.rect(-64, line, width + 128, height + 64 - line);
      slot.mask.fill({ color: 0xffffff });
      slot.root.mask = slot.mask;
    }
  }

  /**
   * Brings a look up to date with the last board drawn: every layer, or one. Given `budgetMs`,
   * islands are drawn only until it is spent (`withDrawBudget`), and a layer with islands
   * left stays stale for the next call to finish. False only when the budget cut one short.
   */
  private refresh(slot: Slot, only?: BoardLayer, budgetMs?: number): boolean {
    const { state, territory, structures } = this.board;
    const due = (layer: BoardLayer): boolean =>
      slot.stale.has(layer) && (only === undefined || only === layer);
    // Only a layer the budget cut short is unfinished: one with no board to draw yet stays
    // stale for whenever there is one, as ever, and must not hold a caller in a loop.
    let finished = true;
    const draw = (layer: BoardLayer, paint: () => void): void => {
      const done = budgetMs === undefined ? (paint(), true) : withDrawBudget(budgetMs, paint);
      if (done) slot.stale.delete(layer);
      else finished = false;
    };
    if (state !== null && due('terrain')) {
      draw('terrain', () => slot.theme.drawTerrain(state, this.view));
    }
    if (state !== null && territory !== null && due('territory')) {
      draw('territory', () =>
        slot.theme.drawTerritory({ ...state, territory: territory[this.lookOf(slot)] }, this.view),
      );
    }
    if (structures !== null && due('structures')) {
      draw('structures', () => slot.theme.drawStructures(structures, this.view));
    }
    return finished;
  }

  /**
   * Readies the look the next banner brings while it is still hidden, in the pause before
   * the banner (ARCHIVE 12zm): its stale layers drawn and its new drawing rendered offscreen
   * once, a frame's share at a time, so the frame the line first reveals it has nothing
   * left to do. That frame redrew every stale layer at once and cut it all into triangles:
   * 33 to 50 ms with chosen looks, 83 to 100 with Random. A board changing again after
   * this is drawn again as the look comes into view, as before.
   */
  prime(look: Look): void {
    const slot = this.slots[look];
    if (this.isVisible(slot)) return;
    const until = performance.now() + PRIME_MS;
    for (const layer of BOARD_LAYERS) {
      if (!slot.stale.has(layer)) continue;
      const left = until - performance.now();
      if (left <= 0 || !this.refresh(slot, layer, left)) return;
      slot.warming.push(...this.warmChains(slot, layer));
    }
    while (slot.warming.length > 0 && performance.now() < until) {
      this.warmChain(slot, slot.warming.shift() as Container[]);
    }
    // Last, its effects, once: a new look's first frame of them makes its stamps and
    // pools, 16 ms of the frame the line first reveals it. Drawn with no time passing, so
    // nothing in them moves or ages unseen.
    const last = this.lastEffects;
    if (slot.warming.length > 0 || slot.effectsPrimed || last === null) return;
    if (performance.now() >= until) return;
    slot.effectsPrimed = true;
    slot.theme.drawEffects(last.state, this.view, {
      tickFraction: last.tickFraction,
      deltaMs: 0,
      castleSealed: last.castleSealed[look],
      sealGlow: [],
      humanPlayer: last.humanPlayer,
      celebrate: [],
      choices: [],
      drain: [],
    });
    this.warmChain(slot, [slot.layers.effects]);
  }

  /**
   * The look a slot draws. One slot drawing both looks is handed the same board for
   * each, so either answer serves it.
   */
  private lookOf(slot: Slot): Look {
    if (slot === this.pending.combat?.slot) return 'combat';
    if (slot === this.pending.build?.slot) return 'build';
    return slot === this.slots.combat && slot !== this.slots.build ? 'combat' : 'build';
  }

  /** Draws a layer on the looks on screen and marks it stale in the rest. */
  private paint(layer: BoardLayer, draw: (slot: Slot) => void): void {
    for (const slot of this.all()) {
      if (this.isVisible(slot)) draw(slot);
      else slot.stale.add(layer);
    }
  }

  /** Recomputes the fit of the grid into the canvas. */
  /**
   * Fits the board to the window below `topInset` pixels, which the HUD bar occupies.
   * Centred in the whole window instead, the top island's first rows sat under the bar
   * whenever the window was the height that limited the tile size.
   */
  resize(state: MatchState, width: number, height: number, topInset = 0): void {
    this.app.renderer.resize(width, height);
    const usable = Math.max(1, height - topInset);
    const tile = Math.max(1, Math.floor(Math.min(width / state.width, usable / state.height)));
    this.view = {
      tile,
      originX: Math.floor((width - tile * state.width) / 2),
      originY: topInset + Math.floor((usable - tile * state.height) / 2),
      width,
      height,
      top: topInset,
    };
    for (const slot of this.all()) this.paintBackdrop(slot);
    this.applyVisibility();
  }

  /** A look's own sea behind the board, past the edges by the shake's reach. */
  private paintBackdrop(slot: Slot): void {
    const margin = this.art.generators.fx.shakePx;
    slot.backdrop.clear();
    slot.backdrop.rect(
      -margin,
      -margin,
      this.view.width + 2 * margin,
      this.view.height + 2 * margin,
    );
    slot.backdrop.fill({ color: hex(slot.art.palette.waterMid) });
  }

  /**
   * Points the camera: a shot from `camera.ts`, or null for the whole map. The focus is
   * kept far enough in that the zoomed view never runs past the edges of the fitted
   * window, where there is nothing drawn.
   */
  setCamera(state: MatchState, shot: CameraShot | null): void {
    if (shot === null || shot.zoom <= 1) {
      this.camera = { zoom: 1, x: 0, y: 0 };
    } else {
      const { tile, originX, originY, width, height } = this.view;
      const z = shot.zoom;
      // The focus on screen as the whole map shows it, and where it is to be put: the
      // board's middle, or where it already stands.
      const fx = originX + shot.focusX * tile;
      const fy = originY + shot.focusY * tile;
      const tx = shot.inPlace === true ? fx : originX + (tile * state.width) / 2;
      const ty = shot.inPlace === true ? fy : originY + (tile * state.height) / 2;
      // Offsets that keep the zoomed view inside the fitted window, where there is board.
      const clamp = (offset: number, size: number): number =>
        Math.min(0, Math.max(size * (1 - z), offset));
      this.camera = { zoom: z, x: clamp(tx - fx * z, width), y: clamp(ty - fy * z, height) };
    }
    this.cameraRoot.scale.set(this.camera.zoom);
    this.cameraRoot.position.set(this.camera.x, this.camera.y);
  }

  /** Centre of a tile in screen pixels, for anything drawn over the board in HTML. */
  screenAt(x: number, y: number): { x: number; y: number } {
    const { zoom, x: cx, y: cy } = this.camera;
    return {
      x: cx + (this.view.originX + (x + 0.5) * this.view.tile) * zoom,
      y: cy + (this.view.originY + (y + 0.5) * this.view.tile) * zoom,
    };
  }

  /** Screen coordinates to tile, through the camera, or null when outside the grid. */
  tileAt(state: MatchState, screenX: number, screenY: number): { x: number; y: number } | null {
    const { zoom, x: cx, y: cy } = this.camera;
    const x = Math.floor(((screenX - cx) / zoom - this.view.originX) / this.view.tile);
    const y = Math.floor(((screenY - cy) / zoom - this.view.originY) / this.view.tile);
    if (x < 0 || y < 0 || x >= state.width || y >= state.height) return null;
    return { x, y };
  }

  drawTerrain(state: MatchState): void {
    this.board.state = state;
    this.paint('terrain', (slot) => slot.theme.drawTerrain(state, this.view));
  }

  /**
   * Territory, one board per look: the build look's as the board stands, the combat
   * look's as combat began (`holdsCombatEnclosure`). Not the sim's own, which is
   * refreshed at placements and resolutions but not when shots land: drawn from state,
   * a castle breached in combat stayed shaded into the build phase until somebody built,
   * which read as the sea being taken for wall. Display only.
   */
  drawTerritory(state: MatchState, territory: Record<Look, Uint8Array>): void {
    this.board.state = state;
    this.board.territory = territory;
    this.paint('territory', (slot) =>
      slot.theme.drawTerritory({ ...state, territory: territory[this.lookOf(slot)] }, this.view),
    );
  }

  /**
   * Walls, castles and cannons. The state may carry a display board rather than the
   * sim's own — swept walls the banner has not reached yet — so it is kept whole.
   */
  drawStructures(state: MatchState): void {
    this.board.structures = state;
    this.paint('structures', (slot) => slot.theme.drawStructures(state, this.view));
  }

  drawEffects(
    state: MatchState,
    tickFraction: number,
    deltaMs: number,
    castleSealed: Record<Look, readonly boolean[]>,
    sealGlow: readonly SealGlow[] = [],
    humanPlayer = -1,
    celebrate: readonly Celebration[] = [],
    choices: readonly Choice[] = [],
    drain: readonly DrainWash[] = [],
  ): void {
    this.applyShake(deltaMs);
    this.lastEffects = {
      state,
      tickFraction,
      castleSealed,
      sealGlow,
      humanPlayer,
      celebrate,
      choices,
      drain,
    };
    for (const slot of this.visible()) {
      slot.theme.drawEffects(state, this.view, {
        tickFraction,
        deltaMs,
        castleSealed: castleSealed[this.lookOf(slot)],
        sealGlow,
        humanPlayer,
        celebrate,
        choices,
        drain: this.lookOf(slot) === 'build' ? drain : [],
      });
    }
  }

  /** What the last frame's effects were drawn from, for a look primed before it is seen. */
  private lastEffects: {
    state: MatchState;
    tickFraction: number;
    castleSealed: Record<Look, readonly boolean[]>;
    sealGlow: readonly SealGlow[];
    humanPlayer: number;
    celebrate: readonly Celebration[];
    choices: readonly Choice[];
    drain: readonly DrainWash[];
  } | null = null;

  /** Remaining shake, in milliseconds. */
  private shaking = 0;

  /** Shakes the board, for a hit on the player's own wall. */
  shake(): void {
    this.shaking = this.art.generators.fx.shakeMs;
  }

  private applyShake(deltaMs: number): void {
    this.shaking = Math.max(0, this.shaking - deltaMs);
    const amount = (this.shaking / this.art.generators.fx.shakeMs) * this.art.generators.fx.shakePx;
    // Whole pixels: the pixel style is drawn on the pixel grid, and a fractional offset
    // blurs every sprite on the board for the length of the shake.
    this.app.stage.x = Math.round((Math.random() * 2 - 1) * amount);
    this.app.stage.y = Math.round((Math.random() * 2 - 1) * amount);
  }

  /**
   * The overlay belongs to the arriving look, so the aiming cursor that appears with
   * "Fire!" is already the combat one; the leaving look's is cleared.
   */
  drawOverlay(state: MatchState, ghost: Ghost, humanPlayer: number): void {
    const to = this.slots[this.shown.to];
    for (const slot of this.visible()) {
      slot.theme.drawOverlay(state, this.view, slot === to ? ghost : NO_GHOST, humanPlayer);
    }
  }

  /** Where a screen height falls on the board, in fractional tile rows. */
  rowAt(screenY: number): number {
    return ((screenY - this.camera.y) / this.camera.zoom - this.view.originY) / this.view.tile;
  }

  /**
   * On the looks on screen only: a hidden style never ages its effects, and a blast
   * noted there would all go off at once when it next came into view.
   */
  noteImpact(x: number, y: number, debris: readonly Debris[]): void {
    for (const slot of this.visible()) slot.theme.noteImpact(x, y, debris);
  }

  /** On every look, since it only turns a barrel, which should stay true while hidden. */
  noteShot(shot: Shot): void {
    for (const slot of this.all()) slot.theme.noteShot(shot);
  }

  /** On the looks on screen, for the same reason as impacts. */
  noteLanding(cells: readonly Cell[], owner: number): void {
    for (const slot of this.visible()) slot.theme.noteLanding(cells, owner);
  }

  /** In the arriving look: a block goes as the banner reaches it, so above the line. */
  noteCrumble(block: Debris): void {
    this.slots[this.shown.to].theme.noteCrumble(block);
  }

  render(): void {
    this.app.renderer.render(this.app.stage);
  }

  /**
   * Draws the hidden look once, offscreen, so its first wipe costs no more than any
   * other: a look's first render cuts all of its drawing into triangles and uploads its
   * textures, 100 to 180 ms at eight players (Cyberpunk, Medieval, Opera), which fell on
   * the frame "Fire!" first brought it in. Into a small texture of its own rather than
   * the canvas, which would show both looks at once for a frame; the stage rather than
   * the look's root, since rendering a container makes it a render group for good.
   */
  warmUp(): void {
    const hidden = this.all().filter((slot) => !this.isVisible(slot));
    if (hidden.length === 0) return;
    for (const slot of hidden) {
      if (slot.stale.size > 0) this.refresh(slot);
      slot.root.visible = true;
    }
    this.renderOffscreen();
    this.applyVisibility();
  }

  /**
   * What of a look's board to render offscreen, a piece at a time: each part of each board
   * layer, and of a part that is a plain container of others — an `IslandParts` layer —
   * each of those, one island's drawing. The whole look at once was 35 to 135 ms; a whole
   * part, every island's drawing of it, up to 56 ms (ARCHIVE 12zm).
   */
  private warmChains(slot: Slot, only?: BoardLayer): Container[][] {
    const layers = only === undefined ? BOARD_LAYERS : [only];
    return layers.flatMap((name) => {
      const layer = slot.layers[name];
      return layer.children.flatMap((part) =>
        part.constructor === Container && part.children.length > 1
          ? part.children.map((piece) => [layer, part, piece])
          : [[layer, part]],
      );
    });
  }

  /**
   * One piece of a look rendered offscreen alone, every other thing on the stage hidden for
   * it, so its first render is spread over frames as its drawing is. A piece no longer where
   * it was — drawn again since — is passed over.
   */
  private warmChain(slot: Slot, chain: readonly Container[]): void {
    for (let i = 1; i < chain.length; i++) {
      if (chain[i]?.parent !== chain[i - 1]) return;
    }
    if (chain[0]?.parent !== slot.root) return;
    const hidden: [Container, boolean][] = [];
    const only = (siblings: readonly Container[], keep: Container | undefined): void => {
      for (const child of siblings) {
        hidden.push([child, child.visible]);
        child.visible = child === keep;
      }
    };
    only(
      this.all().map((s) => s.root),
      slot.root,
    );
    only(slot.root.children, chain[0]);
    for (let i = 1; i < chain.length; i++) only((chain[i - 1] as Container).children, chain[i]);
    this.renderOffscreen();
    for (const [child, visible] of hidden.reverse()) child.visible = visible;
    this.applyVisibility();
  }

  private renderOffscreen(): void {
    if (this.destroyed) return;
    const target = RenderTexture.create({ width: 64, height: 64 });
    this.app.renderer.render({ container: this.app.stage, target });
    target.destroy(true);
  }

  /**
   * Takes the scene down: anything still making a look in the background stops at its next
   * step, since the generation it was made for is gone, and then the application goes.
   */
  destroy(): void {
    this.destroyed = true;
    this.generation++;
    this.pending = {};
    this.app.destroy(true);
  }
}
