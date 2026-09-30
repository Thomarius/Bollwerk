import type { MatchState } from '@rampart/sim';

/**
 * Whether a phase's clock is shown — the HUD's figures and bar, and the big timer in the
 * sea. Not in overtime: its window of a few seconds counted down again from 3 straight
 * after the build clock had reached 0, which testers read as the build phase starting
 * over. The clock stops at 0 and goes; the red border and the HUD's words carry overtime.
 */
export function showsClock(state: Pick<MatchState, 'phase' | 'overtime'>): boolean {
  return !(state.phase === 'build' && state.overtime);
}

/** Seconds of countdown ticks at the end of a phase. */
export const COUNTDOWN_FROM = 5;
/** The first tick's loudness against the last's, which plays at the cue's full volume. */
const COUNTDOWN_QUIETEST = 0.35;

/**
 * The loudness of the countdown tick with `secondsLeft` whole seconds to go, as a share
 * of the cue's volume: quiet at five, rising evenly to full at one. The big timer turns
 * red only at three, so the end is heard coming before it is seen.
 */
export function countdownGain(secondsLeft: number): number {
  const steps = COUNTDOWN_FROM - 1;
  const done = Math.min(steps, Math.max(0, COUNTDOWN_FROM - secondsLeft));
  return COUNTDOWN_QUIETEST + ((1 - COUNTDOWN_QUIETEST) * done) / steps;
}
