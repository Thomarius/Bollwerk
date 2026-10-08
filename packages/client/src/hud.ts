import { playerCssColour } from './colours.js';
import { playerShape, shapeSvg } from './shapes.js';
import { formatNumber, t } from './i18n.js';
import { escape } from './html.js';
import { defaultArtConfig, type ArtStyle, type TextKey } from '@bollwerk/config';

import { showsClock } from './clock.js';
import { motionReduced } from './motion.js';

import {
  countUp,
  inFinalRound,
  isTeamMatch,
  roundLabel,
  standings,
  teamLetter,
  teamStandings,
  type AnnouncementLine,
  type RankEntry,
} from './scores.js';
import { owesCastleChoice, teamScore, type MatchState, type Phase } from '@bollwerk/sim';
import { BoardLabels } from './boardLabels.js';
import { EndScreen } from './endScreen.js';

/**
 * The phase banner each style draws, as a class of `.phase-call`: a record over every
 * style, so a new one must bring its own, as it must a menu title. The banner is where
 * the look changes, so it takes the look it brings — the arriving one. Medieval and
 * Night keep the dark band with gold that every style once shared.
 */
const BANNER_CLASS: Record<ArtStyle, string> = {
  flat: 'banner-flat',
  pixel: 'banner-classic',
  night: 'banner-classic',
  cyberpunk: 'banner-neon',
  blueprint: 'banner-plan',
  parchment: 'banner-ribbon',
  bricks: 'banner-bricks',
  glass: 'banner-glass',
  chocolate: 'banner-chocolate',
  halloween: 'banner-halloween',
  sakura: 'banner-sakura',
  oktoberfest: 'banner-wiesn',
  opera: 'banner-opera',
  office: 'banner-office',
  undersea: 'banner-undersea',
  electric: 'banner-electric',
  cartoon: 'banner-cartoon',
  christmas: 'banner-christmas',
};

/**
 * The HUD in each look (PLAN 11.11 W7): the bar, the clock and the cannon count,
 * dressed as the banners are. A record over every style, so a new style must bring one.
 * Medieval and Night share the dark bar with gold that every style once had.
 */
const HUD_SKIN: Record<ArtStyle, string> = {
  flat: 'hud-flat',
  pixel: 'hud-classic',
  night: 'hud-classic',
  cyberpunk: 'hud-neon',
  blueprint: 'hud-plan',
  parchment: 'hud-ink',
  bricks: 'hud-bricks',
  glass: 'hud-glass',
  chocolate: 'hud-chocolate',
  halloween: 'hud-halloween',
  sakura: 'hud-sakura',
  oktoberfest: 'hud-wiesn',
  opera: 'hud-opera',
  office: 'hud-office',
  undersea: 'hud-undersea',
  electric: 'hud-electric',
  cartoon: 'hud-cartoon',
  christmas: 'hud-christmas',
};

const PHASE_LABEL: Record<Phase, TextKey> = {
  lobby: 'phase.lobby',
  intermission: 'phase.intermission',
  castle_select: 'phase.castleSelect',
  combat: 'phase.combat',
  build: 'phase.build',
  cannon_place: 'phase.cannonPlace',
  game_over: 'phase.gameOver',
};

/** Short, shouted names for the sweeping phase announcement. */
const PHASE_CALL: Record<Phase, TextKey | null> = {
  lobby: null,
  intermission: null,
  castle_select: 'call.castleSelect',
  combat: 'call.combat',
  build: 'call.build',
  cannon_place: 'call.cannonPlace',
  game_over: null,
};

/** A phase label longer than this, in characters, is set smaller (`.phase.long`). */
const LONG_PHASE_LABEL = 22;

/** How long a ranking's entries take to come in before their scores start counting. */
const RANK_COUNT_DELAY_MS = 450;

export class Hud {
  /** What stands over the board: the marker, team tags, big timer, count and banners. */
  readonly labels: BoardLabels;
  /** The summary at the end of a match, its awards, chart, reveal and buttons. */
  readonly endScreen: EndScreen;

  constructor(
    private readonly root: HTMLElement,
    private readonly bannerRoot: HTMLElement,
  ) {
    this.labels = new BoardLabels(root, bannerRoot);
    this.endScreen = new EndScreen(root);
  }

  /** When the phase on screen began, so the time bar knows its whole length. */
  private phaseKey = '';

  private phaseStartTick = 0;

  /** The announcement crossing the screen, if one is. */
  private phaseCall: HTMLElement | null = null;

  private skin: string | null = null;

  /**
   * Dresses the HUD in a look's style. The bar is at the top of the screen, and above a
   * banner's line is always the arriving look, so the HUD takes it as the banner starts.
   * Set on the page, not the bar alone, so the banner layer and the overlays — the ready
   * count, the end screen, the pause menu — take it too (PLAN 11.19 Z1); `null` takes it
   * off, as the match is left.
   */
  useSkin(style: ArtStyle | null): void {
    const skin = style === null ? null : HUD_SKIN[style];
    if (skin === this.skin) return;
    const page = this.root.ownerDocument.body;
    if (this.skin !== null) page.classList.remove(this.skin);
    if (skin !== null) page.classList.add(skin);
    this.skin = skin;
    // A skin brings its own lettering, so the phase label's width is measured again.
    if (this.frame !== null) this.frame.phaseHtml = '';
  }

  /** Whether the final round's stamp has been shown, so it lands once, as it opens. */
  private finalStamped = false;

  /**
   * The last round, marked (PLAN 11.11 W6): a stamp across the board as it opens, and a
   * warm dusk at the edges of the screen until the match ends — in every style, where
   * Medieval's own sunset is only in its own. At the edges and faint, so no player's
   * colour moves on the board.
   */
  /** The final round's embers, kept while it lasts. */
  private embers: HTMLElement | null = null;

  private markFinalRound(final: boolean): void {
    this.bannerRoot.classList.toggle('final-round', final);
    this.showEmbers(final);
    if (!final || this.finalStamped) return;
    this.finalStamped = true;
    const stamp = document.createElement('div');
    stamp.className = 'final-stamp';
    stamp.textContent = t('announce.finalRound');
    stamp.style.animationDuration = `${defaultArtConfig.effects.finalStampMs}ms`;
    stamp.addEventListener('animationend', () => stamp.remove());
    this.bannerRoot.append(stamp);
    // Reduced motion runs no animation to end it, so it is taken down by the clock.
    setTimeout(() => stamp.remove(), defaultArtConfig.effects.finalStampMs);
  }

  /**
   * Embers drifting up the screen's edges through the final round, with its dusk (PLAN
   * 11.15): sparks rising from the bottom corners, each on its own course and pace, and
   * never over the middle of the board. HTML over every style, as the dusk is; the
   * stylesheet hides them under reduced motion.
   */
  private showEmbers(final: boolean): void {
    if (!final) {
      this.embers?.remove();
      this.embers = null;
      return;
    }
    if (this.embers !== null) return;
    this.embers = document.createElement('div');
    this.embers.className = 'embers';
    for (let k = 0; k < defaultArtConfig.effects.finalEmberCount; k++) {
      const ember = document.createElement('i');
      const left = k % 2 === 0;
      const pace = 6 + Math.random() * 5;
      ember.style.left = `${left ? Math.random() * 14 : 86 + Math.random() * 14}%`;
      ember.style.animationDuration = `${pace.toFixed(2)}s`;
      // Already under way as the round opens, rather than all setting out together.
      ember.style.animationDelay = `${(-Math.random() * pace).toFixed(2)}s`;
      ember.style.setProperty('--drift', `${(left ? 1 : -1) * (2 + Math.random() * 6)}vw`);
      this.embers.append(ember);
    }
    this.bannerRoot.append(this.embers);
  }

  /**
   * Announces a phase with a banner that sweeps down the screen, as the original
   * did. Phases change without warning otherwise, and a player who does not notice
   * that combat has ended spends the first seconds of the build phase shooting.
   *
   * `lines` ride along underneath — the standings after a resolution, and the call
   * for the final round — so neither needs a pause of its own. It enters above the top
   * of the screen; `placeAnnouncement` moves it from there.
   */
  announce(
    phase: Phase,
    lines: readonly AnnouncementLine[] = [],
    style: ArtStyle = 'pixel',
    title: string | null = null,
    ranks: readonly RankEntry[] = [],
  ): void {
    this.clearAnnouncement();
    const call = PHASE_CALL[phase];
    const text = title ?? (call === null ? '' : t(call));
    if (text === '') return;
    const banner = document.createElement('div');
    banner.className = `phase-call ${BANNER_CLASS[style]}${title === null ? '' : ' titled'}`;
    banner.textContent = text;
    for (const line of lines) {
      const small = document.createElement('small');
      small.textContent = line.text;
      if (line.emphasis) small.className = 'news';
      banner.append(small);
    }
    this.ranking = ranks.length === 0 ? null : this.rankingFor(ranks);
    if (this.ranking !== null) banner.append(this.ranking.node);
    // Replace only the last announcement. This layer also holds everything else drawn
    // over the board — the island banners, the team tags, the big timer, the cannon
    // count at the cursor — and clearing it all left those updating nodes no longer on
    // the page, so the count vanished for good at the first announcement.
    this.phaseCall = banner;
    this.bannerRoot.append(banner);
  }

  /**
   * Puts the announcement `progress` of the way down the screen — 0 wholly above it,
   * 1 wholly below — and returns the height of its middle in pixels, which is where the
   * board changes beneath it. Null when there is no announcement.
   *
   * At constant speed, with no dwell: the banner sweeps past rather than stopping to be
   * read. The simulation holds the next phase until it has left.
   */
  placeAnnouncement(progress: number): number | null {
    const banner = this.phaseCall;
    if (banner === null) return null;
    this.countRanking();
    const screen = this.bannerRoot.clientHeight;
    const height = banner.offsetHeight;
    const top = -height + progress * (screen + height);
    banner.style.transform = `translateY(${top.toFixed(1)}px)`;
    return top + height / 2;
  }

  clearAnnouncement(): void {
    this.phaseCall?.remove();
    this.phaseCall = null;
    this.ranking = null;
  }

  /** The ranking riding under the banner after a resolution, and when it was shown. */
  private ranking: {
    node: HTMLElement;
    since: number;
    scores: { node: HTMLElement; from: number; to: number }[];
  } | null = null;

  /**
   * The standings after a resolution, as a ranking (PLAN 11.16 I1): an entry a player or
   * a team, each in its colour with its shape, sliding in one after another; the score
   * counting up from the round before's, the round's gain beside it, and an arrow for a
   * place won or lost. All inside the banner's crossing, so it adds no time to the match.
   */
  private rankingFor(ranks: readonly RankEntry[]): NonNullable<typeof this.ranking> {
    const node = document.createElement('div');
    node.className = 'ranking';
    const scores: { node: HTMLElement; from: number; to: number }[] = [];
    ranks.forEach((r, k) => {
      const entry = document.createElement('span');
      entry.className = `entry${r.out ? ' out' : ''}`;
      entry.style.setProperty('--i', String(k));
      const colour = playerCssColour(r.lead);
      const gain = r.score - r.from;
      const moved =
        r.moved > 0
          ? `<i class="moved up" title="${t('hud.climbed')}">▲</i>`
          : r.moved < 0
            ? `<i class="moved down" title="${t('hud.dropped')}">▼</i>`
            : '';
      entry.innerHTML =
        `<b class="rank">${r.rank}</b>${shapeSvg(playerShape(r.lead), colour)}` +
        `<span class="who">${escape(r.label)}</span><em class="score">${r.from}</em>` +
        (gain > 0 ? `<i class="gain">+${gain}</i>` : '') +
        moved;
      node.append(entry);
      scores.push({ node: entry.querySelector<HTMLElement>('.score')!, from: r.from, to: r.score });
    });
    return { node, since: performance.now(), scores };
  }

  /** The ranking's scores counting up, a little after their entries have come in. */
  private countRanking(): void {
    const ranking = this.ranking;
    if (ranking === null) return;
    const span = defaultArtConfig.effects.tallyMs;
    const elapsed = motionReduced()
      ? span
      : performance.now() - ranking.since - RANK_COUNT_DELAY_MS;
    for (const s of ranking.scores) {
      const text = String(countUp(s.from, s.to, Math.max(0, elapsed), span));
      if (s.node.textContent !== text) s.node.textContent = text;
    }
  }

  /**
   * The HUD's frame, built once: the phase and the rest are rewritten when their markup
   * changes, the roster is kept, so its entries can count up and slide rather than being
   * replaced. Rewritten every frame, as they once were, they had the page restyled, laid out
   * and repainted sixty times a second for nothing (PLAN 11.22); the time bar's fill is the
   * one thing that moves every frame, and only its width is set.
   */
  private frame: {
    phase: HTMLElement;
    roster: HTMLElement;
    rest: HTMLElement;
    phaseHtml: string;
    timer: HTMLElement | null;
    seconds: string;
    restHtml: string;
    fill: HTMLElement | null;
    fillWidth: string;
  } | null = null;

  /** Roster entries by key — `p<player>` or `t<team>` — and the markup each last had. */
  private readonly entries = new Map<string, { node: HTMLElement; html: string }>();

  /** Scores counting up, by the same keys. */
  private readonly counts = new Map<string, { from: number; to: number; since: number }>();

  /** The phase label's width as last measured, so the roster is told only of a change. */
  private phaseWidth = 0;

  private layout(): NonNullable<Hud['frame']> {
    if (this.frame !== null && this.frame.roster.isConnected) return this.frame;
    this.root.innerHTML =
      '<div class="bar"><div class="phase"></div><ul class="roster"></ul></div>' +
      '<div class="hud-rest"></div>';
    this.entries.clear();
    this.frame = {
      phase: this.root.querySelector<HTMLElement>('.phase')!,
      roster: this.root.querySelector<HTMLElement>('.roster')!,
      rest: this.root.querySelector<HTMLElement>('.hud-rest')!,
      phaseHtml: '',
      timer: null,
      seconds: '',
      restHtml: '',
      fill: null,
      fillWidth: '',
    };
    return this.frame;
  }

  /** A score as shown: counting up to a new total over `tallyMs`, as banked points do. */
  private shownScore(key: string, target: number, now: number): number {
    const span = defaultArtConfig.effects.tallyMs;
    const count = this.counts.get(key);
    if (count === undefined) {
      this.counts.set(key, { from: target, to: target, since: now });
      return target;
    }
    if (count.to !== target) {
      count.from = countUp(count.from, count.to, now - count.since, span);
      count.to = target;
      count.since = now;
    }
    return countUp(count.from, count.to, now - count.since, span);
  }

  /**
   * Puts the roster's entries in this order, sliding any that moved from where they
   * were rather than letting them jump — so a change of places reads as one.
   */
  private placeEntries(roster: HTMLElement, order: readonly string[]): void {
    const want = order.flatMap((key) => {
      const entry = this.entries.get(key);
      return entry === undefined ? [] : [entry.node];
    });
    const current = [...roster.children];
    if (current.length === want.length && current.every((node, i) => node === want[i])) return;
    const was = new Map(current.map((node) => [node, node.getBoundingClientRect().left]));
    roster.replaceChildren(...want);
    if (motionReduced()) return;
    for (const node of want) {
      const left = was.get(node);
      if (left === undefined) continue;
      const dx = left - node.getBoundingClientRect().left;
      if (Math.abs(dx) < 1) continue;
      node.style.transition = 'none';
      node.style.transform = `translateX(${dx}px)`;
      void node.offsetWidth;
      node.style.transition = 'transform 360ms ease';
      node.style.transform = '';
    }
  }

  /** Sets an entry's markup, touching the page only when it has changed. */
  private entry(key: string, html: string): void {
    let entry = this.entries.get(key);
    if (entry === undefined) {
      entry = { node: document.createElement('li'), html: '' };
      this.entries.set(key, entry);
    }
    if (entry.html === html) return;
    entry.html = html;
    // The outer element is kept, so its slide survives; only what is inside it changes.
    const template = document.createElement('template');
    template.innerHTML = html;
    const built = template.content.firstElementChild as HTMLElement | null;
    if (built === null) return;
    entry.node.className = built.className;
    entry.node.title = built.title;
    entry.node.style.cssText = built.style.cssText;
    entry.node.replaceChildren(...built.childNodes);
  }

  update(state: MatchState, humanPlayer: number, status = ''): void {
    const waiting = state.phase === 'intermission';
    const shown = waiting ? (state.pendingPhase ?? state.phase) : state.phase;
    this.markFinalRound(inFinalRound(state));
    const secondsLeft = Math.max(0, (state.phaseEndTick - state.tick) / state.ruleset.tickRateHz);

    // A bar reads at the edge of vision in a way a number does not — the player is
    // looking at their wall, not at the corner of the screen. Red for the last few
    // seconds, when it matters most.
    const key = `${state.phase}:${state.phaseEndTick}`;
    if (key !== this.phaseKey) {
      this.phaseKey = key;
      this.phaseStartTick = state.tick;
    }
    const span = Math.max(1, state.phaseEndTick - this.phaseStartTick);
    const left = Math.min(1, Math.max(0, (state.phaseEndTick - state.tick) / span));
    // Its fill's width is set apart from the markup, which then changes only with the phase.
    const timebar =
      waiting || state.phase === 'game_over' || !showsClock(state)
        ? ''
        : `<div class="timebar${secondsLeft <= 3 ? ' urgent' : ''}"><i></i></div>`;
    const fillWidth = `${(left * 100).toFixed(1)}%`;
    const human = state.players[humanPlayer];

    // The roster carries only what decides the match — points and lives (PLAN 11.15).
    // Castles and guns went: the board shows both, and the room they took makes the two
    // that matter large. One layout at every count, the name cut short to fit its card.
    // Lives are pips, one per life including the one being played, spent ones hollow:
    // the team's pool, in free-for-all a team of one. A pool too big for pips — a team of
    // three or four — is one pip and the count.
    const livesOf = (team: number, out: boolean): string => {
      if (out) return `<span class="lives out">${t('hud.out')}</span>`;
      const pool = state.teams[team];
      const total = (pool?.continuesAtStart ?? 0) + 1;
      const left = (pool?.continuesRemaining ?? 0) + 1;
      const pips =
        total > 5 ? `●<small>${left}</small>` : '●'.repeat(left) + '○'.repeat(total - left);
      const title = t('hud.livesTitle', { left, total });
      return `<span class="lives${left === 1 ? ' last' : ''}" title="${title}">${pips}</span>`;
    };
    const teamed = isTeamMatch(state);
    const now = performance.now();
    // The shape leads the figures, as large as the pips: it is what tells two greens apart.
    const card = (key: string, score: number, lives: string, shape: string): string =>
      `<span class="line">${shape}<em class="score">${this.shownScore(key, score, now)}</em>${lives}</span>`;
    const playerItem = (p: (typeof state.players)[number]): string => {
      const classes = ['player', p.eliminated ? 'out' : '', p.id === humanPlayer ? 'you' : '']
        .filter(Boolean)
        .join(' ');
      const colour = playerCssColour(p.id);
      const name = `<bdi title="${escape(p.name)}">${escape(p.name)}</bdi>`;
      // A team's members carry only their names: the score and lives are the team's.
      return teamed
        ? `<li class="${classes}" style="--who:${colour}"><b></b>${name}</li>`
        : `<li class="${classes}" style="--who:${colour}">${name}${card(`p${p.id}`, p.score, livesOf(p.team, p.eliminated), shapeSvg(playerShape(p.id), colour))}</li>`;
    };
    const frame = this.layout();
    const { phase: phaseRoot, roster: rosterRoot, rest } = frame;
    // In standing, best first, so the leader is always the first entry and a change of
    // places slides — players in free-for-all, teams in a team match, each team headed by
    // its letter, score and pooled lives. Teams kept their letters' order until the test
    // session of 2026-10-08 found the leader hard to see.
    let order: string[];
    if (teamed) {
      const teams = teamStandings(state).map((s) => s.team);
      for (const team of teams) {
        const members = state.players.filter((p) => p.team === team);
        const out = members.every((p) => p.eliminated);
        const mine = members.some((p) => p.id === humanPlayer);
        // Teammates share a shape, so it is the team's, shown once in the head.
        const lead = members[0]?.id ?? 0;
        const shape = shapeSvg(playerShape(lead), playerCssColour(lead));
        this.entry(
          `t${team}`,
          `<li class="team${out ? ' out' : ''}${mine ? ' mine' : ''}">` +
            `<div class="team-head"><b class="letter">${teamLetter(team)}</b>${card(`t${team}`, teamScore(state, team), livesOf(team, out), shape)}</div>` +
            `<ul>${members.map(playerItem).join('')}</ul></li>`,
        );
      }
      order = teams.map((team) => `t${team}`);
    } else {
      for (const p of state.players) this.entry(`p${p.id}`, playerItem(p));
      order = standings(state).map((s) => `p${s.player}`);
    }
    this.placeEntries(rosterRoot, order);
    // The stylesheet sizes the figures by the width each entry has (`--entries`). A team's
    // entry holds its letter and five pips beside the score, half as wide again as a
    // player's: counted as 1.4, four teams fit at 1024 pixels with a German phase label,
    // where at 1 their pips ran into the next team's letter and even English clipped.
    rosterRoot.style.setProperty('--entries', String(order.length * (teamed ? 1.4 : 1)));

    // A player who has just spent a continue chooses a castle in the cannon phase
    // before any guns, so for them this phase is a castle choice first.
    const choosing =
      human !== undefined &&
      owesCastleChoice(human) &&
      (shown === 'cannon_place' || shown === 'castle_select');
    // Overtime: the clock has run out and one more piece may go down.
    const overtime = state.phase === 'build' && state.overtime;
    const label = t(
      choosing ? PHASE_LABEL.castle_select : overtime ? 'hud.overtime' : PHASE_LABEL[shown],
    );

    let cannonCount = '';
    if (state.phase === 'cannon_place' && human && !human.eliminated) {
      const left = human.cannonsToPlace;
      cannonCount = choosing
        ? `<div class="counter">${t('hud.chooseThenCannons', { n: left })}</div>`
        : left > 0
          ? `<div class="counter">${t('hud.cannonsLeft', { n: left })}</div>`
          : `<div class="counter done">${t('hud.allPlaced')}</div>`;
    }

    // The labels over the islands live in the layer above this one, and at the end of a
    // match they sat on top of the summary; it says who was out, so they step aside.
    this.bannerRoot.classList.toggle('game-over', state.phase === 'game_over');
    this.endScreen.update(state, humanPlayer, teamed);
    const seconds = t('hud.seconds', { seconds: formatNumber(secondsLeft, 1) });
    const heading = waiting ? t('hud.next', { label }) : label;
    // A long label — German's run half as long again as English's — is set smaller and
    // tighter, so eight players' figures keep their pips at 1024 pixels.
    // The clock's figures change ten times a second and nothing else does, so they are set
    // as the timer's text; the label is written whole only when the rest of it changes.
    const phaseHtml =
      `<strong>${heading}</strong>` +
      // Hidden rather than removed, so the round label does not jump sideways every
      // intermission; and there is no clock to show once the match is over.
      (waiting || state.phase === 'game_over' || !showsClock(state)
        ? `<span class="timer" style="visibility:hidden"></span>`
        : `<span class="timer"></span>`) +
      `<span class="round${inFinalRound(state) ? ' final' : ''}">${roundLabel(state)}</span>`;
    // Measured again when the clock loses or gains a figure, from 10.0 s to 9.9 s.
    const rewrite = phaseHtml !== frame.phaseHtml;
    const remeasure = rewrite || seconds.length !== frame.seconds.length;
    if (rewrite) {
      frame.phaseHtml = phaseHtml;
      phaseRoot.classList.toggle('long', heading.length > LONG_PHASE_LABEL);
      phaseRoot.innerHTML = phaseHtml;
      frame.timer = phaseRoot.querySelector<HTMLElement>('.timer');
      frame.seconds = '';
    }
    if (frame.timer !== null && seconds !== frame.seconds) {
      frame.seconds = seconds;
      frame.timer.textContent = seconds;
    }
    if (remeasure) {
      // The roster's figures are sized by the room the phase label leaves (`--phase`):
      // measured, not assumed, since a language's label may be half as long again as
      // English's, and the four teams' figures then ran into one another at 1024 pixels.
      // Measured only when the label changed, since reading it lays the page out.
      const phaseWidth = phaseRoot.offsetWidth;
      if (phaseWidth !== this.phaseWidth) {
        this.phaseWidth = phaseWidth;
        rosterRoot.style.setProperty('--phase', `${phaseWidth}px`);
      }
    }
    // No piece box and no line of hints at the bottom: the test sessions found nobody
    // had time to look down there. The ghost at the cursor is the piece held, the
    // stamp over an island says who is out, and the phase label says overtime.
    const restHtml = timebar + cannonCount + (status ? `<div class="net">${status}</div>` : '');
    if (restHtml !== frame.restHtml) {
      frame.restHtml = restHtml;
      rest.innerHTML = restHtml;
      frame.fill = rest.querySelector<HTMLElement>('.timebar i');
      frame.fillWidth = '';
    }
    if (frame.fill !== null && fillWidth !== frame.fillWidth) {
      frame.fillWidth = fillWidth;
      frame.fill.style.width = fillWidth;
    }
  }
}
