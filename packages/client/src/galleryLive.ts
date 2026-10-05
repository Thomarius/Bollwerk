import { artForStyle, defaultArtConfig, type ArtStyle } from '@bollwerk/config';
import { computeEnclosure, Structure, type MatchState, type Shot } from '@bollwerk/sim';

import { motionReduced } from './motion.js';
import { createTheme, Scene, type SceneLook } from './render/scene.js';
import { PREVIEW_SIZE, previewState } from './stylePreview.js';

/**
 * The gallery's pictures, alive under the pointer (2026-10-05): while a card is hovered,
 * its still picture gives way to the style itself running on the same island — the sea
 * moving, the flags flying, and every so often a shot from the gun, at the wall and then
 * into the sea, so each style's hit and splash are seen. One renderer for the whole
 * gallery, its style swapped as the pointer moves (`Scene.replaceLooks`), and drawing only
 * while a card is hovered; none of it under reduced motion, where the stills stay.
 */

/** Between one shot landing and the next being fired. */
const PAUSE_MS = 700;
/** How long a shot flies, in ticks of the preview's own clock. */
const FLIGHT_TICKS = 24;

/** The `n`th shot of the loop: from the first gun, at the wall and the sea by turns. */
export function liveShot(state: MatchState, n: number, launchTick: number): Shot | null {
  const cannon = state.cannons[0];
  if (cannon === undefined) return null;
  const target = n % 2 === 0 ? wallTarget(state) : seaTarget(state);
  if (target === null) return null;
  return {
    id: n + 1,
    cannonId: cannon.id,
    owner: cannon.owner,
    fromX: cannon.x + (cannon.w - 1) / 2,
    fromY: cannon.y + (cannon.h - 1) / 2,
    toX: target.x,
    toY: target.y,
    launchTick,
    impactTick: launchTick + FLIGHT_TICKS,
  };
}

/** The wall block farthest from the first gun, so the shot is a lob worth watching. */
function wallTarget(state: MatchState): { x: number; y: number } | null {
  const cannon = state.cannons[0]!;
  let best: { x: number; y: number } | null = null;
  let far = -1;
  for (let i = 0; i < state.structure.length; i++) {
    if (state.structure[i] !== Structure.Wall) continue;
    const x = i % state.width;
    const y = (i - x) / state.width;
    const d = (x - cannon.x) ** 2 + (y - cannon.y) ** 2;
    if (d > far) {
      far = d;
      best = { x, y };
    }
  }
  return best;
}

/** Open sea in the picture's top-right corner. */
function seaTarget(state: MatchState): { x: number; y: number } | null {
  return { x: state.width - 2, y: 1 };
}

export class LivePreview {
  private readonly canvas = document.createElement('canvas');
  private scene: Scene | null = null;
  private style: ArtStyle | null = null;
  /** The latest asked for: a quick sweep over the cards shows only where it stops. */
  private wanted: { style: ArtStyle; image: HTMLImageElement } | null = null;
  private busy: Promise<void> = Promise.resolve();
  private readonly state = previewState();
  private readonly enclosure = computeEnclosure(this.state);
  private frame = 0;
  private last = 0;
  private ticks = 0;
  private shots = 0;
  private restMs = PAUSE_MS / 2;
  private closed = false;

  constructor() {
    this.canvas.className = 'live';
  }

  /** Plays `style` over its card's picture, in place of it. */
  show(style: ArtStyle, image: HTMLImageElement): void {
    if (motionReduced() || this.closed) return;
    this.wanted = { style, image };
    this.busy = this.busy.then(() => this.apply()).catch(() => undefined);
  }

  /** Back to the still picture. */
  hide(image?: HTMLImageElement): void {
    if (image !== undefined && this.wanted?.image !== image) return;
    this.wanted = null;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.canvas.remove();
  }

  destroy(): void {
    this.closed = true;
    this.hide();
    this.busy = this.busy.then(() => {
      // Not `destroy(true)`, which releases what every renderer on the page shares,
      // a running match's included (ARCHIVE 12b).
      this.scene?.app.destroy({ removeView: true });
      this.scene = null;
    });
  }

  private looks(style: ArtStyle): Record<'build' | 'combat', SceneLook> {
    const look = {
      theme: createTheme(style, this.state.seed),
      art: artForStyle(defaultArtConfig, style),
    };
    return { build: look, combat: look };
  }

  private async apply(): Promise<void> {
    const wanted = this.wanted;
    if (wanted === null || this.closed) return;
    if (this.scene === null) {
      const scene = new Scene();
      await scene.init(this.canvas, this.looks(wanted.style), defaultArtConfig);
      scene.resize(this.state, PREVIEW_SIZE.width, PREVIEW_SIZE.height);
      scene.showLooks({ from: 'build', to: 'build', lineY: null });
      scene.drawTerrain(this.state);
      const territory = this.enclosure.territory;
      scene.drawTerritory(this.state, { build: territory, combat: territory });
      scene.drawStructures(this.state);
      this.scene = scene;
      this.style = wanted.style;
    } else if (this.style !== wanted.style) {
      await this.scene.replaceLooks(this.looks(wanted.style));
      this.style = wanted.style;
    }
    // The pointer may have left, or gone on to another card, while the look was made.
    if (this.wanted !== wanted || this.closed) return;
    this.state.shots = [];
    this.restMs = PAUSE_MS / 2;
    // A few long frames first, so the flags are up and what settles has settled, as in
    // the still it replaces.
    const sealed = this.enclosure.castleEnclosed;
    for (let k = 0; k < 12; k++)
      this.scene.drawEffects(this.state, 0, 250, { build: sealed, combat: sealed });
    this.place(wanted.image);
    this.last = performance.now();
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame((now) => this.step(now));
  }

  /** Over the card's picture exactly, at its size on the page. */
  private place(image: HTMLImageElement): void {
    const style = this.canvas.style;
    style.left = `${image.offsetLeft}px`;
    style.top = `${image.offsetTop}px`;
    style.width = `${image.offsetWidth}px`;
    style.height = `${image.offsetHeight}px`;
    image.parentElement?.append(this.canvas);
  }

  private step(now: number): void {
    const scene = this.scene;
    if (scene === null || this.wanted === null) return;
    const delta = Math.min(100, now - this.last);
    this.last = now;
    const state = this.state;
    this.ticks += (delta * state.ruleset.tickRateHz) / 1000;
    state.tick = Math.floor(this.ticks);
    const fraction = this.ticks - state.tick;
    const shot = state.shots[0];
    if (shot !== undefined && state.tick >= shot.impactTick) {
      state.shots = [];
      const onWall = state.structure[shot.toY * state.width + shot.toX] === Structure.Wall;
      scene.noteImpact(shot.toX, shot.toY, onWall ? [{ x: shot.toX, y: shot.toY, owner: 0 }] : []);
      this.restMs = PAUSE_MS;
    } else if (shot === undefined) {
      this.restMs -= delta;
      if (this.restMs <= 0) {
        const next = liveShot(state, this.shots++, state.tick);
        if (next !== null) {
          state.shots = [next];
          scene.noteShot(next);
        }
      }
    }
    const sealed = this.enclosure.castleEnclosed;
    scene.drawEffects(state, fraction, delta, { build: sealed, combat: sealed });
    scene.render();
    this.frame = requestAnimationFrame((t) => this.step(t));
  }
}
