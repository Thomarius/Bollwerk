import { playerCssColour } from './colours.js';
import { SHAPE_PATHS, playerShape, shapeSvg } from './shapes.js';
import { awardCandidates, drawAwards, type Award } from './awards.js';
import type { BannerKind } from './banners.js';
import { escape } from './lobby.js';
import { defaultArtConfig, type ArtStyle, type PlayerShape } from '@bollwerk/config';

import { showsClock } from './clock.js';
import { motionReduced } from './motion.js';
import { mostCastlesOf, scoreChart, type MatchLog, type Reveal } from './summary.js';

import {
  countUp,
  endOfMatchText,
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
};

const PHASE_LABEL: Record<Phase, string> = {
  lobby: 'Waiting',
  intermission: 'Stand by',
  castle_select: 'Choose your castle',
  combat: 'Fire!',
  build: 'Rebuild your walls',
  cannon_place: 'Place your cannons',
  game_over: 'Game over',
};

/** One banner over one island. */
export interface IslandBanner {
  player: number;
  colour: string;
  /** How long a banner of news that expires is held, so its fade can match. */
  holdMs: number;
  kind: BannerKind;
  title: string;
  detail: string;
  urgent: boolean;
  /** Screen pixels, from `Scene.screenAt`. */
  x: number;
  y: number;
}

/** Short, shouted names for the sweeping phase announcement. */
const PHASE_CALL: Record<Phase, string> = {
  lobby: '',
  intermission: '',
  castle_select: 'Choose your castle',
  combat: 'Fire!',
  build: 'Rebuild',
  cannon_place: 'Place cannons',
  game_over: '',
};

/** How long a ranking's entries take to come in before their scores start counting. */
const RANK_COUNT_DELAY_MS = 450;

export class Hud {
  constructor(
    private readonly root: HTMLElement,
    private readonly bannerRoot: HTMLElement,
  ) {}

  /** When the phase on screen began, so the time bar knows its whole length. */
  private phaseKey = '';
  private phaseStartTick = 0;

  /** The announcement crossing the screen, if one is. */
  private phaseCall: HTMLElement | null = null;

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

  private youAreHere: HTMLElement | null = null;

  /** The "You are here" marker over the viewer's island, or null to take it down. */
  showYouAreHere(at: { x: number; y: number; colour: string; shape: PlayerShape } | null): void {
    if (at === null) {
      this.youAreHere?.remove();
      this.youAreHere = null;
      return;
    }
    if (this.youAreHere === null || !this.youAreHere.isConnected) {
      this.youAreHere = document.createElement('div');
      this.youAreHere.className = 'you-are-here';
      // With the player's shape, so the opening is where they learn it.
      this.youAreHere.innerHTML = `${shapeSvg(at.shape, at.colour)}You are here`;
      this.bannerRoot.append(this.youAreHere);
    }
    // Light text in a border of the player's colour: crimson text on the dark box did
    // not read.
    this.youAreHere.style.setProperty('--who', at.colour);
    this.youAreHere.style.left = `${at.x.toFixed(1)}px`;
    this.youAreHere.style.top = `${at.y.toFixed(1)}px`;
  }

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
    stamp.textContent = 'Final round';
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

  /** A team's letter over each of its islands, for the whole of a team match. */
  private teamTags = new Map<number, HTMLElement>();

  showTeamTags(
    tags: readonly { player: number; text: string; colour: string; x: number; y: number }[],
  ): void {
    for (const tag of tags) {
      let node = this.teamTags.get(tag.player);
      if (node === undefined) {
        node = document.createElement('div');
        node.className = 'team-tag';
        node.textContent = tag.text;
        this.bannerRoot.append(node);
        this.teamTags.set(tag.player, node);
      }
      node.style.borderColor = tag.colour;
      // Kept on screen and below the bar: the tags grew (testers missed the small ones),
      // and over an island at the window's edge or in the top row they ran off it or
      // under the roster. Hung from their bottom middle, as the stylesheet places them.
      const margin = 4;
      const half = node.offsetWidth / 2;
      const below = this.barBottom() + node.offsetHeight + margin;
      const x = Math.min(
        Math.max(tag.x, half + margin),
        this.bannerRoot.clientWidth - half - margin,
      );
      node.style.left = `${x}px`;
      node.style.top = `${Math.max(tag.y, below)}px`;
    }
  }

  /** Where the HUD's bar ends, in the banner layer's pixels. */
  private barBottom(): number {
    const bar = this.root.querySelector<HTMLElement>('.bar');
    return bar === null
      ? 0
      : bar.getBoundingClientRect().bottom - this.bannerRoot.getBoundingClientRect().top;
  }

  /** Kept across frames, like the island banners, rather than rebuilt from markup. */
  private bigTimer: HTMLElement | null = null;
  private readyCount: HTMLElement | null = null;

  /**
   * The time left in large figures, in open water near the middle of the map — see
   * `timerSpot`. Null hides it. Red for the last three seconds, like the bar.
   */
  showBigTimer(at: { x: number; y: number; sizePx: number } | null, seconds: number): void {
    if (at === null) {
      this.bigTimer?.remove();
      this.bigTimer = null;
      return;
    }
    if (this.bigTimer === null) {
      this.bigTimer = document.createElement('div');
      this.bigTimer.className = 'big-timer';
      this.bannerRoot.append(this.bigTimer);
    }
    const text = String(seconds);
    const urgent = seconds <= 3;
    if (this.bigTimer.textContent !== text) {
      this.bigTimer.textContent = text;
      // A beat on every second of the last three, with the clock's tick — which starts at
      // five (`COUNTDOWN_FROM`), so the end is heard before it is seen. Restarted by
      // taking the class off and putting it back once the change has been seen.
      this.bigTimer.classList.remove('beat');
      if (urgent) {
        void this.bigTimer.offsetWidth;
        this.bigTimer.classList.add('beat');
      }
    }
    this.bigTimer.classList.toggle('urgent', urgent);
    this.bigTimer.style.left = `${at.x}px`;
    this.bigTimer.style.top = `${at.y}px`;
    this.bigTimer.style.fontSize = `${Math.round(at.sizePx * 0.75)}px`;
  }

  /** How many cannons are ready, beside the aiming cursor. Null hides it. */
  showReadyCount(at: { x: number; y: number } | null, count: number): void {
    if (at === null) {
      this.readyCount?.remove();
      this.readyCount = null;
      return;
    }
    if (this.readyCount === null) {
      this.readyCount = document.createElement('div');
      this.readyCount.className = 'ready-count';
      this.bannerRoot.append(this.readyCount);
    }
    const text = String(count);
    if (this.readyCount.textContent !== text) this.readyCount.textContent = text;
    this.readyCount.classList.toggle('none', count === 0);
    this.readyCount.style.left = `${at.x}px`;
    this.readyCount.style.top = `${at.y}px`;
  }

  /** Live banner nodes by player, kept across frames so their animation survives. */
  private readonly islandBanners = new Map<number, HTMLElement>();

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
    const text = title ?? PHASE_CALL[phase];
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
          ? '<i class="moved up" title="climbed">▲</i>'
          : r.moved < 0
            ? '<i class="moved down" title="dropped">▼</i>'
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
   * Banners sitting over the islands themselves: a life lost, or a player out.
   *
   * Placed rather than templated, because they move with the camera and rebuilding
   * them from a string every frame would restart their animation on every frame.
   */
  showIslandBanners(banners: IslandBanner[]): void {
    const wanted = new Map(banners.map((b) => [b.player, b]));

    for (const [player, node] of this.islandBanners) {
      if (wanted.has(player)) continue;
      node.remove();
      this.islandBanners.delete(player);
    }

    for (const banner of banners) {
      let node = this.islandBanners.get(banner.player);
      if (node === undefined) {
        node = document.createElement('div');
        node.className = 'island-banner';
        this.bannerRoot.append(node);
        this.islandBanners.set(banner.player, node);
      }
      const text = `${banner.title}|${banner.detail}`;
      if (node.dataset.text !== text) {
        node.dataset.text = text;
        const title = document.createElement('strong');
        title.textContent = banner.title;
        title.insertAdjacentHTML('afterbegin', shapeSvg(playerShape(banner.player), banner.colour));
        node.replaceChildren(title);
        if (banner.detail !== '') {
          const detail = document.createElement('small');
          detail.textContent = banner.detail;
          node.append(detail);
        }
      }
      // A new kind of news restarts the entrance, so a life lost after points were shown
      // lands as hard as one on its own. Only a new kind: points counting up change the
      // text every frame, and restarting then would replay the entrance every frame.
      if (node.dataset.kind !== banner.kind) {
        node.dataset.kind = banner.kind;
        node.className = `island-banner ${banner.kind}`;
        node.style.animationDuration = banner.kind === 'gain' ? `${banner.holdMs}ms` : '';
      }
      node.classList.toggle('urgent', banner.urgent);
      node.style.borderColor = banner.colour;
      node.style.left = `${banner.x}px`;
      node.style.top = `${banner.y}px`;
    }
  }

  /**
   * The HUD's frame, built once: the phase and the rest are rewritten every frame, the
   * roster is kept, so its entries can count up and slide rather than being replaced.
   */
  private frame: { phase: HTMLElement; roster: HTMLElement; rest: HTMLElement } | null = null;
  /** Roster entries by key — `p<player>` or `t<team>` — and the markup each last had. */
  private readonly entries = new Map<string, { node: HTMLElement; html: string }>();
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

  /**
   * The surprise at the end (PLAN 11.6): one line per bot, its colour, name, level and
   * personality in plain words.
   */
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
          award.player === humanPlayer ? 'You' : (state.players[award.player]?.name ?? '');
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
    if (this.rematchBy === 'mine') return '<button class="rematch">Rematch</button>';
    if (this.rematchBy === 'host') {
      return '<button class="rematch" disabled>Rematch — the host decides</button>';
    }
    return '';
  }

  private revealMarkup(): string {
    if (this.reveal.length === 0) return '';
    const lines = this.reveal
      .map(
        (r) =>
          `<li><b style="background:${playerCssColour(r.player)}"></b>${escape(r.name)} <span>${escape(r.text)}</span></li>`,
      )
      .join('');
    return `<div class="reveal"><small>How the bots played</small><ul>${lines}</ul></div>`;
  }

  /** Scores counting up, by the same keys. */
  private readonly counts = new Map<string, { from: number; to: number; since: number }>();

  private layout(): { phase: HTMLElement; roster: HTMLElement; rest: HTMLElement } {
    if (this.frame !== null && this.frame.roster.isConnected) return this.frame;
    this.root.innerHTML =
      '<div class="bar"><div class="phase"></div><ul class="roster"></ul></div>' +
      '<div class="hud-rest"></div>';
    this.entries.clear();
    this.frame = {
      phase: this.root.querySelector<HTMLElement>('.phase')!,
      roster: this.root.querySelector<HTMLElement>('.roster')!,
      rest: this.root.querySelector<HTMLElement>('.hud-rest')!,
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
    const start = first === 1 ? 'start' : `round ${first - 1}`;
    return (
      `<figure class="score-chart"><svg viewBox="-8 -8 ${width + 16} ${height + 16}" width="${width}" height="${height}">` +
      `<line x1="0" y1="${height}" x2="${width}" y2="${height}" class="axis"/>${lines}</svg>` +
      `<figcaption><span>${start}</span><span>points by round</span><span>round ${last}</span></figcaption></figure>`
    );
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
    const timebar =
      waiting || state.phase === 'game_over' || !showsClock(state)
        ? ''
        : `<div class="timebar${secondsLeft <= 3 ? ' urgent' : ''}"><i style="width:${(left * 100).toFixed(1)}%"></i></div>`;
    const human = state.players[humanPlayer];

    // The roster carries only what decides the match — points and lives (PLAN 11.15).
    // Castles and guns went: the board shows both, and the room they took makes the two
    // that matter large. One layout at every count, the name cut short to fit its card.
    // Lives are pips, one per life including the one being played, spent ones hollow:
    // the team's pool, in free-for-all a team of one. A pool too big for pips — a team of
    // three or four — is one pip and the count.
    const livesOf = (team: number, out: boolean): string => {
      if (out) return '<span class="lives out">out</span>';
      const pool = state.teams[team];
      const total = (pool?.continuesAtStart ?? 0) + 1;
      const left = (pool?.continuesRemaining ?? 0) + 1;
      const pips =
        total > 5 ? `●<small>${left}</small>` : '●'.repeat(left) + '○'.repeat(total - left);
      return `<span class="lives${left === 1 ? ' last' : ''}" title="${left} of ${total} lives">${pips}</span>`;
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
    const { phase: phaseRoot, roster: rosterRoot, rest } = this.layout();
    // Free-for-all in standing, best first, so a change of places slides; a team match
    // groups by team in team order, which never reshuffles, each headed by its letter,
    // score and pooled lives.
    let order: string[];
    if (teamed) {
      const teams = [...new Set(state.players.map((p) => p.team))].sort((a, b) => a - b);
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
    // The stylesheet sizes the figures by the width each entry has (`--entries`).
    rosterRoot.style.setProperty('--entries', String(order.length));

    // A player who has just spent a continue chooses a castle in the cannon phase
    // before any guns, so for them this phase is a castle choice first.
    const choosing =
      human !== undefined &&
      owesCastleChoice(human) &&
      (shown === 'cannon_place' || shown === 'castle_select');
    // Overtime: the clock has run out and one more piece may go down.
    const overtime = state.phase === 'build' && state.overtime;
    const label = choosing
      ? PHASE_LABEL.castle_select
      : overtime
        ? 'Overtime — last piece'
        : PHASE_LABEL[shown];

    let cannonCount = '';
    if (state.phase === 'cannon_place' && human && !human.eliminated) {
      const left = human.cannonsToPlace;
      cannonCount = choosing
        ? `<div class="counter">Choose a castle — then ${left} cannon${left === 1 ? '' : 's'} to place</div>`
        : left > 0
          ? `<div class="counter">${left} cannon${left === 1 ? '' : 's'} left to place</div>`
          : `<div class="counter done">All cannons placed</div>`;
    }

    // The labels over the islands live in the layer above this one, and at the end of a
    // match they sat on top of the summary; it says who was out, so they step aside.
    this.bannerRoot.classList.toggle('game-over', state.phase === 'game_over');
    let banner = '';
    if (state.phase === 'game_over') {
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
          : '<tr class="head"><td></td><td></td><td>points</td><td>wall</td>' +
            '<td>castles</td><td>lives left</td><td></td></tr>';
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
                `<td>${rank + 1}</td><td>${shapeSvg(playerShape(s.members[0] ?? 0), playerCssColour(s.members[0] ?? 0))}Team ${teamLetter(s.team)} · ${members}</td>` +
                `<td>${s.score}</td>${stats(s.members, s.team, s.eliminated)}<td>${s.eliminated ? 'out' : ''}</td></tr>`
              );
            })
            .join('')
        : standings(state)
            .map(
              (s, rank) =>
                `<tr class="${s.eliminated ? 'out' : ''}${s.player === humanPlayer ? ' you' : ''}">` +
                `<td>${rank + 1}</td><td>${shapeSvg(playerShape(s.player), playerCssColour(s.player))}${escape(s.name)}</td>` +
                `<td>${s.score}</td>${stats([s.player], state.players[s.player]?.team ?? s.player, s.eliminated)}<td>${s.eliminated ? 'out' : ''}</td></tr>`,
            )
            .join('');
      const table = `<table class="final">${head}${rows}</table>`;
      // A button, not a key: everything else in the game is the mouse, and a key that
      // does something unannounced is the kind of surprise players dislike.
      banner = `<div class="banner summary">${text}${table}${this.awardsMarkup(state, humanPlayer)}${this.chart(state, humanPlayer)}${this.revealMarkup()}<div class="end-buttons">${this.rematchButton()}<button class="leave">Back to menu</button></div></div>`;
    }
    this.showEndScreen(banner);
    phaseRoot.innerHTML =
      `<strong>${waiting ? `Next: ${label}` : label}</strong>` +
      // Hidden rather than removed, so the round label does not jump sideways every
      // intermission; and there is no clock to show once the match is over.
      (waiting || state.phase === 'game_over' || !showsClock(state)
        ? `<span class="timer" style="visibility:hidden">${secondsLeft.toFixed(1)}s</span>`
        : `<span class="timer">${secondsLeft.toFixed(1)}s</span>`) +
      `<span class="round${inFinalRound(state) ? ' final' : ''}">${roundLabel(state)}</span>`;
    // No piece box and no line of hints at the bottom: the test sessions found nobody
    // had time to look down there. The ghost at the cursor is the piece held, the
    // stamp over an island says who is out, and the phase label says overtime.
    rest.innerHTML = timebar + cannonCount + (status ? `<div class="net">${status}</div>` : '');
  }
}
