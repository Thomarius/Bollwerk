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
  /** The work's title, as its author published it — where it is known. */
  title: z.string().min(1).optional(),
  author: z.string().min(1),
  licence: z.enum(Object.keys(AUDIO_LICENCES) as [AudioLicence, ...AudioLicence[]]),
  /** The page it was taken from, or the author's own for a work found elsewhere. */
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
   * Credits by path under `basePath`: a file's own — variants each have their own, since
   * they may come from different authors — or, for a key ending in `/`, one for every file
   * in that folder without its own. The sound effects are all CC0, which asks for no
   * attribution, so one line says so rather than thirty. The menu's Credits and
   * `CREDITS.md` are both made from this.
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

/** A file's own credit, or else its folder's. */
export function creditFor(audio: AudioManifest, path: string): AudioCredit | null {
  const own = audio.credits[path];
  if (own !== undefined) return own;
  const folder = path.slice(0, path.lastIndexOf('/') + 1);
  return folder === '' ? null : (audio.credits[folder] ?? null);
}

/**
 * One line of the credits: a file with its own credit, or a folder whose credit covers
 * every file in it without one (`path` then ends in `/`), or a file not yet credited.
 */
export interface CreditedFile {
  path: string;
  credit: AudioCredit | null;
}

/**
 * The credits' lines, music first, in the manifest's order; the files a folder's credit
 * covers are one line, where the first of them would stand.
 */
export function audioCredits(audio: AudioManifest): {
  music: CreditedFile[];
  sfx: CreditedFile[];
} {
  const list = (entries: { file: string; variants?: number | undefined }[]): CreditedFile[] => {
    const lines: CreditedFile[] = [];
    for (const path of entries.flatMap(cuePaths)) {
      const own = audio.credits[path];
      const credit = creditFor(audio, path);
      const line =
        own === undefined && credit !== null ? path.slice(0, path.lastIndexOf('/') + 1) : path;
      if (!lines.some((l) => l.path === line)) lines.push({ path: line, credit });
    }
    return lines;
  };
  return { music: list(Object.values(audio.music)), sfx: list(Object.values(audio.sfx)) };
}
