import type { MusicCue, SfxCue } from '@rampart/config';
import type { MatchEvent, MatchState, Phase } from '@rampart/sim';

/**
 * The part of the audio player this needs.
 *
 * Narrowed to two methods so the translation from match to cue can be tested without
 * a browser, an audio context or a single sound file — which is the whole of the
 * logic worth testing here.
 */
export interface Cues {
  play(cue: SfxCue): void;
  music(cue: MusicCue | null): void;
}

/**
 * Turns a match into sound.
 *
 * Everything here is driven by simulation events rather than by the client's own
 * guesses, so what a player hears is what actually happened on the authoritative
 * server — a shot confirmed, a wall that really came down, a castle genuinely sealed.
 * The one exception is the countdown, which is a clock reading and has no event.
 */

/**
 * One track per mood.
 *
 * Castle select, cannon placement and building are the same experience from the
 * player's side — arranging a position with nothing incoming — so they share a track
 * and only the barrage gets its own.
 */
function trackFor(phase: Phase): MusicCue | null {
  switch (phase) {
    case 'lobby':
      return 'music_menu';
    case 'castle_select':
    case 'cannon_place':
    case 'build':
      return 'music_admin';
    case 'combat':
      return 'music_battle';
    default:
      return null;
  }
}

/** Seconds of a phase left when the clock starts being audible. */
const COUNTDOWN_FROM = 3;

export class MatchAudio {
  private phase: Phase | null = null;
  private countedAt = -1;

  constructor(
    private readonly audio: Cues,
    private readonly humanPlayer: number,
  ) {}

  /** True when there is nobody at the keyboard, so nothing is "yours". */
  private get watching(): boolean {
    return this.humanPlayer < 0;
  }

  handle(events: readonly MatchEvent[]): void {
    for (const event of events) {
      switch (event.kind) {
        case 'phase_changed':
          this.phaseChanged(event.phase, event.pendingPhase);
          break;

        case 'shot_fired':
          this.audio.play('cannon_fire');
          break;

        case 'shot_impact':
          // One explosion whatever it hits: a separate cue for a wall was planned and
          // dropped by the user, the impact's sound being enough.
          this.audio.play('shot_impact');
          break;

        // Confirmations of the player's own choices, and only theirs — a rival's
        // placement is not something to acknowledge.
        case 'castle_selected':
          if (event.player === this.humanPlayer) this.audio.play('select');
          break;
        case 'cannon_placed':
          if (event.player === this.humanPlayer) this.audio.play('place_cannon');
          break;
        case 'piece_placed':
          if (event.player === this.humanPlayer) this.audio.play('piece_place');
          break;

        case 'player_eliminated':
          this.audio.play('player_eliminated');
          break;

        case 'round_resolved':
          this.resolved(event.results);
          break;

        case 'game_over':
          // A draw is every survivor eliminated together, which nobody won. A shared
          // win on points is still a win for each of them.
          this.audio.music(
            this.watching
              ? event.draw
                ? 'music_defeat'
                : 'music_victory'
              : event.winners.includes(this.humanPlayer)
                ? 'music_victory'
                : 'music_defeat',
          );
          break;

        default:
          break;
      }
    }
  }

  private phaseChanged(phase: Phase, pending: Phase | null): void {
    const previous = this.phase;
    this.phase = phase;
    this.countedAt = -1;

    // During an intermission the next phase's track starts early, so the music leads
    // into the announcement rather than arriving after it.
    const track =
      phase === 'intermission' && pending !== null ? trackFor(pending) : trackFor(phase);
    if (track !== null) this.audio.music(track);

    if (phase === 'combat') this.audio.play('voice_fire');
    // Combat ends by stepping into the intermission: the shots already in the air
    // still land, but no further one can be started, which is what the call means.
    if (phase === 'intermission' && previous === 'combat') this.audio.play('voice_cease_fire');
  }

  /**
   * A round that ends with nothing of the player's sealed: the life it costs them.
   *
   * Judged on "nothing sealed" rather than on holding fewer castles than last round —
   * going from two castles to one is still a sealed round, not a failure. Being knocked
   * out has its own cue and is not crowded with this one.
   */
  private resolved(
    results: readonly { player: number; enclosedCastles: number; eliminated: boolean }[],
  ): void {
    if (this.watching) return;
    const mine = results.find((r) => r.player === this.humanPlayer);
    if (mine === undefined || mine.eliminated) return;
    if (mine.enclosedCastles === 0) this.audio.play('enclosure_failed');
  }

  /**
   * The fanfare, the moment a wall closes round one of the player's castles while
   * building — a breach repaired or new ground taken — as the board stands, which is
   * what the flood of new territory shows at the same instant.
   *
   * It used to wait for the resolution and sound only when the player held more castles
   * than the round before, so the usual round — breached, repaired, holding the same one
   * castle — made no sound at all, and the one time it did play, at the end of round
   * one, it was lost under the scoring. Only while building: a castle chosen after a
   * continue is sealed by its ring, which is not the player's doing and has its own cue.
   */
  sealed(
    state: Pick<MatchState, 'phase' | 'castles' | 'players'>,
    before: readonly boolean[],
    after: readonly boolean[],
  ): void {
    if (this.watching || state.phase !== 'build') return;
    const island = state.players[this.humanPlayer]?.islandId;
    const newlySealed = state.castles.some(
      (castle) => castle.islandId === island && after[castle.id] === true && !before[castle.id],
    );
    if (newlySealed) this.audio.play('enclosure_success');
  }

  /**
   * The clock, which is the one cue with no event behind it.
   *
   * Called every frame, and fires once per whole second over the last few — the build
   * phase deadline is the tensest moment in a round and it is otherwise silent.
   */
  frame(state: MatchState): void {
    if (state.phase === 'intermission' || state.phase === 'game_over' || state.phase === 'lobby') {
      return;
    }
    const ticksLeft = state.phaseEndTick - state.tick;
    if (ticksLeft <= 0) return;
    const secondsLeft = Math.ceil(ticksLeft / state.ruleset.tickRateHz);
    if (secondsLeft > COUNTDOWN_FROM || secondsLeft === this.countedAt) return;
    this.countedAt = secondsLeft;
    this.audio.play('countdown_tick');
  }
}
