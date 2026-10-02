import type { MusicCue, SfxCue } from '@bollwerk/config';
import type { MatchEvent, MatchState, Phase } from '@bollwerk/sim';
import { describe, expect, it } from 'vitest';

import { MatchAudio, type Cues } from './matchAudio.js';

/** Records what was asked for, in order. */
class Recorder implements Cues {
  readonly sfx: SfxCue[] = [];
  readonly gains: number[] = [];
  readonly tracks: (MusicCue | null)[] = [];
  play(cue: SfxCue, gain = 1): void {
    this.sfx.push(cue);
    this.gains.push(gain);
  }
  music(cue: MusicCue | null): void {
    this.tracks.push(cue);
  }
}

const HUMAN = 0;

function setup(humanPlayer = HUMAN): { audio: Recorder; match: MatchAudio } {
  const audio = new Recorder();
  return { audio, match: new MatchAudio(audio, humanPlayer) };
}

function phase(next: Phase, pending: Phase | null = null): MatchEvent {
  return {
    kind: 'phase_changed',
    tick: 0,
    phase: next,
    round: 1,
    phaseEndTick: 300,
    pendingPhase: pending,
  };
}

/** Only the fields the countdown reads. */
function clock(current: Phase, tick: number, phaseEndTick: number, overtime = false): MatchState {
  return {
    phase: current,
    overtime,
    tick,
    phaseEndTick,
    ruleset: { tickRateHz: 30 },
  } as unknown as MatchState;
}

describe('match audio', () => {
  it('calls the barrage in and out', () => {
    const { audio, match } = setup();
    match.handle([phase('combat')]);
    expect(audio.sfx).toEqual(['voice_fire']);

    // Combat ends by stepping into the intermission: shots in the air still land, but
    // no further one can be started, which is what "cease fire" means.
    match.handle([phase('intermission', 'build')]);
    expect(audio.sfx).toEqual(['voice_fire', 'voice_cease_fire']);
  });

  it('does not call cease fire when an intermission follows anything else', () => {
    const { audio, match } = setup();
    match.handle([phase('build'), phase('intermission', 'cannon_place')]);
    expect(audio.sfx).not.toContain('voice_cease_fire');
  });

  it('starts the next phase’s music during the intermission before it', () => {
    const { audio, match } = setup();
    // The music leads into the announcement rather than arriving after it.
    match.handle([phase('build'), phase('intermission', 'combat')]);
    expect(audio.tracks).toEqual(['music_admin', 'music_battle']);
  });

  it('shares one track across the phases that feel the same', () => {
    const { audio, match } = setup();
    match.handle([phase('castle_select'), phase('cannon_place'), phase('build')]);
    expect(audio.tracks).toEqual(['music_admin', 'music_admin', 'music_admin']);
  });

  it('plays one explosion for every impact, whether or not it took a block out', () => {
    const { audio, match } = setup();
    match.handle([{ kind: 'shot_impact', tick: 1, shotId: 1, x: 3, y: 4, destroyed: [] }]);
    match.handle([{ kind: 'shot_impact', tick: 2, shotId: 2, x: 5, y: 6, destroyed: [77] }]);
    expect(audio.sfx).toEqual(['shot_impact', 'shot_impact']);
  });

  it('acknowledges only the player’s own placements', () => {
    const { audio, match } = setup();
    match.handle([
      { kind: 'piece_placed', tick: 1, player: HUMAN, pieceId: 0, rotation: 0, cells: [] },
      { kind: 'piece_placed', tick: 1, player: 1, pieceId: 0, rotation: 0, cells: [] },
    ]);
    expect(audio.sfx).toEqual(['piece_place']);
  });

  it('sets a cannon down with its own sound, not the menu click', () => {
    const { audio, match } = setup();
    match.handle([
      { kind: 'cannon_placed', tick: 1, player: HUMAN, cannonId: 0, x: 3, y: 3 },
      { kind: 'cannon_placed', tick: 1, player: 1, cannonId: 1, x: 9, y: 9 },
      { kind: 'castle_selected', tick: 1, player: HUMAN, castleId: 0 },
    ]);
    // A rival's cannon is not acknowledged; a castle chosen is still a plain selection.
    expect(audio.sfx).toEqual(['place_cannon', 'select']);
  });

  it('sounds the fanfare the moment a wall closes round one of the player’s castles', () => {
    const { audio, match } = setup();
    // Player 0 owns island 1 and castles 0 and 1; castle 2 is a rival's.
    const board = (phase: Phase) =>
      ({
        phase,
        players: [{ islandId: 1 }, { islandId: 2 }],
        castles: [
          { id: 0, islandId: 1 },
          { id: 1, islandId: 1 },
          { id: 2, islandId: 2 },
        ],
      }) as unknown as MatchState;

    // A breach repaired: castle 0 unsealed, then sealed again.
    match.sealed(board('build'), [false, false, false], [true, false, false]);
    expect(audio.sfx).toEqual(['enclosure_success']);
    // Holding it is not news, and neither is a rival sealing theirs.
    match.sealed(board('build'), [true, false, false], [true, false, true]);
    expect(audio.sfx).toEqual(['enclosure_success']);
    // A second castle taken is news again.
    match.sealed(board('build'), [true, false, true], [true, true, true]);
    expect(audio.sfx).toEqual(['enclosure_success', 'enclosure_success']);
    // Outside building — the ring a chosen castle comes with — it is not the player's doing.
    match.sealed(board('cannon_place'), [false, false, false], [true, false, false]);
    expect(audio.sfx).toHaveLength(2);
  });

  it('sounds the failure for a round that ends with nothing sealed', () => {
    const { audio, match } = setup();
    const resolved = (enclosedCastles: number): MatchEvent => ({
      kind: 'round_resolved',
      tick: 1,
      round: 1,
      results: [
        {
          player: HUMAN,
          enclosedCastles,
          cannonsAwarded: 2,
          eliminated: false,
          territoryPoints: 0,
          damagePoints: 0,
        },
      ],
    });
    // Holding a castle, one or several, is no failure — two down to one included.
    match.handle([resolved(2), resolved(1)]);
    expect(audio.sfx).toEqual([]);
    // Nothing sealed: the round that costs a life.
    match.handle([resolved(0)]);
    expect(audio.sfx).toEqual(['enclosure_failed']);
  });

  it('leaves an elimination to its own cue rather than crowding it', () => {
    const { audio, match } = setup();
    match.handle([
      {
        kind: 'round_resolved',
        tick: 1,
        round: 3,
        results: [
          {
            player: HUMAN,
            enclosedCastles: 0,
            cannonsAwarded: 0,
            eliminated: true,
            territoryPoints: 0,
            damagePoints: 0,
          },
        ],
      },
      { kind: 'player_eliminated', tick: 1, player: HUMAN, round: 3 },
    ]);
    expect(audio.sfx).toEqual(['player_eliminated']);
  });

  it('plays victory only for the player who actually won', () => {
    const won = setup();
    won.match.handle([
      { kind: 'game_over', tick: 1, winners: [HUMAN], draw: false, endedBy: 'elimination' },
    ]);
    expect(won.audio.tracks).toEqual(['music_victory']);

    const lost = setup();
    lost.match.handle([
      { kind: 'game_over', tick: 1, winners: [1], draw: false, endedBy: 'elimination' },
    ]);
    expect(lost.audio.tracks).toEqual(['music_defeat']);

    // A shared win on points is a win for each player who shares it.
    const shared = setup();
    shared.match.handle([
      { kind: 'game_over', tick: 1, winners: [1, HUMAN], draw: false, endedBy: 'round_cap' },
    ]);
    expect(shared.audio.tracks).toEqual(['music_victory']);

    // A draw is every survivor eliminated together, which nobody won.
    const drawn = setup();
    drawn.match.handle([
      { kind: 'game_over', tick: 1, winners: [], draw: true, endedBy: 'elimination' },
    ]);
    expect(drawn.audio.tracks).toEqual(['music_defeat']);
  });

  it('says nothing personal in a watched match', () => {
    const { audio, match } = setup(-1);
    match.handle([
      {
        kind: 'round_resolved',
        tick: 1,
        round: 1,
        results: [
          {
            player: 0,
            enclosedCastles: 2,
            cannonsAwarded: 3,
            eliminated: false,
            territoryPoints: 0,
            damagePoints: 0,
          },
        ],
      },
    ]);
    expect(audio.sfx).toEqual([]);
  });

  it('ticks once per second over the last seconds of a phase', () => {
    const { audio, match } = setup();
    match.handle([phase('build')]);
    // 30Hz, ending at tick 300: the countdown starts with five seconds to go.
    for (let tick = 90; tick < 300; tick++) match.frame(clock('build', tick, 300));
    expect(audio.sfx.filter((c) => c === 'countdown_tick')).toHaveLength(5);
    // Louder with every tick.
    for (let i = 1; i < audio.gains.length; i++) {
      expect(audio.gains[i]).toBeGreaterThan(audio.gains[i - 1]!);
    }
  });

  it('does not tick through overtime, which shows no clock', () => {
    const { audio, match } = setup();
    match.handle([phase('build')]);
    for (let tick = 210; tick < 300; tick++) match.frame(clock('build', tick, 300, true));
    expect(audio.sfx).not.toContain('countdown_tick');
  });

  it('does not tick through an intermission, which is not a deadline', () => {
    const { audio, match } = setup();
    match.handle([phase('intermission', 'build')]);
    for (let tick = 280; tick < 300; tick++) match.frame(clock('intermission', tick, 300));
    expect(audio.sfx).not.toContain('countdown_tick');
  });
});
