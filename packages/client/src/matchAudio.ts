import {
  styleTrack,
  type ArtStyle,
  type MusicCue,
  type MusicTrack,
  type SfxCue,
} from '@bollwerk/config';
import type { MatchEvent, MatchState, Phase } from '@bollwerk/sim';

import { COUNTDOWN_FROM, countdownGain, showsClock } from './clock.js';
import { chooseStyleTrack, type StylePauses, type StyleTrackRules } from './styleMusic.js';
import type { Look } from './transition.js';

/**
 * The part of the audio player this needs.
 *
 * Narrowed to two methods so the translation from match to cue can be tested without
 * a browser, an audio context or a single sound file — which is the whole of the
 * logic worth testing here.
 */
export interface Cues {
  /**
   * `gain` scales the cue's own volume, for the countdown's rise; `delayMs` starts it that much
   * later, for an Architect's double knock.
   */
  play(cue: SfxCue, gain?: number, delayMs?: number): void;
  music(cue: MusicTrack | null): void;
}

/**
 * The styles' own tracks (ARCHIVE 14za): the rules, the style each look is drawn
 * in as it comes on screen, and the roll — the page's own, `Math.random`, since music is no
 * part of the simulation and two players at one table may hear different tracks.
 */
export interface StyleMusic {
  rules: StyleTrackRules;
  styleOf: (look: Look) => ArtStyle;
  roll: () => number;
}

/** The shared track a look's span plays, which a style's own may stand in for. */
const LOOK_TRACK: Record<Look, MusicCue> = { build: 'music_admin', combat: 'music_battle' };

/** A span of one look's music: its look, its round and its style, and what it chose. */
interface Span {
  look: Look;
  round: number;
  style: ArtStyle;
  track: MusicTrack;
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

/** Between the knocks of an Architect's repair. */
const KNOCK_MS = 300;

export class MatchAudio {
  private phase: Phase | null = null;
  private countedAt = -1;
  /** Either Bertha's shots in the air, by id, with the cue of each one's heavier landing. */
  private readonly heavy = new Map<number, SfxCue>();
  /** The last shot whose lullaby was heard, so several guns asleep to one shot sound once. */
  private lullabied = -1;
  /** The look whose music is playing, or null for the menu's, victory's or defeat's. */
  private span: Span | null = null;
  /** When each style's track last played, for its pause; afresh every match. */
  private pauses: StylePauses = new Map();

  constructor(
    private readonly audio: Cues,
    private readonly humanPlayer: number,
    private readonly styles: StyleMusic | null = null,
  ) {}

  /** True when there is nobody at the keyboard, so nothing is "yours". */
  private get watching(): boolean {
    return this.humanPlayer < 0;
  }

  handle(events: readonly MatchEvent[]): void {
    for (const event of events) {
      switch (event.kind) {
        case 'phase_changed':
          this.phaseChanged(event.phase, event.pendingPhase, event.round);
          break;

        case 'shot_fired':
          // Every gun but the Lightning and Laser Towers fires with a cannon's sound, Big Bertha
          // and the Rapid Cannon too (the user's, 2026-10-17); either Bertha's shot is kept for
          // its landing. The other two are heard as they strike, on the same tick.
          if (event.shot.kind === 'lightning' || event.shot.kind === 'laser') break;
          if (event.shot.kind === 'bertha') this.heavy.set(event.shot.id, 'tower_impact');
          if (event.shot.kind === 'biggest') this.heavy.set(event.shot.id, 'tower_biggest_impact');
          this.audio.play('cannon_fire');
          break;

        case 'shot_impact':
          // One explosion whatever it hits: a separate cue for a wall was planned and
          // dropped by the user, the impact's sound being enough.
          this.audio.play(this.heavy.get(event.shotId) ?? 'shot_impact');
          this.heavy.delete(event.shotId);
          break;

        case 'lightning_struck':
          // Once a strike, however many walls it jumps to.
          this.audio.play('lightning_strike');
          break;

        case 'gun_slept':
          // The lullaby over the shot's own impact, played on the same tick, when a gun falls
          // asleep (the user's tower_lullaby.mp3, 2026-10-21) — once a shot, however many sleep.
          if (this.lullabied === event.shotId) break;
          this.lullabied = event.shotId;
          this.audio.play('lullaby');
          break;

        case 'tile_frozen':
          // The freeze over the shot's own impact, which `shot_impact` has played on the same
          // tick (the user's tower_frost.mp3, 2026-10-21).
          this.audio.play('frost_impact');
          break;

        case 'laser_fired':
          // Once a beam, however many walls it burns through (the user's tower_laser.mp3).
          this.audio.play('laser_fire');
          break;

        case 'walls_repaired':
          // The player's own Architects at work, each that rebuilt anything twice, every knock
          // 0.3 s after the last (the user's, 2026-10-17); a rival's go unheard, as their
          // pieces do.
          if (event.player === this.humanPlayer || this.watching) {
            for (let k = 0; k < 2 * event.towers; k++) {
              this.audio.play('walls_repaired', 1, k * KNOCK_MS);
            }
          }
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
          this.span = null;
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

  private phaseChanged(phase: Phase, pending: Phase | null, round: number): void {
    const previous = this.phase;
    this.phase = phase;
    this.countedAt = -1;

    // During an intermission the next phase's track starts early, so the music leads
    // into the announcement rather than arriving after it.
    const early = phase === 'intermission' && pending !== null;
    const track = early ? trackFor(pending) : trackFor(phase);
    if (track !== null) this.audio.music(this.lookMusic(track, round, early));

    if (phase === 'combat') this.audio.play('voice_fire');
    // Combat ends by stepping into the intermission: the shots already in the air
    // still land, but no further one can be started, which is what the call means.
    if (phase === 'intermission' && previous === 'combat') this.audio.play('voice_cease_fire');
  }

  /**
   * The track for a phase's shared one: a look's span goes on with what it chose as its
   * phases follow one another (castle selection, building and the cannons are one build
   * look), and a span starting rolls for its style's own track.
   *
   * A span is in the round as it stands once its phase has begun: combat is where the sim
   * counts a round up, and its music is chosen `early`, in the intermission before.
   */
  private lookMusic(track: MusicCue, round: number, early: boolean): MusicTrack {
    const look = (['build', 'combat'] as const).find((l) => LOOK_TRACK[l] === track);
    if (look === undefined) {
      this.span = null;
      return track;
    }
    if (this.span?.look === look) return this.span.track;
    return this.startSpan(look, look === 'combat' && early ? round + 1 : round).track;
  }

  private startSpan(look: Look, round: number): Span {
    const shared = LOOK_TRACK[look];
    if (this.styles === null) {
      this.span = { look, round, style: 'flat', track: shared };
      return this.span;
    }
    const style = this.styles.styleOf(look);
    const chosen = chooseStyleTrack(
      style,
      round,
      this.pauses,
      this.styles.rules,
      this.styles.roll(),
    );
    this.pauses = chosen.pauses;
    this.span = { look, round, style, track: chosen.plays ? styleTrack(style) : shared };
    return this.span;
  }

  /**
   * The looks changed from the pause menu: the span under way rolls again as its look would
   * have, if that look's style changed — one changed to while its pause runs plays the
   * shared music (ARCHIVE 14za).
   */
  restyled(): void {
    const span = this.span;
    if (span === null || this.styles === null) return;
    if (this.styles.styleOf(span.look) === span.style) return;
    this.audio.music(this.startSpan(span.look, span.round).track);
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
   *
   * Asked before `handle` is given the same events, so `phase` is still the phase they began
   * in: the last piece of an overtime ends the round in the step that seals with it, and the
   * board already reads the intermission (play-testing, 2026-10-16). The phase the frame
   * began in was asked once, which missed it all the same where the steps are not taken in the
   * frame — a local match's bots in their worker step the match as it answers, between frames,
   * so the frame began in the intermission already (play-testing, 2026-10-19).
   */
  sealed(
    state: Pick<MatchState, 'phase' | 'castles' | 'players'>,
    before: readonly boolean[],
    after: readonly boolean[],
  ): void {
    const building = state.phase === 'build' || this.phase === 'build';
    if (this.watching || !building) return;
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
    // Overtime shows no clock (`showsClock`), so it has no countdown either.
    if (!showsClock(state)) return;
    const ticksLeft = state.phaseEndTick - state.tick;
    if (ticksLeft <= 0) return;
    const secondsLeft = Math.ceil(ticksLeft / state.ruleset.tickRateHz);
    if (secondsLeft > COUNTDOWN_FROM || secondsLeft === this.countedAt) return;
    this.countedAt = secondsLeft;
    this.audio.play('countdown_tick', countdownGain(secondsLeft));
  }
}
