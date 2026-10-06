import type { ArtConfig } from '@bollwerk/config';
import type { MatchState } from '@bollwerk/sim';
import { Container, Graphics, Text } from 'pixi.js';

import { t } from '../i18n.js';
import { inFinalRound } from '../scores.js';
import type { TimerSpot } from '../timerSpot.js';

import { release } from './release.js';
import { hex, tileX, tileY, type ViewTransform } from './theme.js';

/** How long a new round's title block takes to ink in, and the stamp to land. */
const INK_MS = 1200;
const STAMP_MS = 320;

/** Lettering as a draughtsman's: plain capitals, spaced. */
const FONT = "'Arial Narrow', Arial, Helvetica, sans-serif";

/**
 * Blueprint's piece in the corner (PLAN 11.24): the title block every drawing keeps in its
 * bottom-right corner — the project, BOLLWERK; the sheet, the round of the rounds; the
 * scale, and a north arrow. Inked in anew as each round begins, line by line and then the
 * lettering, and in the final round stamped across in red. The lines are redrawn only while
 * it inks and when anything in them changes; the lettering is text, rastered when its words
 * do — the sheet's number and the language.
 */
export class TitleBlock {
  readonly container = new Container();
  private readonly lines = new Graphics();
  private readonly title = new Text({ text: '' });
  private readonly sheet = new Text({ text: '' });
  private readonly scale = new Text({ text: '1:100' });
  private readonly stamp = new Container();
  private readonly stampFrame = new Graphics();
  private readonly stampText = new Text({ text: '' });
  /** Since the round's ink began, and since the stamp came down, in milliseconds. */
  private inking = INK_MS;
  private stamping = STAMP_MS;
  private round = -1;
  private final = false;
  private key = '';

  constructor() {
    this.stamp.addChild(this.stampFrame, this.stampText);
    this.container.addChild(this.lines, this.title, this.sheet, this.scale, this.stamp);
    for (const text of [this.title, this.sheet, this.scale, this.stampText]) {
      text.anchor.set(0.5);
      text.resolution = 2;
    }
  }

  draw(
    state: MatchState,
    view: ViewTransform,
    spot: TimerSpot,
    art: ArtConfig,
    deltaMs: number,
    still: boolean,
  ): void {
    if (state.round !== this.round) {
      // Inked in as a round begins — but not the board's first, which is drawn whole.
      this.inking = this.round < 0 || still ? INK_MS : 0;
      this.round = state.round;
    }
    const final = inFinalRound(state);
    if (final !== this.final) {
      this.stamping = still || !final ? STAMP_MS : 0;
      this.final = final;
    }
    const step = Math.max(0, deltaMs);
    const inked = Math.min(1, (this.inking += step) / INK_MS);
    const stamped = Math.min(1, (this.stamping += step) / STAMP_MS);

    // Wider than the square it is given, kept to its right edge: lettered small enough to
    // fit the square, it could not be read.
    const s = spot.size * view.tile;
    const w = s * 1.25;
    const h = s * 0.72;
    const x = tileX(view, spot.x) + s * 0.48 - w;
    const y = tileY(view, spot.y) + s * 0.46 - h;
    const ink = hex(art.palette.uiInk);
    const line = Math.max(1, art.blueprint.lineWidthPx);
    const rows = [0.42, 0.72];
    const split = 0.6;

    const key = `${x},${y},${w},${h},${inked}`;
    if (key !== this.key) {
      this.key = key;
      const g = this.lines;
      g.clear();
      // The lines ink in one after another: the frame, its inner rule, the row dividers,
      // the cell's, the north arrow — each from its start to its end.
      const strokes: [number, number, number, number][] = [
        [x, y, x + w, y],
        [x + w, y, x + w, y + h],
        [x + w, y + h, x, y + h],
        [x, y + h, x, y],
        [x, y + h * rows[0]!, x + w, y + h * rows[0]!],
        [x, y + h * rows[1]!, x + w, y + h * rows[1]!],
        [x + w * split, y + h * rows[1]!, x + w * split, y + h],
      ];
      const each = 1 / (strokes.length + 1);
      strokes.forEach(([ax, ay, bx, by], k) => {
        const f = Math.max(0, Math.min(1, (inked - k * each) / each));
        if (f <= 0) return;
        g.moveTo(ax, ay).lineTo(ax + (bx - ax) * f, ay + (by - ay) * f);
      });
      g.stroke({ width: line, color: ink, alpha: 0.9 });
      // The frame doubled inside, finer, as a title block's is.
      if (inked >= 4 * each) {
        const m = Math.max(2, s * 0.025);
        g.rect(x + m, y + m, w - 2 * m, h - 2 * m);
        g.stroke({ width: Math.max(1, line * 0.5), color: ink, alpha: 0.6 });
      }
      // The north arrow in its cell.
      if (inked >= 1 - each) {
        const ax = x + w * (split + (1 - split) / 2);
        const top = y + h * rows[1]! + h * 0.05;
        const bottom = y + h - h * 0.05;
        const half = (bottom - top) * 0.28;
        g.poly([ax, top, ax + half, bottom, ax, bottom - (bottom - top) * 0.3, ax - half, bottom]);
        g.stroke({ width: Math.max(1, line * 0.6), color: ink });
        g.poly([ax, top, ax, bottom - (bottom - top) * 0.3, ax - half, bottom]);
        g.fill({ color: ink, alpha: 0.8 });
      }
    }

    // The lettering, rastered only when its words or its size change.
    const cap = state.ruleset.scoring.maxRounds;
    const round = Math.max(1, state.round);
    const words = {
      title: 'BOLLWERK',
      sheet: cap === null ? t('plan.sheetOpen', { round }) : t('plan.sheet', { round, cap }),
      stamp: t('plan.final'),
    };
    const letter = (
      text: Text,
      words: string,
      size: number,
      cx: number,
      cy: number,
      fill = ink,
      bold = false,
    ): void => {
      if (text.text !== words || text.style.fontSize !== size) {
        text.text = words;
        text.style = {
          fontFamily: FONT,
          fontSize: size,
          fill,
          fontWeight: bold ? 'bold' : 'normal',
          letterSpacing: Math.max(0, size * 0.12),
        };
      }
      // Never past its cell: a long word in another language is lettered smaller.
      text.scale.set(1);
      const room = w * 0.9;
      if (text.width > room) text.scale.set(room / text.width);
      text.position.set(cx, cy);
    };
    const size = (k: number): number => Math.max(6, Math.round(h * k));
    letter(this.title, words.title, size(0.26), x + w / 2, y + (h * rows[0]!) / 2);
    letter(this.sheet, words.sheet, size(0.15), x + w / 2, y + h * ((rows[0]! + rows[1]!) / 2));
    letter(this.scale, '1:100', size(0.15), x + (w * split) / 2, y + h * ((rows[1]! + 1) / 2));
    // The lettering comes last, as the draughtsman's does.
    const lettered = Math.max(0, (inked - 0.75) / 0.25);
    for (const text of [this.title, this.sheet, this.scale]) text.alpha = lettered;

    // The stamp: pressed down across the block in red, a little crooked, in the final round.
    this.stamp.visible = final;
    if (!final) return;
    const red = hex(art.palette.uiInvalid);
    const stampSize = size(0.3);
    letter(this.stampText, words.stamp, stampSize, 0, 0, red, true);
    const sw = this.stampText.width + stampSize * 0.8;
    const sh = stampSize * 1.6;
    this.stampFrame.clear();
    this.stampFrame.rect(-sw / 2, -sh / 2, sw, sh);
    this.stampFrame.stroke({ width: Math.max(2, stampSize * 0.14), color: red });
    this.stamp.position.set(x + w * 0.5, y + h * 0.55);
    this.stamp.rotation = -0.2;
    this.stamp.scale.set(1 + 0.6 * (1 - stamped));
    this.stamp.alpha = 0.95 * stamped;
  }

  destroy(): void {
    release(this.container);
  }
}
