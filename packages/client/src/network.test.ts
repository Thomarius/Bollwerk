import { defaultArtConfig } from '@rampart/config';
import { describe, expect, it } from 'vitest';

import { netHealth } from './network.js';

const limits = defaultArtConfig.hud.network;
const read = (latencyMs: number, behind = 0, desynced = false) =>
  netHealth({ latencyMs, behind, desynced }, 30, limits);

describe('the connection badge', () => {
  it('reads online with the round trip while all is well', () => {
    expect(read(45)).toEqual({ level: 'good', text: 'Online · 45 ms' });
    // A page that has caught up stays within the catch-up margin, which is no warning.
    expect(read(45, 2).level).toBe('good');
    expect(read(0).text).toBe('Online');
  });

  it('warns of a slow round trip, then a bad one', () => {
    expect(read(limits.slowPingMs)).toEqual({
      level: 'slow',
      text: `Slow link · ${limits.slowPingMs} ms`,
    });
    expect(read(limits.badPingMs).level).toBe('bad');
  });

  it('says how far behind the page is, in seconds, which the hosts’ delay was', () => {
    expect(read(40, limits.slowBehindTicks)).toEqual({
      level: 'slow',
      text: `Behind ${(limits.slowBehindTicks / 30).toFixed(1)} s`,
    });
    expect(read(40, 25)).toEqual({ level: 'bad', text: 'Behind 0.8 s' });
  });

  it('puts the worst first: out of sync over everything, a bad state over a slow one', () => {
    expect(read(500, 30, true)).toEqual({ level: 'bad', text: 'Out of sync' });
    expect(read(limits.badPingMs, limits.slowBehindTicks).text).toMatch(/^Slow link/);
    expect(read(limits.slowPingMs, limits.badBehindTicks).text).toMatch(/^Behind/);
  });
});
