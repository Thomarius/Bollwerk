import type { AudioManifest, MusicCue, SfxCue } from '@bollwerk/config';
import { store, stored } from './storage.js';

/**
 * Sound.
 *
 * Four things shape this more than taste does.
 *
 * **Nothing here may reach the simulation.** Cue choice among variants is random, and
 * that randomness uses `Math.random` rather than the match's `Rng` — drawing from the
 * seeded stream would make two clients with different audio settings desync. Audio
 * reads the match; it never touches it.
 *
 * **A browser will not start an `AudioContext` without a user gesture**, nor play an
 * `<audio>` element. The context is made as the page opens and runs at once where the
 * browser allows it; elsewhere it waits, suspended, for the first click or keypress, and a
 * track it refused is started again then. Every sound cue before it runs is silently
 * dropped rather than queued: a burst of cues arriving all at once the moment sound
 * switches on is worse than having missed them.
 *
 * **Every file is downloaded once, as the page opens, and music is never decoded whole**
 * (docs/STYLE_MUSIC.md §2): decoded, today's thirteen minutes of music took some 300 MB of
 * memory on every page. The sound effects are decoded, being short and needing to start at
 * once; each music track is kept as its compressed bytes, some 0.7 MB a minute, and played
 * by an `<audio>` element through the music bus. The browser keeps the files between visits,
 * the server answering an unchanged one with a 304.
 *
 * **Missing files are silent**, which is what lets the game ship and play before a
 * single sound exists. Note that "missing" cannot be decided from the HTTP status: the
 * server answers an unknown path with the client's `index.html` and a 200, so an absent
 * cue arrives as a perfectly successful response full of HTML. A sound effect is known
 * absent by its failing to decode, a track by its bytes not being audio (`isAudioData`).
 */

/** How long one music track takes to give way to the next. */
const CROSSFADE_MS = 600;

const MUTE_KEY = 'bollwerk.muted';

/**
 * The two volumes a player sets in the menu (PLAN 11.18 Y4), music and sounds, each from
 * 0 to 1 over the manifest's own levels, which stay the mix. Mute is apart from them: the
 * corner switch silences everything and gives back the volumes as they were.
 */
export type VolumeKind = 'music' | 'sounds';

const VOLUME_KEY: Record<VolumeKind, string> = {
  music: 'bollwerk.volume.music',
  sounds: 'bollwerk.volume.sounds',
};

/** A stored volume, read back: full when nothing is stored or what is stored is not one. */
export function parseVolume(stored: string | null | undefined): number {
  if (stored === null || stored === undefined || stored.trim() === '') return 1;
  const value = Number(stored);
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
}

function storedVolume(kind: VolumeKind): number {
  return parseVolume(stored(VOLUME_KEY[kind]));
}

/**
 * Whether these bytes begin as an audio file does — MP3 (an ID3 tag or a frame's sync), Ogg,
 * WAV, FLAC or MP4 — rather than as the `index.html` the server sends for a missing path. A
 * track is never decoded, so this is how one is known to be there.
 */
export function isAudioData(head: Uint8Array): boolean {
  const ascii = (at: number, text: string): boolean =>
    [...text].every((c, i) => head[at + i] === c.charCodeAt(0));
  if (ascii(0, 'ID3') || ascii(0, 'OggS') || ascii(0, 'RIFF') || ascii(0, 'fLaC')) return true;
  if (ascii(4, 'ftyp')) return true;
  // An MP3 without a tag starts on a frame: eleven bits set.
  return head.length >= 2 && head[0] === 0xff && ((head[1] as number) & 0xe0) === 0xe0;
}

/** Every file a cue may draw from: its file, and `cue.2.ext` and on for its variants. */
function variantPaths(file: string, variants: number): string[] {
  const paths = [file];
  for (let n = 2; n <= variants; n++) paths.push(file.replace(/(\.[^.]+)$/, `.${n}$1`));
  return paths;
}

/**
 * A file's length guessed by its kind until one of that kind has said its own: the sounds are
 * some 40 KB, the tracks at 96 kbps about a megabyte. Guessed from the first track known, fifty
 * sounds were counted as fifty megabytes and the bar crept, then leapt (2026-10-18).
 */
const TYPICAL_BYTES = { sfx: 40_000, music: 1_000_000 } as const;

/** A file being loaded: its kind, its bytes so far, and its length once its response says. */
export interface LoadingFile {
  kind: 'sfx' | 'music';
  loaded: number;
  total: number | null;
}

/**
 * How far a load is, 0 to 1, by bytes: what has arrived against every file's length, one whose
 * length is not known yet counted as long as the average of its kind's known, or its kind's
 * typical length while none is (`TYPICAL_BYTES`). Weighed alike, fifty small sounds finishing at once took
 * the bar to two thirds in a second and left the music to crawl through the rest (a 10 Mbit/s
 * load, 2026-10-18). It may step back a little as a long file's length arrives; the screen never
 * shows it going back (`loading.ts`).
 */
export function loadProgress(files: readonly LoadingFile[]): number {
  if (files.length === 0) return 1;
  const averageOf = (of: readonly LoadingFile[]): number | null => {
    const known = of.filter((f) => f.total !== null);
    if (known.length === 0) return null;
    return known.reduce((sum, f) => sum + (f.total as number), 0) / known.length;
  };
  const average = {
    sfx: averageOf(files.filter((f) => f.kind === 'sfx')) ?? TYPICAL_BYTES.sfx,
    music: averageOf(files.filter((f) => f.kind === 'music')) ?? TYPICAL_BYTES.music,
  };
  let arrived = 0;
  let whole = 0;
  for (const { kind, loaded, total } of files) {
    const length = total ?? average[kind];
    whole += length;
    arrived += Math.min(loaded, length);
  }
  return whole <= 0 ? 1 : arrived / whole;
}

/**
 * Shortest gap between two starts of the same cue.
 *
 * A barrage is a lot of cannons: three players with ten guns each put dozens of shots
 * in the air over a ten-second combat phase, and stacking twenty copies of one sample
 * a few milliseconds apart does not sound like twenty cannons, it sounds like
 * distortion. Dropping the ones that land on top of each other keeps the volley
 * audible as a volley.
 */
const MIN_REPEAT_MS = 60;

/** A track sounding: its element, the node feeding it into the graph, and its fade. */
interface Playing {
  cue: MusicCue;
  element: HTMLAudioElement;
  source: MediaElementAudioSourceNode;
  gain: GainNode;
  /** Whether the browser has let it start; one refused is started at the next gesture. */
  started: boolean;
}

export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  /** Music and sounds each through a bus of its own, under the master, for their volumes. */
  private buses: Record<VolumeKind, GainNode> | null = null;
  private readonly volumes: Record<VolumeKind, number> = {
    music: storedVolume('music'),
    sounds: storedVolume('sounds'),
  };

  /** Sound effects, decoded, by file path. A null entry is a file known not to be there. */
  private readonly buffers = new Map<string, AudioBuffer | null>();
  /** Music, as an object URL of its compressed bytes, by file path; null for one absent. */
  private readonly tracks = new Map<string, string | null>();
  /** Every path a cue may draw from, after the ones that do not exist are dropped. */
  private readonly sources = new Map<string, string[]>();

  private playing: Playing | null = null;
  private pendingMusic: MusicCue | null = null;
  private loading: Promise<void> | null = null;
  private muted = false;
  private readonly lastStarted = new Map<string, number>();

  constructor(private readonly manifest: AudioManifest) {
    this.muted = stored(MUTE_KEY) === '1';
  }

  get isMuted(): boolean {
    return this.muted;
  }

  volume(kind: VolumeKind): number {
    return this.volumes[kind];
  }

  /** Sets a volume, 0 to 1, at once and for later visits. */
  setVolume(kind: VolumeKind, value: number): void {
    const level = Math.max(0, Math.min(1, value));
    this.volumes[kind] = level;
    store(VOLUME_KEY[kind], String(level));
    const bus = this.buses?.[kind];
    if (bus !== undefined && this.ctx !== null) {
      bus.gain.setTargetAtTime(level, this.ctx.currentTime, 0.03);
    }
  }

  /** The context and its buses, made once — suspended until a gesture where the browser asks. */
  private context(): AudioContext | null {
    if (this.ctx === null) {
      const Ctor = globalThis.AudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.manifest.masterVolume;
      this.master.connect(this.ctx.destination);
      const bus = (kind: VolumeKind): GainNode => {
        const node = this.ctx!.createGain();
        node.gain.value = this.volumes[kind];
        node.connect(this.master!);
        return node;
      };
      this.buses = { music: bus('music'), sounds: bus('sounds') };
    }
    return this.ctx;
  }

  /**
   * Starts the audio context: running at once where the browser allows sound unasked, or
   * where a user gesture is in progress; otherwise made and left suspended for the next.
   * A track the browser refused to start before is started now.
   *
   * Safe to call on every click: it does its work once, and resuming an already
   * running context is free.
   */
  unlock(): void {
    const ctx = this.context();
    if (ctx === null) return;
    if (ctx.state === 'suspended') void ctx.resume();
    const playing = this.playing;
    if (playing !== null && !playing.started) this.start(playing);
  }

  /**
   * Every file the manifest names, fetched once — the loading screen waits on it — with how
   * far it is, 0 to 1, as files arrive. Sound effects are decoded; music is kept compressed.
   * A file that fails or is absent counts as done and stays silent. Asked again, the same.
   */
  load(onProgress: (done: number) => void = () => undefined): Promise<void> {
    this.loading ??= this.loadAll(onProgress);
    return this.loading;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    store(MUTE_KEY, muted ? '1' : '0');
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(
        muted ? 0 : this.manifest.masterVolume,
        this.ctx.currentTime,
        0.05,
      );
    }
  }

  play(cue: SfxCue, gain = 1, delayMs = 0): void {
    const entry = this.manifest.sfx[cue];
    // Not while the context waits for a gesture: cues started in a suspended context all
    // sounded at once as it resumed. Music may wait in it — it starts as the context does.
    if (!entry || this.ctx === null || this.master === null || this.ctx.state !== 'running') {
      return;
    }

    // Measured from when it sounds, so knocks scheduled ahead are kept apart as any are.
    const at = this.ctx.currentTime * 1000 + delayMs;
    if (Math.abs(at - (this.lastStarted.get(cue) ?? -Infinity)) < MIN_REPEAT_MS) return;

    const path = this.pick(cue);
    const buffer = path === null ? null : (this.buffers.get(path) ?? null);
    if (buffer === null) return;
    this.lastStarted.set(cue, at);

    const level = this.ctx.createGain();
    level.gain.value = entry.volume * gain;
    level.connect(this.buses?.sounds ?? this.master);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = entry.rate ?? 1;
    source.connect(level);
    source.start(at / 1000);
    source.addEventListener('ended', () => level.disconnect());
  }

  /**
   * Switches the music, crossfading, and does nothing if that track is already up.
   *
   * Remembers the request when called before the context exists or the files have come,
   * so the right track is running the moment it can rather than whatever the next phase
   * change happens to ask for.
   */
  music(cue: MusicCue | null): void {
    this.pendingMusic = cue;
    const ctx = this.ctx;
    if (ctx === null || this.master === null) return;
    if (this.playing?.cue === cue) return;

    if (this.playing !== null) {
      const old = this.playing;
      old.gain.gain.setTargetAtTime(0, ctx.currentTime, CROSSFADE_MS / 3000);
      globalThis.setTimeout(() => this.release(old), CROSSFADE_MS);
      this.playing = null;
    }
    if (cue === null) return;

    const entry = this.manifest.music[cue];
    const path = this.pick(cue);
    const url = path === null ? null : (this.tracks.get(path) ?? null);
    if (!entry || url === null) return;

    const element = document.createElement('audio');
    element.src = url;
    element.loop = entry.loop;
    element.preload = 'auto';
    const source = ctx.createMediaElementSource(element);
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(entry.volume, ctx.currentTime, CROSSFADE_MS / 3000);
    source.connect(gain);
    gain.connect(this.buses?.music ?? this.master);
    // A track that plays once (victory, defeat) stays the one up after its end, silent, so
    // asking for it again does not start it over; the next track lets its element go.
    const playing: Playing = { cue, element, source, gain, started: false };
    this.playing = playing;
    this.start(playing);
  }

  /** Plays a track's element; one the browser refuses waits for the next gesture (`unlock`). */
  private start(playing: Playing): void {
    playing.started = true;
    playing.element.play().catch(() => {
      if (this.playing === playing) playing.started = false;
    });
  }

  /** A track done with: stopped, unhooked from the graph, its element let go. */
  private release(playing: Playing): void {
    if (this.playing === playing) this.playing = null;
    playing.element.pause();
    playing.source.disconnect();
    playing.gain.disconnect();
    playing.element.removeAttribute('src');
    playing.element.load();
  }

  /** One of the cue's surviving variants, or null when none of its files exist. */
  private pick(cue: SfxCue | MusicCue): string | null {
    const paths = this.sources.get(cue);
    if (paths === undefined || paths.length === 0) return null;
    // Math.random, deliberately: see the note at the top of this file.
    return paths[Math.floor(Math.random() * paths.length)] as string;
  }

  /**
   * Every file the manifest mentions, fetched in parallel: the sound effects decoded, the
   * music kept as it came.
   *
   * A cue with `variants: 3` may be supplied as `cue.mp3`, `cue.2.mp3`, `cue.3.mp3`.
   * Any of them may be absent — supplying one unnumbered file is enough — so this
   * keeps whichever turned up and forgets the rest.
   */
  private async loadAll(onProgress: (done: number) => void): Promise<void> {
    const files: LoadingFile[] = [];
    const report = (): void => onProgress(loadProgress(files));
    const jobs: Promise<void>[] = [];
    const add = (cue: string, paths: string[], kind: 'sfx' | 'music'): void => {
      const found = paths.map((path) => {
        const file: LoadingFile = { kind, loaded: 0, total: null };
        files.push(file);
        return this.fetchFile(path, kind, file, report);
      });
      jobs.push(
        Promise.all(found).then((there) => {
          this.sources.set(
            cue,
            paths.filter((_, i) => there[i] === true),
          );
          // A track asked for before its file arrived can start now.
          if (kind === 'music' && this.pendingMusic !== null && this.playing === null) {
            this.music(this.pendingMusic);
          }
        }),
      );
    };
    // The music asked for first: a browser fetches six files at a time from one server, and a
    // long file's length known early is what lets the bar measure the rest (`loadProgress`).
    const { basePath } = this.manifest;
    for (const [cue, entry] of Object.entries(this.manifest.music)) {
      add(cue, variantPaths(`${basePath}/${entry.file}`, entry.variants ?? 1), 'music');
    }
    for (const [cue, entry] of Object.entries(this.manifest.sfx)) {
      add(cue, variantPaths(`${basePath}/${entry.file}`, entry.variants ?? 1), 'sfx');
    }
    report();
    await Promise.all(jobs);
    onProgress(1);
  }

  /**
   * One file: its bytes read as they arrive, for the bar; then a sound effect decoded or a
   * track kept. True once it is there and playable; a file shared by two cues comes once.
   */
  private async fetchFile(
    path: string,
    kind: 'sfx' | 'music',
    file: LoadingFile,
    report: () => void,
  ): Promise<boolean> {
    const done = (there: boolean): boolean => {
      file.total = Math.max(1, file.total ?? 1);
      file.loaded = file.total;
      report();
      return there;
    };
    const known = kind === 'sfx' ? this.buffers.get(path) : this.tracks.get(path);
    if (known !== undefined) return done(known !== null);
    try {
      const response = await fetch(path);
      if (!response.ok || response.body === null) throw new Error(String(response.status));
      const length = Number(response.headers.get('content-length'));
      file.total = Number.isFinite(length) && length > 0 ? length : null;
      const chunks: Uint8Array[] = [];
      const reader = response.body.getReader();
      for (;;) {
        const { done: end, value } = await reader.read();
        if (end) break;
        chunks.push(value);
        file.loaded += value.byteLength;
        report();
      }
      const bytes = new Uint8Array(file.loaded);
      let at = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, at);
        at += chunk.byteLength;
      }
      if (kind === 'music') {
        if (!isAudioData(bytes.subarray(0, 12))) throw new Error('not audio');
        const type = response.headers.get('content-type') ?? 'audio/mpeg';
        this.tracks.set(path, URL.createObjectURL(new Blob([bytes], { type })));
        return done(true);
      }
      // Decoding is what tells an absent sound from a present one, since the server
      // answers a missing path with index.html and a 200. HTML does not decode.
      const ctx = this.context();
      if (ctx === null) throw new Error('no audio');
      this.buffers.set(path, await ctx.decodeAudioData(bytes.buffer));
      return done(true);
    } catch {
      if (!this.manifest.missingFilesAreSilent) {
        console.warn(`audio: could not load ${path}`);
      }
      if (kind === 'sfx') this.buffers.set(path, null);
      else this.tracks.set(path, null);
      return done(false);
    }
  }
}
