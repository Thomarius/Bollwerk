import { defaultConfigBundle } from '@bollwerk/config';

import { app, showError } from './app.js';
import { demoSetup, idleDue, rollDemoTable, tableCaption } from './demoTable.js';
import { t } from './i18n.js';
import { withIcon } from './icons.js';
import { runSession } from './matchScreen.js';
import { showMenu } from './menu.js';
import { preferredStyles, saveName } from './prefs.js';
import { localMatchFor, localSession } from './session.js';

/**
 * The demo (2026-10-29, the user's design; an attract mode, once dropped in ARCHIVE 11w as
 * too much work, cheap now that a match can be watched): after the bare menu has stood
 * untouched for a while, or from the corner's Demo button, bots play behind it like a
 * screensaver — a random small table, the looks as the menu has them, the menu's music
 * playing on and no sounds, no summary, the winners' camera shot and then the next match,
 * without end. A left click anywhere but the corner's buttons, or Esc, brings the menu back.
 * Never recorded: `recordings/` is the user's tuning data.
 */

const DEMO = defaultConfigBundle.art.demo;

/** The menu with nothing over it: no Options, How to play, Credits or gallery. */
function bareMenu(): boolean {
  if (app?.firstElementChild?.matches('.menu.home') !== true) return false;
  return document.querySelector('.how-to-play, .look-gallery') === null;
}

/** How often the corner's button and the idle clock look at the page. */
const CHECK_MS = 250;

let running: Demo | null = null;

/**
 * The corner's Demo button, beside Sound and Full screen on the bare menu only, and the
 * idle clock behind it; once, as the page starts.
 */
export function installDemo(): void {
  const button = document.createElement('button');
  button.id = 'demo';
  button.hidden = true;
  const label = (): void => {
    button.innerHTML = withIcon('eye', t('demo.button'));
    button.dataset.tip = t('demo.buttonTitle');
    button.dataset.tipSide = 'right';
  };
  label();
  button.addEventListener('click', () => {
    button.blur();
    startDemo();
  });
  (document.querySelector('#corner') ?? document.body).append(button);

  let since = performance.now();
  const touched = (): void => {
    since = performance.now();
  };
  for (const kind of ['pointermove', 'pointerdown', 'keydown', 'wheel'] as const) {
    globalThis.addEventListener(kind, touched, { capture: true, passive: true });
  }
  let shownLabel = '';
  setInterval(() => {
    const bare = running === null && bareMenu();
    if (button.hidden === bare) button.hidden = !bare;
    // The language may have changed in Options.
    if (bare && shownLabel !== t('demo.button')) {
      shownLabel = t('demo.button');
      label();
    }
    // The clock runs only at the bare menu, in front: anything else starts it afresh.
    const now = performance.now();
    if (!bare || document.hidden || !document.hasFocus()) since = now;
    else if (idleDue(since, now, DEMO.idleMs)) startDemo();
  }, CHECK_MS);
}

/** Into the demo from the menu; `?demo=1` too. */
export function startDemo(): void {
  if (running !== null) return;
  // A name typed but not yet saved would go with the menu.
  const typed = document.querySelector<HTMLInputElement>('#name')?.value.trim();
  if (typed && typed !== t('menu.defaultName')) saveName(typed);
  running = new Demo();
  void running.start();
}

/** Resolves once what is on the page has been painted. */
function painted(): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

class Demo {
  /** Black over everything between the menu and a match, and between matches. */
  private readonly fade = document.createElement('div');
  /** The table's caption, and the way back. */
  private readonly overlay = document.createElement('div');
  /** Takes the running match down. */
  private stop: (() => void) | null = null;
  /** The match being made, so leaving waits for it rather than racing it. */
  private pending: Promise<void> = Promise.resolve();
  private match = 0;
  private hold: ReturnType<typeof setTimeout> | undefined;
  private captionTimer: ReturnType<typeof setTimeout> | undefined;
  private quitting = false;

  private readonly pointer = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    // Sound and Full screen work as ever.
    const target = event.target instanceof Element ? event.target : null;
    if (target !== null && target.closest('#corner') !== null) return;
    event.preventDefault();
    event.stopPropagation();
    void this.quit();
  };

  private readonly key = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    void this.quit();
  };

  constructor() {
    this.fade.className = 'demo-fade';
    this.overlay.className = 'demo-overlay';
    this.overlay.innerHTML =
      `<div class="demo-caption"><strong></strong><span></span></div>` +
      `<div class="demo-strip">${t('demo.back')}</div>`;
    document.body.append(this.fade, this.overlay);
    globalThis.addEventListener('pointerdown', this.pointer, { capture: true });
    globalThis.addEventListener('keydown', this.key, { capture: true });
  }

  async start(): Promise<void> {
    await this.fadeTo(1, DEMO.fadeMs);
    if (this.quitting) return;
    this.pending = this.next();
  }

  /** The next match, made behind black and faded in. */
  private async next(): Promise<void> {
    const match = ++this.match;
    this.stop?.();
    this.stop = null;
    this.overlay.classList.remove('captioned');
    const table = rollDemoTable(Math.random);
    const setup = demoSetup(table, preferredStyles(), t('menu.defaultName'));
    let stop: () => void;
    try {
      stop = await runSession(localSession(localMatchFor(setup, false)), setup, {
        demo: true,
        finished: () => {
          this.hold = setTimeout(() => {
            if (match === this.match && !this.quitting) this.pending = this.again();
          }, DEMO.winnerHoldMs);
        },
      });
    } catch (error) {
      this.close();
      showError(t('error.failedToStart'), error);
      return;
    }
    this.stop = stop;
    if (this.quitting) return;
    const [shape, towers] = tableCaption(table);
    this.overlay.querySelector('.demo-caption strong')!.textContent = shape;
    this.overlay.querySelector('.demo-caption span')!.textContent = towers;
    this.overlay.classList.add('captioned');
    clearTimeout(this.captionTimer);
    this.captionTimer = setTimeout(
      () => this.overlay.classList.remove('captioned'),
      DEMO.captionMs,
    );
    await painted();
    await this.fadeTo(0, DEMO.fadeMs);
  }

  private async again(): Promise<void> {
    await this.fadeTo(1, DEMO.fadeMs);
    if (!this.quitting) await this.next();
  }

  /** Back to the menu, through a short black. */
  private async quit(): Promise<void> {
    if (this.quitting) return;
    this.quitting = true;
    clearTimeout(this.hold);
    globalThis.removeEventListener('pointerdown', this.pointer, { capture: true });
    globalThis.removeEventListener('keydown', this.key, { capture: true });
    await this.fadeTo(1, DEMO.quitFadeMs);
    // A match still being made is taken down once it stands.
    await this.pending;
    this.stop?.();
    this.stop = null;
    showMenu();
    await painted();
    await this.fadeTo(0, DEMO.quitFadeMs);
    this.close();
  }

  private close(): void {
    clearTimeout(this.hold);
    clearTimeout(this.captionTimer);
    globalThis.removeEventListener('pointerdown', this.pointer, { capture: true });
    globalThis.removeEventListener('keydown', this.key, { capture: true });
    this.fade.remove();
    this.overlay.remove();
    running = null;
  }

  private async fadeTo(opacity: number, ms: number): Promise<void> {
    this.fade.style.transitionDuration = `${ms}ms`;
    // Read once, so the change below is a transition from what stands now.
    void this.fade.offsetWidth;
    this.fade.style.opacity = String(opacity);
    await wait(ms);
  }
}
