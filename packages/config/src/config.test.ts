import { describe, expect, it } from 'vitest';

import {
  type AudioManifest,
  ArtConfigSchema,
  AudioManifestSchema,
  audioCredits,
  creditFor,
  artForStyle,
  chooseStyle,
  hueOf,
  STYLE_LOOKS,
  stylesFor,
  MUSIC_CUES,
  RulesetSchema,
  SFX_CUES,
  ServerConfigSchema,
  TerrainConfigSchema,
  assertValidConfigBundle,
  defaultArtConfig,
  defaultAudioManifest,
  defaultConfigBundle,
  defaultRuleset,
  defaultServerConfig,
  defaultTerrainConfig,
  applySettings,
  defaultTeams,
  teamsBalanced,
  validPlayerCounts,
  defaultSettings,
  mergeSettings,
  validateConfigBundle,
} from './index.js';

describe('shipped config files', () => {
  it('all parse against their schemas', () => {
    expect(defaultRuleset.tickRateHz).toBe(30);
    expect(defaultTerrainConfig.patterns).toHaveLength(7);
    expect(defaultArtConfig.players.length).toBeGreaterThanOrEqual(defaultRuleset.players.max);
    expect(defaultServerConfig.port).toBe(8080);
  });

  it('encode the agreed design decisions', () => {
    // The one self-correcting force in the game.
    expect(defaultRuleset.cannons.inertWhenNotEnclosed).toBe(true);
    // 1 castle -> 2 cannons, each further castle -> +1.
    expect(defaultRuleset.cannons.firstCastleReward).toBe(2);
    expect(defaultRuleset.cannons.perAdditionalCastleReward).toBe(1);
    // Not shared, because a continue rewinds one player's piece schedule to round one
    // and theirs alone. The schema refuses the two together, so this is the consequence
    // of resetPieceScheduleOnContinue rather than a free choice.
    expect(defaultRuleset.elimination.resetPieceScheduleOnContinue).toBe(true);
    expect(defaultRuleset.build.sharedPieceSequence).toBe(false);
    // Two lives beyond the first, as in the original.
    expect(defaultRuleset.elimination.continues).toBe(2);
    expect(defaultRuleset.build.restrictToOwnIsland).toBe(true);
  });

  it('pass cross-file validation', () => {
    expect(validateConfigBundle(defaultConfigBundle)).toEqual([]);
  });
});

describe('schema strictness', () => {
  it('rejects unknown keys rather than silently ignoring them', () => {
    const withTypo = { ...defaultRuleset, tickRateHZ: 60 };
    expect(RulesetSchema.safeParse(withTypo).success).toBe(false);
  });

  it('rejects a malformed colour', () => {
    const bad = {
      ...defaultArtConfig,
      palette: { ...defaultArtConfig.palette, waterDeep: 'blue' },
    };
    expect(ArtConfigSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a player range that cannot be satisfied', () => {
    const bad = { ...defaultRuleset, players: { min: 4, max: 2 } };
    expect(RulesetSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects an island larger than the map', () => {
    const bad = {
      ...defaultTerrainConfig,
      island: { ...defaultTerrainConfig.island, targetAreaTiles: 999_999 },
    };
    expect(TerrainConfigSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects an out-of-range port', () => {
    expect(ServerConfigSchema.safeParse({ ...defaultServerConfig, port: 0 }).success).toBe(false);
  });
});

describe('audio manifest', () => {
  it('covers every cue the code can trigger', () => {
    for (const cue of SFX_CUES) expect(defaultAudioManifest.sfx[cue]).toBeDefined();
    for (const cue of MUSIC_CUES) expect(defaultAudioManifest.music[cue]).toBeDefined();
  });

  it('rejects a cue name the code does not know about', () => {
    const bad = {
      ...defaultAudioManifest,
      sfx: { ...defaultAudioManifest.sfx, dragon_roar: { file: 'x.ogg', volume: 1 } },
    };
    expect(AudioManifestSchema.safeParse(bad).success).toBe(false);
  });

  it('reports a missing cue through bundle validation', () => {
    const { cannon_fire: _dropped, ...sfx } = defaultAudioManifest.sfx;
    const problems = validateConfigBundle({
      ...defaultConfigBundle,
      audio: { ...defaultAudioManifest, sfx: sfx as AudioManifest['sfx'] },
    });
    expect(problems).toContain('audio: missing sfx cue "cannon_fire".');
  });

  const credit = {
    title: 'Click',
    author: 'Someone',
    licence: 'CC0',
    source: 'https://opengameart.org/content/click',
  };

  it('reports a credit for a file no cue loads', () => {
    // shot_impact has nine variants; a tenth is a typo, and the file it meant goes uncredited.
    const problems = validateConfigBundle({
      ...defaultConfigBundle,
      audio: { ...defaultAudioManifest, credits: { 'sfx/shot_impact.10.wav': credit } },
    } as typeof defaultConfigBundle);
    expect(problems).toContain('audio: a credit for "sfx/shot_impact.10.wav", which no cue loads.');
  });

  it('reports a folder credit that covers no file a cue loads', () => {
    const problems = validateConfigBundle({
      ...defaultConfigBundle,
      audio: { ...defaultAudioManifest, credits: { 'voices/': credit, 'sfx/': credit } },
    } as typeof defaultConfigBundle);
    expect(problems).toContain('audio: a credit for "voices/", which no cue loads.');
    expect(problems).not.toContain('audio: a credit for "sfx/", which no cue loads.');
  });

  it('lets a folder credit cover its files, giving way to a file of its own', () => {
    const own = { ...credit, title: 'Own' };
    const audio = {
      ...defaultAudioManifest,
      credits: { 'sfx/': credit, 'sfx/cannon_fire.2.ogg': own },
    } as AudioManifest;
    expect(creditFor(audio, 'sfx/select.wav')).toBe(credit);
    expect(creditFor(audio, 'sfx/cannon_fire.2.ogg')).toBe(own);
    expect(creditFor(audio, 'music/music_menu.mp3')).toBeNull();
    const { sfx } = audioCredits(audio);
    // One line for the folder where its first file stands, and the file with its own.
    expect(sfx.map((line) => line.path)).toEqual(['sfx/', 'sfx/cannon_fire.2.ogg']);
  });

  it('takes only the licences it can link, and a source that is an address', () => {
    const withCredit = (c: object) =>
      AudioManifestSchema.safeParse({ ...defaultAudioManifest, credits: { 'sfx/select.wav': c } })
        .success;
    expect(withCredit(credit)).toBe(true);
    expect(withCredit({ ...credit, licence: 'free' })).toBe(false);
    expect(withCredit({ ...credit, source: 'opengameart' })).toBe(false);
  });
});

describe('cross-file validation', () => {
  it('catches an island that would fill its generation box', () => {
    // The box is a frame to draw in and it needs slack: an island that nearly fills it
    // has its coastline pinned by the frame rather than by the noise, and every seed
    // then produces the same map. That generates perfectly and looks fine in a single
    // screenshot, which is exactly why it is worth a startup error.
    const island = defaultTerrainConfig.island;
    const problems = validateConfigBundle({
      ...defaultConfigBundle,
      terrain: {
        ...defaultTerrainConfig,
        island: { ...island, targetAreaTiles: island.boxWidth * island.boxHeight - 1 },
      },
    });
    expect(problems.some((p) => p.includes('no room to vary between seeds'))).toBe(true);
  });

  it('catches a player count with nowhere to put the islands', () => {
    const problems = validateConfigBundle({
      ...defaultConfigBundle,
      terrain: {
        ...defaultTerrainConfig,
        patterns: defaultTerrainConfig.patterns.filter((pattern) => pattern.players !== 3),
      },
    });
    expect(problems).toContain('terrain: no island pattern for 3 players.');
  });

  it('catches too few player palettes for the allowed player count', () => {
    const problems = validateConfigBundle({
      ...defaultConfigBundle,
      art: { ...defaultArtConfig, players: defaultArtConfig.players.slice(0, 2) },
    });
    expect(problems.some((p) => p.startsWith('art:'))).toBe(true);
  });

  it('catches too few player shapes for the allowed player count', () => {
    const problems = validateConfigBundle({
      ...defaultConfigBundle,
      art: { ...defaultArtConfig, playerShapes: defaultArtConfig.playerShapes.slice(0, 2) },
    });
    expect(problems.some((p) => p.includes('player shapes'))).toBe(true);
  });

  it('refuses a shape listed twice', () => {
    const shapes = ['circle', 'circle', ...defaultArtConfig.playerShapes.slice(2)];
    const result = ArtConfigSchema.safeParse({ ...defaultArtConfig, playerShapes: shapes });
    expect(result.success).toBe(false);
  });

  it('catches a starting wall ring too large for the island', () => {
    const problems = validateConfigBundle({
      ...defaultConfigBundle,
      terrain: {
        ...defaultTerrainConfig,
        startingWall: { ringRadiusTiles: 40 },
      },
    });
    expect(problems.some((p) => p.includes('starting wall ring'))).toBe(true);
  });

  it('throws with every problem listed at once', () => {
    expect(() =>
      assertValidConfigBundle({
        ...defaultConfigBundle,
        art: { ...defaultArtConfig, players: [] as never },
        terrain: { ...defaultTerrainConfig, startingWall: { ringRadiusTiles: 40 } },
      }),
    ).toThrow(/Invalid configuration/);
  });
});

describe('lobby settings', () => {
  const bounds = { maxRounds: { min: 5, max: 20 }, teamSize: { min: 1, max: 4 } };
  const ffa = (maxRounds: number) => ({ maxRounds, teamSize: 1 });

  it('opens on the ruleset cap, pulled inside the bounds, as free-for-all', () => {
    const rules = (maxRounds: number | null) => ({
      ...defaultRuleset,
      scoring: { ...defaultRuleset.scoring, maxRounds },
    });
    expect(defaultSettings(rules(10), bounds)).toEqual(ffa(10));
    expect(defaultSettings(rules(99), bounds)).toEqual(ffa(20));
    // Uncapped is a testing setup; a room cannot offer it, so it opens at the longest.
    expect(defaultSettings(rules(null), bounds)).toEqual(ffa(20));
  });

  it('refuses a change outside the bounds rather than clamping it', () => {
    expect(mergeSettings(ffa(10), { maxRounds: 7 }, bounds)).toEqual(ffa(7));
    expect(mergeSettings(ffa(10), { maxRounds: 21 }, bounds)).toBeNull();
    expect(mergeSettings(ffa(10), { maxRounds: 4 }, bounds)).toBeNull();
    expect(mergeSettings(ffa(10), { teamSize: 2 }, bounds)).toEqual({ maxRounds: 10, teamSize: 2 });
    expect(mergeSettings(ffa(10), { teamSize: 5 }, bounds)).toBeNull();
  });

  it('applies over the ruleset and re-validates the result', () => {
    expect(applySettings(defaultRuleset, ffa(7)).scoring.maxRounds).toBe(7);
    expect(() => applySettings(defaultRuleset, ffa(0))).toThrow();
  });

  it('allows only player counts that make at least two equal teams', () => {
    const players = { min: 2, max: 8 };
    expect(validPlayerCounts(1, players)).toEqual([2, 3, 4, 5, 6, 7, 8]);
    expect(validPlayerCounts(2, players)).toEqual([4, 6, 8]);
    expect(validPlayerCounts(3, players)).toEqual([6]);
    expect(validPlayerCounts(4, players)).toEqual([8]);
  });

  it('seats teams in order, and knows a balanced assignment from an unbalanced one', () => {
    expect(defaultTeams(4, 2)).toEqual([0, 0, 1, 1]);
    expect(defaultTeams(3, 1)).toEqual([0, 1, 2]);
    expect(teamsBalanced([0, 1, 1, 0], 2)).toBe(true);
    expect(teamsBalanced([0, 0, 0, 1], 2)).toBe(false);
    expect(teamsBalanced([0, 0], 2)).toBe(false); // one team is not a match
    expect(teamsBalanced([0, 2, 0, 2], 2)).toBe(false); // teams are numbered from 0
  });

  it("insists the bounds include the ruleset's own cap", () => {
    const problems = validateConfigBundle({
      ...defaultConfigBundle,
      server: {
        ...defaultServerConfig,
        lobbySettings: { maxRounds: { min: 12, max: 20 }, teamSize: { min: 1, max: 4 } },
      },
    });
    expect(problems.some((p) => p.includes('lobbySettings.maxRounds'))).toBe(true);
  });
});

describe('style palettes', () => {
  const players = defaultArtConfig.players;
  const withStyle = (own: object) => ({ ...defaultArtConfig, stylePalettes: { pixel: own } });

  it('leaves a style with no colours of its own exactly on the shared art', () => {
    expect(artForStyle(defaultArtConfig, 'pixel')).toBe(defaultArtConfig);
  });

  it("lays a style's entries over the shared palette and keeps the rest", () => {
    const art = ArtConfigSchema.parse(withStyle({ palette: { waterMid: '#000010' } }));
    const pixel = artForStyle(art, 'pixel');
    expect(pixel.palette.waterMid).toBe('#000010');
    expect(pixel.palette.sand).toBe(defaultArtConfig.palette.sand);
    expect(artForStyle(art, 'flat').palette.waterMid).toBe(defaultArtConfig.palette.waterMid);
  });

  it('reads hues, and knows a grey has none', () => {
    expect(hueOf('#ff0000')).toBe(0);
    expect(hueOf('#00ff00')).toBe(120);
    expect(hueOf('#0000ff')).toBe(240);
    expect(hueOf('#808080')).toBeNull();
  });

  it('accepts restyled ramps that keep every hue', () => {
    // Crimson brightened to neon, across the 0-degree seam: 352 to 348.
    const neon = players.map((p, i) => (i === 0 ? { ...p, base: '#ff2a55' } : p));
    expect(ArtConfigSchema.safeParse(withStyle({ players: neon })).success).toBe(true);
  });

  it("refuses a ramp that changes a player's hue, since the looks swap mid-match", () => {
    const magenta = players.map((p, i) => (i === 0 ? { ...p, base: '#c828af' } : p));
    const result = ArtConfigSchema.safeParse(withStyle({ players: magenta }));
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/crimson.*hue/);
  });

  it('refuses ramps that drop, reorder or rename players', () => {
    expect(ArtConfigSchema.safeParse(withStyle({ players: players.slice(1) })).success).toBe(false);
    const swapped = [players[1], players[0], ...players.slice(2)];
    expect(ArtConfigSchema.safeParse(withStyle({ players: swapped })).success).toBe(false);
    const families = defaultArtConfig.teamFamilies.slice(1);
    expect(ArtConfigSchema.safeParse(withStyle({ teamFamilies: families })).success).toBe(false);
  });

  it('refuses colours for a style that does not exist', () => {
    const bad = { ...defaultArtConfig, stylePalettes: { nonsense: {} } };
    expect(ArtConfigSchema.safeParse(bad).success).toBe(false);
  });

  it('refuses a palette entry no style knows', () => {
    expect(
      ArtConfigSchema.safeParse(withStyle({ palette: { waterMidd: '#000000' } })).success,
    ).toBe(false);
  });
});

describe('styles per look', () => {
  // No shipped style is made for one look yet, so the rules are tried on a table that has
  // one: pixel for combat alone.
  const looks = { ...STYLE_LOOKS, pixel: ['combat'] as const };

  it('offers every shipped style for a look it is made for, the defaults included', () => {
    expect(stylesFor('build')).toContain(defaultArtConfig.styles.build);
    expect(stylesFor('combat')).toContain(defaultArtConfig.styles.combat);
  });

  it('offers a look only the styles made for it', () => {
    expect(stylesFor('build', looks)).not.toContain('pixel');
    expect(stylesFor('combat', looks)).toContain('pixel');
  });

  it('takes the first candidate made for the look, and falls through the rest', () => {
    expect(chooseStyle('build', ['pixel', 'night'], 'flat', looks)).toBe('night');
    expect(chooseStyle('combat', ['pixel', 'night'], 'flat', looks)).toBe('pixel');
  });

  it('offers every shipped style for both looks, cyberpunk included', () => {
    expect(stylesFor('build')).toContain('cyberpunk');
    expect(stylesFor('combat')).toContain('cyberpunk');
  });

  it('falls back past a missing, unknown or stale choice', () => {
    expect(chooseStyle('build', [null, undefined, 'sepia', 42], 'flat', looks)).toBe('flat');
    expect(chooseStyle('build', ['pixel'], 'flat', looks)).toBe('flat');
  });
});
