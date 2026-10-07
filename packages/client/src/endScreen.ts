import { playerCssColour } from './colours.js';
import { SHAPE_PATHS, playerShape, shapeSvg } from './shapes.js';
import { awardCandidates, drawAwards, type Award } from './awards.js';
import { t } from './i18n.js';
import { escape } from './html.js';
import { defaultArtConfig } from '@bollwerk/config';

import { mostCastlesOf, scoreChart, type MatchLog, type Reveal } from './summary.js';

import { endOfMatchText, isTeamMatch, standings, teamLetter, teamStandings } from './scores.js';
import { type MatchState } from '@bollwerk/sim';

/**
 * The summary at the end of a match (`summary.ts` keeps its log): each player's or team's
 * standing, the wall they knocked down, the most castles they held and the lives left, up
 * to three awards, every score charted round by round, the bots revealed, and Rematch and
 * Back to menu. Held back a moment so the fireworks have the screen first.
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

  private leave: (() => void) | null = null;

  private rematch: (() => void) | null = null;

  private rematchBy: 'mine' | 'host' | null = null;

  /** What the end screen's button does: back to the menu, whether played or watched. */
  onLeave(handler: () => void): void {
    this.leave = handler;
  }

  /** The end screen's Rematch: the player's to press, the host's to press, or not there. */
  useRematch(by: 'mine' | 'host' | null): void {
    this.rematchBy = by;
  }

  onRematch(handler: () => void): void {
    this.rematch = handler;
  }

  private showEndScreen(html: string): void {
    if (this.endScreen === null || !this.endScreen.isConnected) {
      this.endScreen = document.createElement('div');
      this.endScreen.className = 'end-screen';
      this.endScreen.addEventListener('click', (event) => {
        const target = event.target as HTMLElement;
        if (target.closest('.leave')) this.leave?.();
        const rematch = target.closest<HTMLButtonElement>('.rematch');
        if (rematch !== null && !rematch.disabled) this.rematch?.();
      });
      this.root.append(this.endScreen);
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
    if (html === '') this.gameOverAt = null;
    else this.gameOverAt ??= now;
    const held =
      this.gameOverAt !== null && now - this.gameOverAt < defaultArtConfig.summary.delayMs;
    this.endScreen.classList.toggle('held', held);
  }

  /** The match's log, for the summary at its end; see `summary.ts`. */
  private log: MatchLog | null = null;

  useLog(log: MatchLog): void {
    this.log = log;
  }

  /** The bots revealed at game over: their levels and the personalities they were dealt. */
  private reveal: readonly Reveal[] = [];

  useReveal(reveal: readonly Reveal[]): void {
    this.reveal = reveal;
  }

  /** The awards drawn for this match, once it is over: drawn once, so they hold still. */
  private awards: readonly Award[] | null = null;

  /**
   * Up to three awards (PLAN 11.18 Y5), each a card: its title, the player in their colour
   * and shape, and what earned it. Judged from the log, so a client that heard no
   * resolution — a jump straight to the end — shows none rather than awards it cannot know.
   */
  private awardsMarkup(state: MatchState, humanPlayer: number): string {
    const log = this.log;
    if (log === null || log.scores.length === 0) return '';
    this.awards ??= drawAwards(awardCandidates(log, state), state.seed);
    if (this.awards.length === 0) return '';
    const cards = this.awards
      .map((award) => {
        const colour = playerCssColour(award.player);
        const name =
          award.player === humanPlayer ? t('hud.you') : (state.players[award.player]?.name ?? '');
        return (
          `<li class="award" style="--who:${colour}"><strong>${escape(award.title)}</strong>` +
          `<span class="who">${shapeSvg(playerShape(award.player), colour)}${escape(name)}</span>` +
          `<small>${escape(award.detail)}</small></li>`
        );
      })
      .join('');
    return `<ul class="awards">${cards}</ul>`;
  }

  /** Rematch, for whoever may call it; for the others online, the host's to call. */
  private rematchButton(): string {
    if (this.rematchBy === 'mine') return `<button class="rematch">${t('hud.rematch')}</button>`;
    if (this.rematchBy === 'host') {
      return `<button class="rematch" disabled>${t('hud.rematchHost')}</button>`;
    }
    return '';
  }

  /**
   * The surprise at the end (PLAN 11.6): one line per bot, its colour, name, level and
   * personality in plain words.
   */
  private revealMarkup(): string {
    if (this.reveal.length === 0) return '';
    const lines = this.reveal
      .map(
        (r) =>
          `<li><b style="background:${playerCssColour(r.player)}"></b>${escape(r.name)} <span>${escape(r.text)}</span></li>`,
      )
      .join('');
    return `<div class="reveal"><small>${t('hud.revealTitle')}</small><ul>${lines}</ul></div>`;
  }

  /**
   * Every score round by round, one line per player — per team in a team match — so the
   * end of a match shows where it was won. The viewer's own line is drawn heaviest.
   */
  private chart(state: MatchState, humanPlayer: number): string {
    const log = this.log;
    if (log === null || log.scores.length < 2) return '';
    const width = 360;
    const height = 110;
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
    const lines = scoreChart(series, log.scores.length, width, height)
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
        return `<path d="${d}" stroke="${colour}" stroke-width="${mine ? 3 : 1.5}" fill="none" stroke-linejoin="round"/>${marker}`;
      })
      .join('');
    // The lines start from nought, before the first round seen: the start of the match,
    // or where a client that joined part-way came in.
    const first = log.scores[0]?.round ?? 1;
    const last = log.scores.at(-1)?.round ?? first;
    const start = first === 1 ? t('hud.chartStart') : t('round.label', { round: first - 1 });
    return (
      `<figure class="score-chart"><svg viewBox="-8 -8 ${width + 16} ${height + 16}" width="${width}" height="${height}">` +
      `<line x1="0" y1="${height}" x2="${width}" y2="${height}" class="axis"/>${lines}</svg>` +
      `<figcaption><span>${start}</span><span>${t('hud.chartCaption')}</span>` +
      `<span>${t('round.label', { round: last })}</span></figcaption></figure>`
    );
  }

  /** Every frame: the summary once the match is over, nothing before. */
  update(state: MatchState, humanPlayer: number, teamed: boolean): void {
    this.showEndScreen(state.phase === 'game_over' ? this.markup(state, humanPlayer, teamed) : '');
  }

  private markup(state: MatchState, humanPlayer: number, teamed: boolean): string {
    const text = escape(endOfMatchText(state, humanPlayer));
    // Only a log that saw the match: one that heard no resolution — a jump straight to
    // the end — would claim noughts it does not know.
    const log = this.log !== null && this.log.scores.length > 0 ? this.log : null;
    const sum = (map: ReadonlyMap<number, number> | undefined, ids: readonly number[]): number =>
      ids.reduce((total, id) => total + (map?.get(id) ?? 0), 0);
    // What each row did as well as where it finished: the wall it knocked down, the
    // most castles it held at once, and the lives it has left — counted as the roster's
    // pips are, the pool and the life being played, none once out. Lives *lost* read
    // wrong: the failure that puts a player out spends no continue, so a player out
    // after three failures showed two.
    const livesLeft = (team: number, out: boolean): number =>
      out ? 0 : (state.teams[team]?.continuesRemaining ?? 0) + 1;
    const stats = (ids: readonly number[], team: number, out: boolean): string =>
      log === null
        ? ''
        : `<td>${sum(log.destroyed, ids)}</td><td>${mostCastlesOf(log, ids)}</td>` +
          `<td>${livesLeft(team, out)}</td>`;
    const head =
      log === null
        ? ''
        : `<tr class="head"><td></td><td></td><td>${t('hud.colPoints')}</td>` +
          `<td>${t('hud.colWall')}</td><td>${t('hud.colCastles')}</td>` +
          `<td>${t('hud.colLives')}</td><td></td></tr>`;
    // A table rather than a line: with more than three players a single line of
    // names and numbers could not be read at a glance.
    const rows = teamed
      ? teamStandings(state)
          .map((s, rank) => {
            const mine = s.members.includes(humanPlayer);
            const members = s.members
              .map(
                (id) =>
                  `<b style="background:${playerCssColour(id)}"></b>${escape(state.players[id]?.name ?? '')}`,
              )
              .join(' ');
            return (
              `<tr class="${s.eliminated ? 'out' : ''}${mine ? ' you' : ''}">` +
              `<td>${rank + 1}</td><td>${shapeSvg(playerShape(s.members[0] ?? 0), playerCssColour(s.members[0] ?? 0))}${t('hud.teamRow', { letter: teamLetter(s.team), members })}</td>` +
              `<td>${s.score}</td>${stats(s.members, s.team, s.eliminated)}<td>${s.eliminated ? t('hud.out') : ''}</td></tr>`
            );
          })
          .join('')
      : standings(state)
          .map(
            (s, rank) =>
              `<tr class="${s.eliminated ? 'out' : ''}${s.player === humanPlayer ? ' you' : ''}">` +
              `<td>${rank + 1}</td><td>${shapeSvg(playerShape(s.player), playerCssColour(s.player))}${escape(s.name)}</td>` +
              `<td>${s.score}</td>${stats([s.player], state.players[s.player]?.team ?? s.player, s.eliminated)}<td>${s.eliminated ? t('hud.out') : ''}</td></tr>`,
          )
          .join('');
    const table = `<table class="final">${head}${rows}</table>`;
    // A button, not a key: everything else in the game is the mouse, and a key that
    // does something unannounced is the kind of surprise players dislike.
    return `<div class="banner summary">${text}${table}${this.awardsMarkup(state, humanPlayer)}${this.chart(state, humanPlayer)}${this.revealMarkup()}<div class="end-buttons">${this.rematchButton()}<button class="leave">${t('watching.back')}</button></div></div>`;
  }
}
