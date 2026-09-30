import { playerCssColour } from './colours.js';
import type { BannerKind } from './banners.js';
import { escape } from './lobby.js';
import { defaultArtConfig, type ArtStyle } from '@rampart/config';

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
} from './scores.js';
import {
  PIECE_CATALOGUE,
  currentPieceId,
  owesCastleChoice,
  pieceCells,
  teamScore,
  upcomingPieceIds,
  type MatchState,
  type Phase,
} from '@rampart/sim';

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
};

/**
 * The HUD in each look (PLAN 11.11 W7): the bar, the clock, the piece box and the hints,
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

const PHASE_HINT: Record<Phase, string> = {
  lobby: '',
  intermission: '',
  castle_select: 'Click a castle on your island',
  combat: 'Click to fire the nearest ready cannon',
  build: 'Click to place · R / wheel / right-click to rotate',
  cannon_place: 'Click inside your own sealed territory',
  game_over: '',
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

/** A piece drawn as a small grid of cells, for the preview strip. */
function pieceSwatch(pieceId: number, colour: string, scale: number): string {
  const cells = pieceCells(pieceId, 0);
  const w = Math.max(...cells.map(([x]) => x)) + 1;
  const h = Math.max(...cells.map(([, y]) => y)) + 1;
  const boxes = cells
    .map(
      ([x, y]) =>
        `<i style="left:${x * scale}px;top:${y * scale}px;width:${scale - 1}px;height:${scale - 1}px;background:${colour}"></i>`,
    )
    .join('');
  return `<span class="swatch" style="width:${w * scale}px;height:${h * scale}px">${boxes}</span>`;
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

  private youAreHere: HTMLElement | null = null;

  /** The "You are here" marker over the viewer's island, or null to take it down. */
  showYouAreHere(at: { x: number; y: number; colour: string } | null): void {
    if (at === null) {
      this.youAreHere?.remove();
      this.youAreHere = null;
      return;
    }
    if (this.youAreHere === null || !this.youAreHere.isConnected) {
      this.youAreHere = document.createElement('div');
      this.youAreHere.className = 'you-are-here';
      this.youAreHere.textContent = 'You are here';
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
   */
  useSkin(style: ArtStyle): void {
    const skin = HUD_SKIN[style];
    if (skin === this.skin) return;
    if (this.skin !== null) this.root.classList.remove(this.skin);
    this.root.classList.add(skin);
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
  private markFinalRound(final: boolean): void {
    this.bannerRoot.classList.toggle('final-round', final);
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

  /** What the end screen's button does: back to the menu, whether played or watched. */
  onLeave(handler: () => void): void {
    this.leave = handler;
  }

  private showEndScreen(html: string): void {
    if (this.endScreen === null || !this.endScreen.isConnected) {
      this.endScreen = document.createElement('div');
      this.endScreen.className = 'end-screen';
      this.endScreen.addEventListener('click', (event) => {
        if ((event.target as HTMLElement).closest('.leave')) this.leave?.();
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
      node.style.left = `${tag.x}px`;
      node.style.top = `${tag.y}px`;
    }
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
    const screen = this.bannerRoot.clientHeight;
    const height = banner.offsetHeight;
    const top = -height + progress * (screen + height);
    banner.style.transform = `translateY(${top.toFixed(1)}px)`;
    return top + height / 2;
  }

  clearAnnouncement(): void {
    this.phaseCall?.remove();
    this.phaseCall = null;
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
        return `<path d="${d}" stroke="${playerCssColour(ids[0] ?? 0)}" stroke-width="${mine ? 3 : 1.5}" fill="none" stroke-linejoin="round"/>`;
      })
      .join('');
    // The lines start from nought, before the first round seen: the start of the match,
    // or where a client that joined part-way came in.
    const first = log.scores[0]?.round ?? 1;
    const last = log.scores.at(-1)?.round ?? first;
    const start = first === 1 ? 'start' : `round ${first - 1}`;
    return (
      `<figure class="score-chart"><svg viewBox="-4 -4 ${width + 8} ${height + 8}" width="${width}" height="${height}">` +
      `<line x1="0" y1="${height}" x2="${width}" y2="${height}" class="axis"/>${lines}</svg>` +
      `<figcaption><span>${start}</span><span>points by round</span><span>round ${last}</span></figcaption></figure>`
    );
  }

  /** `sealed` is castles enclosed as the board stands now, which the sim's count is not. */
  update(
    state: MatchState,
    humanPlayer: number,
    status = '',
    sealed: readonly number[] = state.players.map((p) => p.enclosedCastles),
  ): void {
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
    const colour = playerCssColour(humanPlayer);

    // Lives as pips, one per life including the one being played, spent ones hollow:
    // read at a glance across a roster, where "2 lives" had to be read word by word.
    // They are the team's pool — in free-for-all a team of one, so the player's own.
    const livesOf = (team: number): string => {
      const pool = state.teams[team];
      const total = (pool?.continuesAtStart ?? 0) + 1;
      const left = (pool?.continuesRemaining ?? 0) + 1;
      const pips = '●'.repeat(left) + '○'.repeat(Math.max(0, total - left));
      return `<span class="lives${left === 1 ? ' last' : ''}" title="${left} of ${total} lives">${pips}</span>`;
    };
    // The compact roster's lives: one pip and the count, red on the last. A pip a life ran
    // the eighth entry off the screen (PLAN 11.5).
    const livesCount = (team: number): string => {
      const left = (state.teams[team]?.continuesRemaining ?? 0) + 1;
      return `<span class="lives${left === 1 ? ' last' : ''}">●${left}</span>`;
    };
    const livesWords = (team: number): string => {
      const pool = state.teams[team];
      const left = (pool?.continuesRemaining ?? 0) + 1;
      return `${left} of ${(pool?.continuesAtStart ?? 0) + 1} lives`;
    };
    const teamed = isTeamMatch(state);
    const now = performance.now();
    // Past four players in free-for-all, icons rather than words, so eight entries fit
    // one line of the bar: at eight the words wrapped each onto three, under the time bar.
    // Even so the eighth ran 44 pixels off a 1280-pixel screen and 300 off a 1024 one, so
    // the compact entry carries only what changes — score, castles, guns firing, lives —
    // with long names cut short, the rest on hover, and shrinks to fit (PLAN 11.5).
    const compact = !teamed && state.players.length > 4;
    const playerItem = (p: (typeof state.players)[number]): string => {
      const cannons = state.cannons.filter((c) => c.owner === p.id);
      const live = cannons.filter((c) => c.active).length;
      const classes = ['player', p.eliminated ? 'out' : '', p.id === humanPlayer ? 'you' : '']
        .filter(Boolean)
        .join(' ');
      const held = sealed[p.id] ?? 0;
      const castles = `${held} castle${held === 1 ? '' : 's'}`;
      const guns = `${live}/${cannons.length} guns`;
      const score = this.shownScore(`p${p.id}`, p.score, now);
      // In a team match the score and lives belong to the team, so they head its group.
      // Past four players a team's members get only their names: their team's score and
      // lives head the group, their castles fly banners on the board, and the details
      // wrapped a crowded bar onto two lines.
      const status = p.eliminated
        ? `${compact ? 'out' : 'eliminated'} round ${p.eliminatedRound}`
        : teamed && state.players.length > 4
          ? ''
          : teamed
            ? `${castles} · ${guns}`
            : compact
              ? `<em>${score}</em> <i>♜</i>${held} <i>⊙</i>${live} ${livesCount(p.team)}`
              : `${score} pts · ${castles} · ${guns} · ${livesOf(p.team)}`;
      const title = compact
        ? ` title="${escape(p.name)}${p.eliminated ? '' : ` · ${score} pts · ${castles} · ${guns} · ${livesWords(p.team)}`}"`
        : '';
      return `<li class="${classes}"${title}><b style="background:${playerCssColour(p.id)}"></b><bdi>${escape(p.name)}</bdi><span>${status}</span></li>`;
    };
    const { phase: phaseRoot, roster: rosterRoot, rest } = this.layout();
    rosterRoot.classList.toggle('compact', compact);
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
        const score = this.shownScore(`t${team}`, teamScore(state, team), now);
        this.entry(
          `t${team}`,
          `<li class="team${out ? ' out' : ''}${mine ? ' mine' : ''}">` +
            `<div class="team-head"><b class="letter">${teamLetter(team)}</b>${score} pts · ${out ? 'out' : livesOf(team)}</div>` +
            `<ul>${members.map(playerItem).join('')}</ul></li>`,
        );
      }
      order = teams.map((team) => `t${team}`);
    } else {
      for (const p of state.players) this.entry(`p${p.id}`, playerItem(p));
      order = standings(state).map((s) => `p${s.player}`);
    }
    this.placeEntries(rosterRoot, order);

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

    let queue = '';
    // In overtime there is no next piece to preview, and once the last is down nothing
    // to hold either.
    if (
      state.phase === 'build' &&
      human &&
      !human.eliminated &&
      !(overtime && human.overtimeSpent)
    ) {
      const next = overtime
        ? []
        : upcomingPieceIds(state, humanPlayer, state.ruleset.build.previewCount);
      queue =
        `<div class="queue"><span class="label">Holding</span>${pieceSwatch(currentPieceId(state, humanPlayer), colour, 11)}` +
        (next.length > 0
          ? `<span class="label">Next</span>${next.map((id) => pieceSwatch(id, colour, 7)).join('')}`
          : '') +
        `</div>`;
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
                `<td>${rank + 1}</td><td>Team ${teamLetter(s.team)} · ${members}</td>` +
                `<td>${s.score}</td>${stats(s.members, s.team, s.eliminated)}<td>${s.eliminated ? 'out' : ''}</td></tr>`
              );
            })
            .join('')
        : standings(state)
            .map(
              (s, rank) =>
                `<tr class="${s.eliminated ? 'out' : ''}${s.player === humanPlayer ? ' you' : ''}">` +
                `<td>${rank + 1}</td><td><b style="background:${playerCssColour(s.player)}"></b>${escape(s.name)}</td>` +
                `<td>${s.score}</td>${stats([s.player], state.players[s.player]?.team ?? s.player, s.eliminated)}<td>${s.eliminated ? 'out' : ''}</td></tr>`,
            )
            .join('');
      const table = `<table class="final">${head}${rows}</table>`;
      // A button, not a key: everything else in the game is the mouse, and a key that
      // does something unannounced is the kind of surprise players dislike.
      banner = `<div class="banner summary">${text}${table}${this.chart(state, humanPlayer)}${this.revealMarkup()}<button class="leave">Back to menu</button></div>`;
    }
    this.showEndScreen(banner);
    // Knocked out: the stamp over your island is the moment, so this is only a quiet
    // line where the controls hint was — a banner in the middle of the screen covered
    // the very match you were left to watch, for the rest of it.
    const hint = human?.eliminated
      ? `Knocked out in round ${human.eliminatedRound} · watching the rest`
      : humanPlayer < 0
        ? ''
        : choosing && !waiting
          ? PHASE_HINT.castle_select
          : overtime
            ? human?.overtimeSpent
              ? 'Last piece placed'
              : 'Place the piece you are holding · no more after it'
            : PHASE_HINT[state.phase];

    phaseRoot.innerHTML =
      `<strong>${waiting ? `Next: ${label}` : label}</strong>` +
      // Hidden rather than removed, so the round label does not jump sideways every
      // intermission; and there is no clock to show once the match is over.
      (waiting || state.phase === 'game_over' || !showsClock(state)
        ? `<span class="timer" style="visibility:hidden">${secondsLeft.toFixed(1)}s</span>`
        : `<span class="timer">${secondsLeft.toFixed(1)}s</span>`) +
      `<span class="round${inFinalRound(state) ? ' final' : ''}">${roundLabel(state)}</span>`;
    rest.innerHTML =
      timebar +
      queue +
      cannonCount +
      `<div class="hint">${hint}</div>` +
      (status ? `<div class="net">${status}</div>` : '');
  }
}

export const PIECE_COUNT = PIECE_CATALOGUE.length;
