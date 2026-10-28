import { playerCssColour } from './colours.js';
import { SHAPE_PATHS, playerShape, shapeSvg } from './shapes.js';
import { awardCandidates, drawAwards, type Award } from './awards.js';
import { t } from './i18n.js';
import type { TextKey } from '@bollwerk/config';
import { escape } from './html.js';
import { defaultArtConfig } from '@bollwerk/config';
import { AWARD_ICONS, ICONS, withIcon } from './icons.js';
import { motionReduced } from './motion.js';

import { mostCastlesOf, scoreChart, type MatchLog } from './summary.js';

import {
  countUp,
  endOfMatchText,
  isTeamMatch,
  lifePips,
  standings,
  teamName,
  teamStandings,
  yourPlace,
} from './scores.js';
import { type MatchState } from '@bollwerk/sim';

/** How long the points count up from nought as the summary arrives. */
const COUNT_MS = 1200;

/** The chart's own pixels, inside its view box's margins for the scale. */
const CHART_W = 520;
const CHART_H = 150;
const CHART_LEFT = 44;
const CHART_TOP = 12;
const CHART_BOX_W = CHART_W + CHART_LEFT + 16;
const CHART_BOX_H = CHART_H + CHART_TOP + 22;

/**
 * The summary at the end of a match (`summary.ts` keeps its log): a headline in the look's
 * lettering and, for a viewer who did not win, their own place; each player's or team's
 * standing, the winner crowned, with the wall they knocked down, the most castles they held
 * and the lives left; up to three awards; every score charted round by round, a round's
 * scores on hover; and Rematch and Back to menu. Held back a moment so the fireworks have
 * the screen first, then arriving with the points counting up, the awards turning in and the
 * chart's lines drawn. "Show the board" folds it to a bar, to look at the final map
 * (2026-10-28: brought to the menus' look and quality).
 */
export class EndScreen {
  constructor(private readonly root: HTMLElement) {}

  /**
   * The end-of-match screen, kept apart from the markup rewritten every frame: a button
   * replaced between a press and its release never receives the click.
   */
  private endScreen: HTMLElement | null = null;

  private endScreenHtml = '';

  /** When the match was first seen over, for holding the summary back (`showEndScreen`). */
  private gameOverAt: number | null = null;

  /** Whether the summary has been revealed, so it arrives once. */
  private revealed = false;

  private leave: (() => void) | null = null;

  private rematch: (() => void) | null = null;

  private rematchBy: 'mine' | 'host' | null = null;

  /** The Rematch button's label, where it leads on rather than back to the table. */
  private rematchLabel: TextKey | null = null;

  /** Each round's scores as the chart's hover shows them, by the round's place on it. */
  private roundTips: string[] = [];

  /** What the end screen's button does: back to the menu, whether played or watched. */
  onLeave(handler: () => void): void {
    this.leave = handler;
  }

  /** The end screen's Rematch: the player's to press, the host's to press, or not there. */
  useRematch(by: 'mine' | 'host' | null, label?: TextKey): void {
    this.rematchBy = by;
    this.rematchLabel = label ?? null;
  }

  onRematch(handler: () => void): void {
    this.rematch = handler;
  }

  private showEndScreen(html: string): void {
    if (this.endScreen === null || !this.endScreen.isConnected) {
      const screen = document.createElement('div');
      screen.className = 'end-screen';
      screen.addEventListener('click', (event) => {
        const target = event.target as HTMLElement;
        if (target.closest('.leave')) this.leave?.();
        const rematch = target.closest<HTMLButtonElement>('.rematch');
        if (rematch !== null && !rematch.disabled) this.rematch?.();
        // The board shown, the summary folded to a bar; and back.
        if (target.closest('.peek')) screen.classList.toggle('peeking');
      });
      screen.addEventListener('pointermove', (event) => this.hoverChart(event));
      screen.addEventListener('pointerleave', () => this.hoverChart(null));
      this.endScreen = screen;
      this.root.append(screen);
      this.endScreenHtml = '';
    }
    if (html !== this.endScreenHtml) {
      this.endScreen.innerHTML = html;
      this.endScreenHtml = html;
    }
    // Held back while the fireworks and the camera's push have the screen to themselves:
    // shown at once, the summary covered the celebration it followed. Timed here rather
    // than by a CSS delay, which would start again whenever the markup was rewritten.
    const now = performance.now();
    if (html === '') {
      this.gameOverAt = null;
      this.revealed = false;
      this.endScreen.classList.remove('peeking');
    } else this.gameOverAt ??= now;
    const held =
      this.gameOverAt !== null && now - this.gameOverAt < defaultArtConfig.summary.delayMs;
    this.endScreen.classList.toggle('held', held);
    if (html !== '' && !held && !this.revealed) {
      this.revealed = true;
      this.countPoints();
    }
  }

  /**
   * The points counting up from nought as the summary arrives, as the island banners count
   * theirs (`countUp`); written into the page, since the markup itself holds still. Not under
   * reduced motion, where they stand at once.
   */
  private countPoints(): void {
    const screen = this.endScreen;
    if (screen === null || motionReduced()) return;
    const cells = [...screen.querySelectorAll<HTMLElement>('[data-count]')];
    const start = performance.now();
    const step = (now: number): void => {
      const elapsed = now - start;
      for (const cell of cells) {
        if (!cell.isConnected) return;
        cell.textContent = String(countUp(0, Number(cell.dataset.count), elapsed, COUNT_MS));
      }
      if (elapsed < COUNT_MS) requestAnimationFrame(step);
    };
    for (const cell of cells) cell.textContent = '0';
    requestAnimationFrame(step);
  }

  /** The chart's hover: a line down the round under the pointer, and its scores beside it. */
  private hoverChart(event: PointerEvent | null): void {
    const figure = this.endScreen?.querySelector<HTMLElement>('.score-chart');
    if (!figure) return;
    const guide = figure.querySelector<SVGLineElement>('.guide');
    const tip = figure.querySelector<HTMLElement>('.chart-tip');
    if (!guide || !tip) return;
    const hit = (event?.target as Element | null)?.closest?.('[data-round]');
    const index = Number(hit?.getAttribute('data-round'));
    const content = this.roundTips[index];
    if (!hit || content === undefined) {
      guide.style.visibility = 'hidden';
      tip.hidden = true;
      return;
    }
    const x = hit.getAttribute('data-x') ?? '0';
    guide.setAttribute('x1', x);
    guide.setAttribute('x2', x);
    guide.style.visibility = 'visible';
    if (tip.dataset.round !== String(index)) {
      tip.innerHTML = content;
      tip.dataset.round = String(index);
    }
    tip.hidden = false;
    // Beside the line, on whichever side has room.
    const share = (Number(x) + CHART_LEFT) / CHART_BOX_W;
    tip.style.left = share > 0.6 ? '' : `calc(${(share * 100).toFixed(1)}% + 12px)`;
    tip.style.right = share > 0.6 ? `calc(${((1 - share) * 100).toFixed(1)}% + 12px)` : '';
  }

  /** The match's log, for the summary at its end; see `summary.ts`. */
  private log: MatchLog | null = null;

  useLog(log: MatchLog): void {
    this.log = log;
  }

  /** The awards drawn for this match, once it is over: drawn once, so they hold still. */
  private awards: readonly Award[] | null = null;

  /**
   * Up to three awards (PLAN 11.18 Y5), each a card: its icon and title, the player in their
   * colour and shape, and what earned it. Judged from the log, so a client that heard no
   * resolution — a jump straight to the end — shows none rather than awards it cannot know.
   */
  private awardsMarkup(state: MatchState, humanPlayer: number): string {
    const log = this.log;
    if (log === null || log.scores.length === 0) return '';
    this.awards ??= drawAwards(awardCandidates(log, state), state.seed);
    if (this.awards.length === 0) return '';
    const cards = this.awards
      .map((award, i) => {
        const colour = playerCssColour(award.player);
        const name =
          award.player === humanPlayer ? t('hud.you') : (state.players[award.player]?.name ?? '');
        const icon = AWARD_ICONS[award.id] ?? '';
        return (
          `<li class="award" style="--who:${colour};--i:${i}"><strong>${icon}<span>${escape(award.title)}</span></strong>` +
          `<span class="who">${shapeSvg(playerShape(award.player), colour)}${escape(name)}</span>` +
          `<small>${escape(award.detail)}</small></li>`
        );
      })
      .join('');
    return `<ul class="awards">${cards}</ul>`;
  }

  /**
   * The buttons in the menus' tiers: Rematch, or the tournament's way on, the main one,
   * filled; Back to menu quiet beside it, or a plain button where it is the only way on; and
   * Show the board quiet before them — beside the headline it crowded the longer ones.
   */
  private buttons(): string {
    const back = (tier: string): string =>
      `<button class="leave ${tier}">${withIcon('back', t('watching.back'))}</button>`;
    const board = `<button class="peek">${withIcon('eye', t('end.showBoard'))}</button>`;
    if (this.rematchBy === 'mine') {
      return `${board}<button class="rematch">${withIcon('play', t(this.rematchLabel ?? 'hud.rematch'))}</button>${back('quiet')}`;
    }
    if (this.rematchBy === 'host') {
      return `${board}<button class="rematch" disabled>${t(this.rematchLabel ?? 'hud.rematchHost')}</button>${back('quiet')}`;
    }
    return `${board}${back('secondary')}`;
  }

  /**
   * Every score round by round, one line per player — per team in a team match — so the
   * end of a match shows where it was won. The viewer's own line is drawn heaviest; light
   * lines mark nought, half and the top score, the rounds are numbered along the bottom, and
   * a round under the pointer shows everyone's score there.
   */
  private chart(state: MatchState, humanPlayer: number): string {
    const log = this.log;
    this.roundTips = [];
    if (log === null || log.scores.length < 2) return '';
    const teamed = isTeamMatch(state);
    const groups = teamed
      ? [...new Set(state.players.map((p) => p.team))]
          .sort((a, b) => a - b)
          .map((team) => state.players.filter((p) => p.team === team).map((p) => p.id))
      : state.players.map((p) => [p.id]);
    const series = groups.map((ids, key) => ({
      key,
      scores: log.scores.map((round) =>
        ids.reduce((sum, id) => sum + (round.byPlayer[id] ?? 0), 0),
      ),
    }));
    const rounds = log.scores.length;
    const lines = scoreChart(series, rounds, CHART_W, CHART_H)
      .map((line) => {
        const ids = groups[line.key] ?? [];
        const mine = ids.includes(humanPlayer);
        const d = line.points.map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt.x} ${pt.y}`).join(' ');
        const colour = playerCssColour(ids[0] ?? 0);
        const end = line.points.at(-1);
        const marker =
          end === undefined
            ? ''
            : `<path class="end" transform="translate(${end.x - 6} ${end.y - 6}) scale(0.5)" d="${SHAPE_PATHS[playerShape(ids[0] ?? 0)]}" fill="${colour}"/>`;
        return `<path class="line" pathLength="1" d="${d}" stroke="${colour}" stroke-width="${mine ? 3 : 1.5}" fill="none" stroke-linejoin="round"/>${marker}`;
      })
      .join('');
    // The scale: nought, half and the top score across, every round numbered along.
    const top = Math.max(1, ...series.flatMap((s) => s.scores));
    const grid = [0, 0.5, 1]
      .map((share) => {
        const y = (CHART_H - share * CHART_H).toFixed(1);
        return (
          `<line x1="0" y1="${y}" x2="${CHART_W}" y2="${y}" class="${share === 0 ? 'axis' : 'grid'}"/>` +
          `<text x="-8" y="${y}" class="scale" text-anchor="end" dominant-baseline="middle">${Math.round(top * share)}</text>`
        );
      })
      .join('');
    // The lines start from nought, before the first round seen: the start of the match,
    // or where a client that joined part-way came in.
    const first = log.scores[0]?.round ?? 1;
    const step = CHART_W / rounds;
    // Every round numbered where there is room, every other beyond twelve.
    const every = rounds > 12 ? 2 : 1;
    const name = (ids: readonly number[]): string =>
      teamed
        ? teamName(state, state.players[ids[0] ?? 0]?.team ?? 0)
        : ids[0] === humanPlayer
          ? t('hud.you')
          : (state.players[ids[0] ?? 0]?.name ?? '');
    let ticks = '';
    let hits = '';
    log.scores.forEach((round, i) => {
      const x = Number(((i + 1) * step).toFixed(1));
      if ((i + 1) % every === 0 || i === rounds - 1) {
        ticks += `<text x="${x}" y="${CHART_H + 16}" class="scale" text-anchor="middle">${round.round}</text>`;
      }
      hits += `<rect class="hit" data-round="${i}" data-x="${x}" x="${(x - step / 2).toFixed(1)}" y="-${CHART_TOP}" width="${step.toFixed(1)}" height="${CHART_H + CHART_TOP}"/>`;
      const rows = series
        .map((s) => ({ ids: groups[s.key] ?? [], score: s.scores[i] ?? 0 }))
        .sort((a, b) => b.score - a.score)
        .map(
          ({ ids, score }) =>
            `<li${ids.includes(humanPlayer) ? ' class="you"' : ''}>${shapeSvg(playerShape(ids[0] ?? 0), playerCssColour(ids[0] ?? 0))}` +
            `<span>${escape(name(ids))}</span><b>${score}</b></li>`,
        )
        .join('');
      this.roundTips[i] =
        `<strong>${t('round.label', { round: round.round })}</strong><ul>${rows}</ul>`;
    });
    const start = first === 1 ? t('hud.chartStart') : t('round.label', { round: first - 1 });
    return (
      `<figure class="score-chart"><figcaption>${t('hud.chartCaption')}</figcaption>` +
      `<svg viewBox="-${CHART_LEFT} -${CHART_TOP} ${CHART_BOX_W} ${CHART_BOX_H}" preserveAspectRatio="xMidYMid meet" aria-label="${escape(t('hud.chartCaption'))}">` +
      `${grid}<text x="0" y="${CHART_H + 16}" class="scale" text-anchor="start">${start}</text>${ticks}` +
      `<line class="guide" x1="0" x2="0" y1="0" y2="${CHART_H}" style="visibility:hidden"/>${lines}${hits}</svg>` +
      `<div class="chart-tip" hidden></div></figure>`
    );
  }

  /** Every frame: the summary once the match is over, nothing before. */
  update(state: MatchState, humanPlayer: number, teamed: boolean): void {
    this.showEndScreen(state.phase === 'game_over' ? this.markup(state, humanPlayer, teamed) : '');
  }

  private markup(state: MatchState, humanPlayer: number, teamed: boolean): string {
    const text = escape(endOfMatchText(state, humanPlayer));
    const place = yourPlace(state, humanPlayer);
    // Only a log that saw the match: one that heard no resolution — a jump straight to
    // the end — would claim noughts it does not know.
    const log = this.log !== null && this.log.scores.length > 0 ? this.log : null;
    const sum = (map: ReadonlyMap<number, number> | undefined, ids: readonly number[]): number =>
      ids.reduce((total, id) => total + (map?.get(id) ?? 0), 0);
    // What each row did as well as where it finished: the wall it knocked down and the most
    // castles it held at once, where the log saw them, and the lives it has left, as the
    // roster's pips — the pool and the life being played, "out" once out. Lives *lost* read
    // wrong: the failure that puts a player out spends no continue, so a player out after
    // three failures showed two.
    const lives = (team: number, out: boolean): string => {
      if (out) return `<td><em class="tag out">${t('hud.out')}</em></td>`;
      const pool = state.teams[team];
      const total = (pool?.continuesAtStart ?? 0) + 1;
      const left = (pool?.continuesRemaining ?? 0) + 1;
      return `<td><span class="lives" data-tip="${escape(t('hud.livesTitle', { left, total }))}" data-tip-side="left">${lifePips(total, left)}</span></td>`;
    };
    const stats = (ids: readonly number[]): string =>
      log === null ? '' : `<td>${sum(log.destroyed, ids)}</td><td>${mostCastlesOf(log, ids)}</td>`;
    // Each column's heading explained on hover, as the lobby's settings are.
    const heading = (key: TextKey, tip: TextKey): string =>
      `<th><span data-tip="${escape(t(tip))}">${t(key)}</span></th>`;
    const head =
      `<tr class="head"><th></th><th></th>${heading('hud.colPoints', 'hud.colPointsTitle')}` +
      (log === null
        ? ''
        : heading('hud.colWall', 'hud.colWallTitle') +
          heading('hud.colCastles', 'hud.colCastlesTitle')) +
      `${heading('hud.colLives', 'hud.colLivesTitle')}</tr>`;
    // The winner's row crowned and edged in the accent; a draw has none.
    const rank = (n: number, won: boolean): string =>
      won
        ? `<td class="rank"><span class="crown" data-tip="${escape(t('end.winner'))}" data-tip-side="right">${ICONS.crown}</span></td>`
        : `<td class="rank">${n}</td>`;
    const classes = (won: boolean, out: boolean, mine: boolean): string =>
      [won ? 'winner' : '', out ? 'out' : '', mine ? 'you' : ''].filter(Boolean).join(' ');
    const winners = new Set(state.draw ? [] : state.winners);
    // A table rather than a line: with more than three players a single line of
    // names and numbers could not be read at a glance.
    const rows = teamed
      ? teamStandings(state)
          .map((s, i) => {
            const mine = s.members.includes(humanPlayer);
            const won = s.members.some((id) => winners.has(id));
            // The members on a line of their own under the team's name.
            const members = s.members
              .map(
                (id) =>
                  `<span class="member"><b style="background:${playerCssColour(id)}"></b>${escape(id === humanPlayer ? t('hud.you') : (state.players[id]?.name ?? ''))}</span>`,
              )
              .join('');
            return (
              `<tr class="${classes(won, s.eliminated, mine)}">${rank(i + 1, won)}` +
              `<td class="who">${shapeSvg(playerShape(s.members[0] ?? 0), playerCssColour(s.members[0] ?? 0))}` +
              `<span class="name">${escape(teamName(state, s.team))}</span><small class="members">${members}</small></td>` +
              `<td data-count="${s.score}">${s.score}</td>${stats(s.members)}${lives(s.team, s.eliminated)}</tr>`
            );
          })
          .join('')
      : standings(state)
          .map((s, i) => {
            const won = winners.has(s.player);
            const name = s.player === humanPlayer ? t('hud.you') : s.name;
            return (
              `<tr class="${classes(won, s.eliminated, s.player === humanPlayer)}">${rank(i + 1, won)}` +
              `<td class="who">${shapeSvg(playerShape(s.player), playerCssColour(s.player))}<span class="name">${escape(name)}</span></td>` +
              `<td data-count="${s.score}">${s.score}</td>${stats([s.player])}` +
              `${lives(state.players[s.player]?.team ?? s.player, s.eliminated)}</tr>`
            );
          })
          .join('');
    const table = `<table class="final">${head}${rows}</table>`;
    // More than five rows set tighter, so eight players' summary fits a 1400×900 window whole.
    const many = (teamed ? teamStandings(state) : standings(state)).length > 5 ? ' many' : '';
    // Buttons, not keys: everything else in the game is the mouse, and a key that does
    // something unannounced is the kind of surprise players dislike.
    return (
      `<div class="banner summary${many}">` +
      `<h2 class="headline">${text}</h2>${place === null ? '' : `<p class="your-place">${escape(place)}</p>`}` +
      `${table}${this.awardsMarkup(state, humanPlayer)}${this.chart(state, humanPlayer)}` +
      `<div class="end-buttons">${this.buttons()}</div></div>` +
      `<div class="peek-bar"><span>${text}</span><button class="peek">${withIcon('eye', t('end.showSummary'))}</button></div>`
    );
  }
}
