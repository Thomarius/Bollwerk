import type { ArtStyle, MusicTrack, SfxCue } from '@bollwerk/config';
import type { MatchEvent, MatchState, Phase } from '@bollwerk/sim';
import { describe, expect, it } from 'vitest';

import { MatchAudio, type Cues } from './matchAudio.js';
import type { Look } from './transition.js';

/** Records what was asked for, in order. */
class Recorder implements Cues {
  readonly sfx: SfxCue[] = [];
  readonly gains: number[] = [];
  readonly delays: number[] = [];
  readonly tracks: (MusicTrack | null)[] = [];
  play(cue: SfxCue, gain = 1, delayMs = 0): void {
    this.sfx.push(cue);
    this.gains.push(gain);
    this.delays.push(delayMs);
  }
  music(cue: MusicTrack | null): void {
    this.tracks.push(cue);
  }
}

const HUMAN = 0;

function setup(humanPlayer = HUMAN): { audio: Recorder; match: MatchAudio } {
  const audio = new Recorder();
  return { audio, match: new MatchAudio(audio, humanPlayer) };
}

function phase(next: Phase, pending: Phase | null = null, round = 1): MatchEvent {
  return {
    kind: 'phase_changed',
    tick: 0,
    phase: next,
    round,
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
      {
        kind: 'cannon_placed',
        tick: 1,
        player: HUMAN,
        cannonId: 0,
        x: 3,
        y: 3,
        cannonKind: 'cannon',
        cannonCost: 1,
      },
      {
        kind: 'cannon_placed',
        tick: 1,
        player: 1,
        cannonId: 1,
        x: 9,
        y: 9,
        cannonKind: 'cannon',
        cannonCost: 1,
      },
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

  it('sounds it for the overtime’s last piece, which ends the round in the same step', () => {
    const { audio, match } = setup();
    const board = {
      phase: 'intermission',
      players: [{ islandId: 1 }],
      castles: [{ id: 0, islandId: 1 }],
    } as unknown as MatchState;
    // The events began in the build phase and end in the intermission the piece brought on:
    // asked before they are handled, so still building, wherever the steps were taken.
    match.handle([phase('build')]);
    match.sealed(board, [false], [true]);
    expect(audio.sfx).toEqual(['enclosure_success']);
    // Events wholly outside building stay silent.
    match.handle([phase('intermission', 'cannon_place')]);
    match.sealed(board, [false], [true]);
    expect(audio.sfx).toHaveLength(1);
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
          gunPoints: 0,
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
            gunPoints: 0,
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
            gunPoints: 0,
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

describe('special towers in the sound', () => {
  const shot = (
    id: number,
    kind: 'cannon' | 'bertha' | 'rapid' | 'lightning' | 'biggest' | 'laser' | 'frost' | 'lullaby',
  ): MatchEvent => ({
    kind: 'shot_fired',
    tick: 1,
    shot: {
      id,
      cannonId: id,
      owner: 1,
      kind,
      cost: kind === 'cannon' ? 1 : 3,
      fromX: 0,
      fromY: 0,
      toX: 5,
      toY: 5,
      launchTick: 1,
      impactTick: 40,
    },
  });
  const landed = (shotId: number): MatchEvent => ({
    kind: 'shot_impact',
    tick: 40,
    shotId,
    x: 5,
    y: 5,
    destroyed: [],
  });

  it('fires Big Bertha and the Rapid Cannon as a cannon, Bertha landing with her own', () => {
    const { audio, match } = setup();
    match.handle([shot(1, 'bertha'), shot(2, 'cannon'), shot(3, 'rapid')]);
    match.handle([landed(2), landed(1), landed(3)]);
    expect(audio.sfx).toEqual([
      'cannon_fire',
      'cannon_fire',
      'cannon_fire',
      'shot_impact',
      'tower_impact',
      'shot_impact',
    ]);
  });

  it('fires the Allerdickste Bertha as a cannon, her landing the biggest of all', () => {
    const { audio, match } = setup();
    match.handle([shot(5, 'biggest'), shot(6, 'bertha')]);
    match.handle([landed(6), landed(5)]);
    expect(audio.sfx).toEqual([
      'cannon_fire',
      'cannon_fire',
      'tower_impact',
      'tower_biggest_impact',
    ]);
  });

  it('sounds a Lightning Tower once as it strikes, not for each jump', () => {
    const { audio, match } = setup();
    match.handle([
      shot(4, 'lightning'),
      {
        kind: 'lightning_struck',
        tick: 1,
        shotId: 4,
        owner: 1,
        fromX: 0,
        fromY: 0,
        path: [
          { x: 5, y: 5 },
          { x: 6, y: 5 },
          { x: 7, y: 5 },
        ],
        destroyed: [1, 2, 3],
      },
    ]);
    expect(audio.sfx).toEqual(['lightning_strike']);
  });

  it('sounds a Laser Tower once as it fires, however many walls it burns', () => {
    const { audio, match } = setup();
    match.handle([
      shot(7, 'laser'),
      {
        kind: 'laser_fired',
        tick: 1,
        shotId: 7,
        owner: 1,
        fromX: 0,
        fromY: 0,
        endX: 9,
        endY: 5,
        destroyed: [1, 2, 3],
      },
    ]);
    expect(audio.sfx).toEqual(['laser_fire']);
  });

  it('lands a Frost Cannon as a cannon, its freeze heard over the impact', () => {
    const { audio, match } = setup();
    match.handle([shot(8, 'frost')]);
    match.handle([landed(8), { kind: 'tile_frozen', tick: 40, shotId: 8, owner: 1, tile: 105 }]);
    expect(audio.sfx).toEqual(['cannon_fire', 'shot_impact', 'frost_impact']);
  });

  it('lands a Lullaby Tower as a cannon, its lullaby heard over the impact when a gun sleeps', () => {
    const { audio, match } = setup();
    match.handle([shot(9, 'lullaby')]);
    match.handle([
      landed(9),
      { kind: 'gun_slept', tick: 40, shotId: 9, owner: 1, cannonId: 3, until: 130, ms: 3000 },
    ]);
    expect(audio.sfx).toEqual(['cannon_fire', 'shot_impact', 'lullaby']);
  });

  it('hears Subwoofers once a tick however many fire, and not again within half a second', () => {
    const { audio, match } = setup();
    const wave = (id: number, tick: number): MatchEvent => ({
      kind: 'wave_sent',
      tick,
      wave: { id, cannonId: id, owner: 1, cost: 3, lanes: [], launchTick: tick },
    });
    match.handle([wave(1, 90), wave(2, 90), wave(3, 90)]);
    match.handle([wave(4, 100)]);
    match.handle([wave(5, 105)]);
    expect(audio.sfx).toEqual(['subwoofer', 'subwoofer']);
  });

  it('knocks twice for each of the player’s own Architects that rebuilt, not a rival’s', () => {
    const { audio, match } = setup();
    match.handle([
      { kind: 'walls_repaired', tick: 5, player: 1, tiles: [3], towers: 1, thawed: [] },
      { kind: 'walls_repaired', tick: 5, player: HUMAN, tiles: [4, 5], towers: 2, thawed: [] },
    ]);
    expect(audio.sfx).toEqual(Array(4).fill('walls_repaired'));
    expect(audio.delays).toEqual([0, 300, 600, 900]);
  });
});

describe('the styles’ own tracks', () => {
  /** A match whose looks are `looks`, with the rolls given in turn (0 wins at any chance). */
  function styled(
    looks: Record<Look, ArtStyle>,
    rolls: number[],
    chance = 0.5,
  ): { audio: Recorder; match: MatchAudio; looks: Record<Look, ArtStyle> } {
    const audio = new Recorder();
    const match = new MatchAudio(audio, HUMAN, {
      rules: { chance, pauseRounds: 3, hasTrack: (style) => style !== 'pixel' },
      styleOf: (look) => looks[look],
      roll: () => rolls.shift() ?? 0.99,
    });
    return { audio, match, looks };
  }

  /** One round from its build look's start: building, the cannons, then combat. */
  const round = (r: number): MatchEvent[] => [
    phase('intermission', 'build', r),
    phase('build', null, r),
    phase('intermission', 'cannon_place', r),
    phase('cannon_place', null, r),
    phase('intermission', 'combat', r),
    phase('combat', null, r + 1),
  ];

  it('plays a style’s track for the whole build look, cannons included', () => {
    const { audio, match } = styled({ build: 'opera', combat: 'noir' }, [0, 0.99]);
    match.handle(round(1));
    expect(audio.tracks).toEqual([
      'style:opera',
      'style:opera',
      'style:opera',
      'style:opera',
      'music_battle',
      'music_battle',
    ]);
  });

  it('rolls once a look, not at every phase within it', () => {
    const rolls = [0.99, 0];
    const { audio, match } = styled({ build: 'opera', combat: 'opera' }, rolls);
    match.handle(round(1));
    // The build look lost its roll; the cannon phase does not roll again, combat does.
    expect(audio.tracks.slice(0, 4)).toEqual(Array(4).fill('music_admin'));
    expect(audio.tracks.slice(4)).toEqual(['style:opera', 'style:opera']);
  });

  it('leaves combat the shared music when the same style won as building began', () => {
    const { audio, match } = styled({ build: 'opera', combat: 'opera' }, [], 1);
    match.handle(round(1));
    expect(audio.tracks.at(0)).toBe('style:opera');
    expect(audio.tracks.at(-1)).toBe('music_battle');
  });

  it('holds a style back for three rounds after it played', () => {
    const { audio, match } = styled({ build: 'opera', combat: 'pixel' }, [], 1);
    const builds: (MusicTrack | null)[] = [];
    for (let r = 1; r <= 6; r++) {
      const at = audio.tracks.length;
      match.handle(round(r));
      builds.push(audio.tracks[at] ?? null);
    }
    expect(builds).toEqual([
      'style:opera',
      'music_admin',
      'music_admin',
      'music_admin',
      'style:opera',
      'music_admin',
    ]);
  });

  it('never plays one for a style without its own', () => {
    const { audio, match } = styled({ build: 'pixel', combat: 'pixel' }, [], 1);
    match.handle(round(1));
    expect(audio.tracks).not.toContainEqual(expect.stringMatching(/^style:/));
  });

  it('rolls again when the pause menu changes the look under way', () => {
    const { audio, match, looks } = styled({ build: 'opera', combat: 'noir' }, [0.99, 0], 0.5);
    match.handle([phase('build', null, 1)]);
    expect(audio.tracks).toEqual(['music_admin']);
    looks.build = 'anime';
    match.restyled();
    expect(audio.tracks).toEqual(['music_admin', 'style:anime']);
    // A change to the other look leaves this one's music alone.
    looks.combat = 'sakura';
    match.restyled();
    expect(audio.tracks).toHaveLength(2);
  });

  it('takes a chance changed mid-match at the next look, the track playing left alone', () => {
    const audio = new Recorder();
    let chance = 1;
    const match = new MatchAudio(audio, HUMAN, {
      rules: {
        get chance() {
          return chance;
        },
        pauseRounds: 3,
        hasTrack: (style) => style !== 'pixel',
      },
      styleOf: (look) => (look === 'build' ? 'opera' : 'noir'),
      roll: () => 0,
    });
    match.handle([phase('build', null, 1)]);
    // Never, chosen in the pause menu: building's track plays on, combat's is the shared one.
    chance = 0;
    match.handle([phase('cannon_place', null, 1)]);
    match.handle([phase('combat', null, 2)]);
    expect(audio.tracks).toEqual(['style:opera', 'style:opera', 'music_battle']);
  });

  it('gives way to victory’s music, and starts a look afresh after', () => {
    const { audio, match } = styled({ build: 'opera', combat: 'noir' }, [], 1);
    match.handle([phase('combat', null, 1)]);
    match.handle([
      { kind: 'game_over', tick: 9, winners: [HUMAN], draw: false, endedBy: 'elimination' },
    ]);
    expect(audio.tracks).toEqual(['style:noir', 'music_victory']);
  });
});
