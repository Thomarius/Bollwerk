import { describe, expect, it } from 'vitest';

import { isAudioData, loadProgress } from './audio.js';

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('telling a music file from the page the server sends for a missing one', () => {
  it('knows MP3, Ogg, WAV, FLAC and MP4 by their first bytes', () => {
    expect(isAudioData(bytes('ID3\u0004\u0000'))).toBe(true);
    expect(isAudioData(new Uint8Array([0xff, 0xfb, 0x90, 0x64]))).toBe(true);
    expect(isAudioData(bytes('OggS\u0000\u0002'))).toBe(true);
    expect(isAudioData(bytes('RIFF....WAVE'))).toBe(true);
    expect(isAudioData(bytes('fLaC'))).toBe(true);
    expect(isAudioData(bytes('\u0000\u0000\u0000 ftypM4A '))).toBe(true);
  });

  it('turns away the index.html a missing path is answered with', () => {
    expect(isAudioData(bytes('<!doctype html>'))).toBe(false);
    expect(isAudioData(new Uint8Array())).toBe(false);
  });
});

describe('the loading bar', () => {
  it('counts bytes, a file of unknown length as long as its kind’s known average or typical', () => {
    expect(loadProgress([])).toBe(1);
    const progress = loadProgress([
      { kind: 'sfx', loaded: 10, total: 10 },
      { kind: 'sfx', loaded: 0, total: null },
      { kind: 'music', loaded: 500, total: 1000 },
      { kind: 'music', loaded: 0, total: null },
    ]);
    // 510 arrived of 10 + 10 + 1000 + 1000: each unknown one as long as its kind's average.
    expect(progress).toBeCloseTo(510 / 2020);
    // No track known yet: an unknown one as long as a typical track, a megabyte.
    expect(
      loadProgress([
        { kind: 'sfx', loaded: 40_000, total: 40_000 },
        { kind: 'music', loaded: 0, total: null },
      ]),
    ).toBeCloseTo(40_000 / 1_040_000);
  });
});
