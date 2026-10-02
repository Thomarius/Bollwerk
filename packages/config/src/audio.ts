import { z } from 'zod';

/**
 * Canonical cue list. The manifest must cover exactly these — adding a cue here
 * without adding it to audio.manifest.json (or vice versa) is a startup error,
 * so code and manifest cannot drift apart.
 */
export const SFX_CUES = [
  /** Committing a choice: a castle chosen, a menu button pressed. */
  'select',
  /** A cannon set down on sealed ground: the player's own, heavier than a menu click. */
  'place_cannon',
  'cannon_fire',
  'shot_impact',
  /** The shot hit wall rather than open ground — the shooter's fire is working. */
  /** Spoken. Opens the combat phase. */
  'voice_fire',
  /** Spoken. Closes it: no further shots can be started. */
  'voice_cease_fire',
  /** Fanfare: while building, the moment a wall closes round one of the player's castles. */
  'enclosure_success',
  /** A round ends with nothing of the player's sealed: the one that costs a life. */
  'enclosure_failed',
  'player_eliminated',
  'piece_place',
  'piece_rotate',
  'piece_invalid',
  'countdown_tick',
] as const;
export type SfxCue = (typeof SFX_CUES)[number];

/**
 * One track per mood rather than per phase. Castle select, cannon placement and
 * building are all the same thing from the player's side — laying out a position with
 * nothing incoming — so they share a track, and only the barrage gets its own.
 */
export const MUSIC_CUES = [
  'music_menu',
  'music_admin',
  'music_battle',
  'music_victory',
  'music_defeat',
] as const;
export type MusicCue = (typeof MUSIC_CUES)[number];

const SfxEntrySchema = z.strictObject({
  file: z.string().min(1),
  volume: z.number().min(0).max(1),
  /** Numbered alternates chosen at random, to avoid repetition fatigue. */
  variants: z.number().int().positive().optional(),
});

const MusicEntrySchema = z.strictObject({
  file: z.string().min(1),
  volume: z.number().min(0).max(1),
  /**
   * Numbered alternate tracks, one chosen at random each time the cue starts — so the
   * phases that come round every round do not play the same piece every time.
   */
  variants: z.number().int().positive().optional(),
  loop: z.boolean(),
});

/**
 * The open licences OpenGameArt offers, where every file came from, each with where its
 * text is published. A closed list rather than free text, so the credits name each
 * licence one way and can link it.
 */
export const AUDIO_LICENCES = {
  CC0: 'https://creativecommons.org/publicdomain/zero/1.0/',
  'CC-BY 3.0': 'https://creativecommons.org/licenses/by/3.0/',
  'CC-BY 4.0': 'https://creativecommons.org/licenses/by/4.0/',
  'CC-BY-SA 3.0': 'https://creativecommons.org/licenses/by-sa/3.0/',
  'CC-BY-SA 4.0': 'https://creativecommons.org/licenses/by-sa/4.0/',
  'OGA-BY 3.0': 'https://static.opengameart.org/OGA-BY-3.0.txt',
  'GPL 2.0': 'https://www.gnu.org/licenses/old-licenses/gpl-2.0.html',
  'GPL 3.0': 'https://www.gnu.org/licenses/gpl-3.0.html',
  'LGPL 2.1': 'https://www.gnu.org/licenses/old-licenses/lgpl-2.1.html',
  'LGPL 3.0': 'https://www.gnu.org/licenses/lgpl-3.0.html',
} as const;
export type AudioLicence = keyof typeof AUDIO_LICENCES;

/** Who made an audio file and on what terms: what the attribution licences ask to be shown. */
const AudioCreditSchema = z.strictObject({
  /** The work's title, as its author published it. */
  title: z.string().min(1),
  author: z.string().min(1),
  licence: z.enum(Object.keys(AUDIO_LICENCES) as [AudioLicence, ...AudioLicence[]]),
  /** The page it was taken from. */
  source: z.url(),
  /** What was done to it, if anything — trimmed, cut from a longer piece. CC-BY asks for it. */
  changes: z.string().min(1).optional(),
});

export type AudioCredit = z.infer<typeof AudioCreditSchema>;

export const AudioManifestSchema = z.strictObject({
  basePath: z.string().min(1),
  masterVolume: z.number().min(0).max(1),
  /** The game must be fully playable before a single audio file exists. */
  missingFilesAreSilent: z.boolean(),
  sfx: z.record(z.enum(SFX_CUES), SfxEntrySchema),
  music: z.record(z.enum(MUSIC_CUES), MusicEntrySchema),
  /**
   * One credit per file, by its path under `basePath` — variants each have their own,
   * since they may come from different authors. The menu's Credits and `CREDITS.md` are
   * both made from this; a file without one is shown as not yet credited.
   */
  credits: z.record(z.string().min(1), AudioCreditSchema),
});

export type AudioManifest = z.infer<typeof AudioManifestSchema>;

/** Every path a cue may load: its file, and `.2`, `.3`, … up to its variant count. */
export function cuePaths(entry: { file: string; variants?: number | undefined }): string[] {
  const paths = [entry.file];
  for (let n = 2; n <= (entry.variants ?? 1); n++) {
    paths.push(entry.file.replace(/(\.[^.]+)$/, `.${n}$1`));
  }
  return paths;
}

/** One file the manifest names, with its credit if it has one yet. */
export interface CreditedFile {
  path: string;
  credit: AudioCredit | null;
}

/** Every file the manifest names, music first, in the manifest's order. */
export function audioCredits(audio: AudioManifest): {
  music: CreditedFile[];
  sfx: CreditedFile[];
} {
  const list = (entries: { file: string; variants?: number | undefined }[]): CreditedFile[] =>
    entries.flatMap(cuePaths).map((path) => ({ path, credit: audio.credits[path] ?? null }));
  return { music: list(Object.values(audio.music)), sfx: list(Object.values(audio.sfx)) };
}
