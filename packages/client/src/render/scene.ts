import { defaultArtConfig, type ArtConfig, type ArtStyle } from '@bollwerk/config';
import type { MatchState, Shot } from '@bollwerk/sim';
import { Application, Container, Graphics } from 'pixi.js';

import type { CameraShot } from '../camera.js';
import type { DrainWash, SealGlow } from '../seal.js';
import type { Look } from '../transition.js';

import { BlueprintTheme } from './blueprint.js';
import { BricksTheme } from './bricks.js';
import { ChocolateTheme } from './chocolate.js';
import { HalloweenTheme } from './halloween.js';
import { OktoberfestTheme } from './oktoberfest.js';
import { OperaTheme } from './opera.js';
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
  /** Something changed while it was hidden, so it must be redrawn before it is shown. */
  stale: boolean;
}

function newLayers(): ThemeLayers {
  return {
    terrain: new Container(),
    territory: new Container(),
    structures: new Container(),
    effects: new Container(),
    overlay: new Container(),
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
    // they are.
    const old = this.all();
    const build = await this.slotFor(looks.build);
    const combat = looks.combat === looks.build ? build : await this.slotFor(looks.combat);
    this.slots = { build, combat };
    for (const slot of old) {
      slot.theme.destroy();
      slot.root.destroy({ children: true });
      slot.mask.destroy();
    }
    for (const slot of this.all()) {
      this.paintBackdrop(slot);
      this.refresh(slot);
    }
    this.applyVisibility();
  }

  private async slotFor({ theme, art }: SceneLook): Promise<Slot> {
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
    const mask = new Graphics();
    // Masks live on the stage, so the shake moves them with the board, but outside the
    // camera, whose zoom must not move the banner's line.
    this.cameraRoot.addChild(root);
    this.app.stage.addChild(mask);
    await theme.init(layers, art);
    return { theme, art, root, backdrop, layers, mask, stale: false };
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

  /** Every distinct slot, whether shown or not. */
  private all(): Slot[] {
    return this.slots.build === this.slots.combat
      ? [this.slots.build]
      : [this.slots.build, this.slots.combat];
  }

  /**
   * Chooses what is on screen: one look, or two split at the banner's line — the
   * arriving look above it, the leaving one below. A look coming into view after
   * changes it missed is redrawn first.
   */
  showLooks(frame: LookFrame): void {
    this.shown = frame;
    for (const slot of this.visible()) {
      if (slot.stale) this.refresh(slot);
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

  /** Brings a look up to date with the last board drawn. */
  private refresh(slot: Slot): void {
    const { state, territory, structures } = this.board;
    if (state !== null) slot.theme.drawTerrain(state, this.view);
    if (state !== null && territory !== null)
      slot.theme.drawTerritory({ ...state, territory: territory[this.lookOf(slot)] }, this.view);
    if (structures !== null) slot.theme.drawStructures(structures, this.view);
    slot.stale = false;
  }

  /**
   * The look a slot draws. One slot drawing both looks is handed the same board for
   * each, so either answer serves it.
   */
  private lookOf(slot: Slot): Look {
    return slot === this.slots.combat && slot !== this.slots.build ? 'combat' : 'build';
  }

  /** Draws on the looks on screen and marks the rest stale. */
  private paint(draw: (slot: Slot) => void): void {
    for (const slot of this.all()) {
      if (this.isVisible(slot)) draw(slot);
      else slot.stale = true;
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
    this.paint((slot) => slot.theme.drawTerrain(state, this.view));
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
    this.paint((slot) =>
      slot.theme.drawTerritory({ ...state, territory: territory[this.lookOf(slot)] }, this.view),
    );
  }

  /**
   * Walls, castles and cannons. The state may carry a display board rather than the
   * sim's own — swept walls the banner has not reached yet — so it is kept whole.
   */
  drawStructures(state: MatchState): void {
    this.board.structures = state;
    this.paint((slot) => slot.theme.drawStructures(state, this.view));
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
}
