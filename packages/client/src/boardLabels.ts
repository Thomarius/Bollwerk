import { playerShape, shapeSvg } from './shapes.js';
import type { BannerKind } from './banners.js';
import { t } from './i18n.js';
import { type PlayerShape } from '@bollwerk/config';

/**
 * What the HUD stands over the board, kept across frames rather than rebuilt so its
 * animations survive: the "You are here" marker, the team tags, the big timer, the ready
 * count at the cursor and each island's banner. All in the banner layer, placed in screen
 * pixels the scene works out.
 */

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

export class BoardLabels {
  constructor(
    private readonly root: HTMLElement,
    private readonly bannerRoot: HTMLElement,
  ) {}

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
      this.youAreHere.innerHTML = `${shapeSvg(at.shape, at.colour)}${t('hud.youAreHere')}`;
      this.bannerRoot.append(this.youAreHere);
    }
    // Light text in a border of the player's colour: crimson text on the dark box did
    // not read.
    this.youAreHere.style.setProperty('--who', at.colour);
    this.youAreHere.style.left = `${at.x.toFixed(1)}px`;
    this.youAreHere.style.top = `${at.y.toFixed(1)}px`;
  }

  /** A team's letter over each of its islands, for the whole of a team match. */
  private teamTags = new Map<number, HTMLElement>();

  showTeamTags(
    tags: readonly { player: number; text: string; colour: string; x: number; y: number }[],
  ): void {
    const nodes = tags.map((tag) => {
      let node = this.teamTags.get(tag.player);
      if (node === undefined) {
        node = document.createElement('div');
        node.className = 'team-tag';
        node.textContent = tag.text;
        this.bannerRoot.append(node);
        this.teamTags.set(tag.player, node);
      }
      return node;
    });
    // Every size read before any position is written: a read after a write lays the page
    // out again, and that was once a tag, every frame of a team match.
    const margin = 4;
    const bar = this.barBottom();
    const width = this.bannerRoot.clientWidth;
    const sizes = nodes.map((node) => ({ half: node.offsetWidth / 2, high: node.offsetHeight }));
    tags.forEach((tag, k) => {
      const node = nodes[k] as HTMLElement;
      const { half, high } = sizes[k] as { half: number; high: number };
      // Kept on screen and below the bar: the tags grew (testers missed the small ones),
      // and over an island at the window's edge or in the top row they ran off it or
      // under the roster. Hung from their bottom middle, as the stylesheet places them.
      const x = Math.min(Math.max(tag.x, half + margin), width - half - margin);
      setStyle(node, 'borderColor', tag.colour);
      setStyle(node, 'left', `${x}px`);
      setStyle(node, 'top', `${Math.max(tag.y, bar + high + margin)}px`);
    });
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
}

/**
 * Writes a style only when it changes: the labels over the board are placed every frame.
 * Compared with what was last written, not read back, which the browser normalises.
 */
const written = new WeakMap<HTMLElement, Map<string, string>>();
function setStyle(
  node: HTMLElement,
  property: 'borderColor' | 'left' | 'top',
  value: string,
): void {
  let last = written.get(node);
  if (last === undefined) written.set(node, (last = new Map()));
  if (last.get(property) === value) return;
  last.set(property, value);
  node.style[property] = value;
}
