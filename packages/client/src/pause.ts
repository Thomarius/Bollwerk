import { escape } from './lobby.js';

/**
 * Pausing a match: a button beside the Sound switch, Esc, and an overlay saying who
 * paused with a button to resume. For the test sessions anyone at the table may pause and
 * anyone resume, with no limit (PLAN 11.12 F2). Esc is the one keyboard shortcut the game
 * keeps beyond the listed controls, being what games use for this; everything it does
 * also has something on screen to click.
 */

/** The overlay's line: who paused, from the viewer's side. */
export function pauseText(pausedBy: number, humanPlayer: number, names: readonly string[]): string {
  if (pausedBy === humanPlayer || pausedBy < 0) return 'You paused the match';
  const name = names[pausedBy];
  return name === undefined ? 'The match is paused' : `${name} paused the match`;
}

export class PauseControls {
  private readonly button: HTMLButtonElement;
  private readonly overlay: HTMLDivElement;
  /** What is on screen, so the DOM is touched only when it changes. */
  private shown: string | null = null;
  private paused = false;
  private over = false;
  private readonly key = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || this.over) return;
    event.preventDefault();
    this.toggle(!this.paused);
  };

  constructor(
    private readonly toggle: (paused: boolean) => void,
    private readonly click: () => void = () => {},
  ) {
    this.button = document.createElement('button');
    this.button.id = 'pause';
    this.button.textContent = 'Pause';
    this.button.title = 'Pause the match for everyone (Esc)';
    this.button.addEventListener('click', () => {
      this.click();
      this.toggle(!this.paused);
      // Off the button, so Space or Enter later cannot press it again unseen.
      this.button.blur();
    });

    this.overlay = document.createElement('div');
    this.overlay.className = 'pause-overlay';
    this.overlay.hidden = true;
    this.overlay.addEventListener('click', (event) => {
      if ((event.target as HTMLElement).closest('.resume')) {
        this.click();
        this.toggle(false);
      }
    });

    document.body.append(this.button, this.overlay);
    globalThis.addEventListener('keydown', this.key);
  }

  /** Called every frame with the match as it stands. */
  update(pausedBy: number | null, humanPlayer: number, names: readonly string[], over: boolean) {
    this.over = over;
    this.paused = pausedBy !== null;
    this.button.hidden = over;
    this.button.textContent = this.paused ? 'Resume' : 'Pause';
    const text = pausedBy === null || over ? null : pauseText(pausedBy, humanPlayer, names);
    if (text === this.shown) return;
    this.shown = text;
    this.overlay.hidden = text === null;
    this.overlay.innerHTML =
      text === null
        ? ''
        : `<div class="panel"><strong>Paused</strong><p>${escape(text)}</p>` +
          `<button class="resume">Resume</button><small>or press Esc</small></div>`;
  }

  destroy(): void {
    globalThis.removeEventListener('keydown', this.key);
    this.button.remove();
    this.overlay.remove();
  }
}
