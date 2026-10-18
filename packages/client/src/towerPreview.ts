import {
  artForStyle,
  defaultArtConfig,
  variantCost,
  variantKind,
  type ArtStyle,
  type TowerVariant,
} from '@bollwerk/config';
import { computeEnclosure, craterTilesOf, type MatchEvent } from '@bollwerk/sim';

import { LookRotation } from './looks.js';
import { motionReduced } from './motion.js';
import { preferredStyles } from './prefs.js';
import { createTheme, Scene } from './render/scene.js';
import { hasBlast } from './render/towerMarks.js';
import { TowerShow } from './towerShow.js';

/**
 * The tower menu's preview (the user's, 2026-10-16): the chosen variant's `TowerShow` drawn
 * by a real `Scene` in the player's combat look — a style drawn from their favourites, or from
 * every style, where the combat look is Random — so the shot, the blast, the barrels and the
 * walls coming back are the game's own. One renderer while the menu is open, its show swapped
 * as the choice changes. Under reduced motion a still of the show's key moment instead: the
 * blast landed, or the walls rebuilt.
 */

/** Sixteen pixels a tile, the pixel style's own, for the show's 28 by 10 tiles. */
export const TOWER_PREVIEW_SIZE = { width: 448, height: 160 } as const;

export class TowerPreview {
  readonly canvas = document.createElement('canvas');
  private scene: Scene | null = null;
  private show: TowerShow | null = null;
  private readonly style: ArtStyle = new LookRotation(preferredStyles()).next('combat');
  private busy: Promise<void> = Promise.resolve();
  private frame = 0;
  private last = 0;
  private closed = false;
  private sealed: readonly boolean[] = [];

  constructor() {
    this.canvas.className = 'tower-preview';
  }

  /** Plays this variant's show, or an ordinary cannon's for none. */
  play(variant: TowerVariant | null): void {
    if (this.closed) return;
    this.busy = this.busy.then(() => this.start(variant)).catch(() => undefined);
  }

  destroy(): void {
    this.closed = true;
    cancelAnimationFrame(this.frame);
    this.busy = this.busy.then(() => {
      // Not `destroy(true)`, which releases what every renderer on the page shares (ARCHIVE 12b).
      this.scene?.app.destroy({ removeView: true });
      this.scene = null;
    });
  }

  private async start(variant: TowerVariant | null): Promise<void> {
    if (this.closed) return;
    cancelAnimationFrame(this.frame);
    const show = new TowerShow(variant);
    this.show = show;
    const state = show.state;
    if (this.scene === null) {
      const look = {
        theme: createTheme(this.style, state.seed),
        art: artForStyle(defaultArtConfig, this.style),
      };
      const scene = new Scene();
      await scene.init(this.canvas, { build: look, combat: look }, defaultArtConfig);
      if (this.closed) {
        scene.app.destroy({ removeView: true });
        return;
      }
      scene.showReachAlways();
      scene.resize(state, TOWER_PREVIEW_SIZE.width, TOWER_PREVIEW_SIZE.height);
      scene.showLooks({ from: 'combat', to: 'combat', lineY: null });
      scene.drawTerrain(state);
      this.scene = scene;
    }
    const scene = this.scene;
    const enclosure = computeEnclosure(state);
    this.sealed = [...enclosure.castleEnclosed];
    scene.drawTerritory(state, { build: enclosure.territory, combat: enclosure.territory });
    scene.drawStructures(state);
    // A few long frames first, so the flags are up and what settles has settled.
    for (let k = 0; k < 12; k++) this.drawFrame(250, false);
    if (motionReduced()) {
      this.still(show);
      return;
    }
    this.last = performance.now();
    const step = (now: number): void => {
      if (this.show !== show || this.closed) return;
      const delta = Math.min(100, now - this.last);
      this.last = now;
      const frame = show.advance(delta);
      this.apply(frame.events, frame.reset);
      this.drawFrame(delta, true);
      this.frame = requestAnimationFrame(step);
    };
    this.frame = requestAnimationFrame(step);
  }

  /** Reduced motion: the show played on unseen to its key moment, and that one frame drawn. */
  private still(show: TowerShow): void {
    for (let ms = 0; ms < 15_000; ms += 50) {
      const { events } = show.advance(50);
      this.apply(events, false);
      if (
        events.some(
          (e) =>
            e.kind === 'walls_repaired' ||
            e.kind === 'shot_impact' ||
            e.kind === 'lightning_struck',
        )
      ) {
        if (show.state.shots.length === 0) break;
      }
    }
    this.drawFrame(250, true);
  }

  /** The show's events as a match would take them: shots, blasts, rebuilt walls. */
  private apply(events: readonly MatchEvent[], reset: boolean): void {
    const scene = this.scene;
    const state = this.show?.state;
    if (scene === null || state === undefined) return;
    let changed = reset;
    for (const event of events) {
      switch (event.kind) {
        case 'shot_fired':
          if (event.shot.kind !== 'lightning') scene.noteShot(event.shot);
          break;
        case 'lightning_struck': {
          scene.noteLightning(event.fromX, event.fromY, event.path, event.owner);
          for (const i of event.destroyed) {
            const at = { x: i % state.width, y: Math.floor(i / state.width) };
            scene.noteImpact(at.x, at.y, [{ ...at, owner: (state.islandId[i] as number) - 1 }]);
          }
          changed ||= event.destroyed.length > 0;
          break;
        }
        case 'shot_impact': {
          const debris = event.destroyed.map((i) => ({
            x: i % state.width,
            y: Math.floor(i / state.width),
            owner: (state.islandId[i] as number) - 1,
          }));
          scene.noteImpact(event.x, event.y, debris);
          // In either Bertha's show every shot is hers.
          const variant = this.show?.variant ?? null;
          if (variant !== null && hasBlast(variantKind(variant))) {
            const crater = craterTilesOf(state.ruleset, variantKind(variant), variantCost(variant));
            scene.noteBlast(event.x, event.y, crater);
          }
          changed ||= event.destroyed.length > 0;
          break;
        }
        case 'walls_repaired':
          scene.noteRepair(event.tiles, state.width, event.player);
          changed = true;
          break;
        default:
          break;
      }
    }
    if (changed) scene.drawStructures(state);
  }

  private drawFrame(deltaMs: number, render: boolean): void {
    const scene = this.scene;
    const state = this.show?.state;
    if (scene === null || state === undefined) return;
    // Sealed as the show began: a breach in combat leaves the flags flying, as in a match.
    const sealed = this.sealed;
    scene.drawEffects(state, 0, deltaMs, { build: sealed, combat: sealed }, [], 0);
    if (render) scene.render();
  }
}
