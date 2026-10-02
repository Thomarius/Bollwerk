import { isTeamMatch } from './scores.js';
import type { MatchState } from '@rampart/sim';

/**
 * Out, and watching (PLAN 11.18 Y3): a player knocked out stays to see the match finish,
 * or goes. Their island greys and its banner says so as it happens; this strip stands at
 * the bottom of the screen from then until the end, with the way back to the menu — no
 * asking twice, since there is nothing left to lose.
 */

/** What the strip says, or null when it is not shown: not out, a spectator, or over. */
export function watchingText(state: MatchState, humanPlayer: number): string | null {
  const me = state.players[humanPlayer];
  if (me === undefined || !me.eliminated || state.phase === 'game_over') return null;
  return isTeamMatch(state) ? 'Your team is out — watching' : "You're out — watching";
}

export class WatchingStrip {
  private readonly node = document.createElement('div');
  private shown: string | null = null;

  constructor(leave: () => void) {
    this.node.className = 'watching';
    this.node.hidden = true;
    this.node.innerHTML = '<span></span><button class="leave-watching">Back to menu</button>';
    this.node.querySelector('button')?.addEventListener('click', leave);
    document.body.append(this.node);
  }

  update(state: MatchState, humanPlayer: number): void {
    const text = watchingText(state, humanPlayer);
    if (text === this.shown) return;
    this.shown = text;
    this.node.hidden = text === null;
    const line = this.node.querySelector('span');
    if (line !== null) line.textContent = text ?? '';
  }

  destroy(): void {
    this.node.remove();
  }
}
