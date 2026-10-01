import { defaultArtConfig, type ArtConfig } from '@rampart/config';

/**
 * The connection, where a player can see it: a badge beside Pause in an online match.
 * It was a line of grey 11 px text in the HUD's far corner, and in the session where
 * every click of the hosts' lagged, nobody saw it say so (ARCHIVE 11zg).
 */
export interface NetworkReading {
  /** The last round trip to the server, in milliseconds. */
  latencyMs: number;
  /** Ticks the page trails what the server has confirmed. */
  behind: number;
  desynced: boolean;
}

export type NetworkLevel = 'good' | 'slow' | 'bad';

/** How the connection is, in a word and a colour: the worst of what it reads. */
export function netHealth(
  reading: NetworkReading,
  tickRateHz: number,
  limits: ArtConfig['hud']['network'] = defaultArtConfig.hud.network,
): { level: NetworkLevel; text: string } {
  if (reading.desynced) return { level: 'bad', text: 'Out of sync' };
  const behind = (reading.behind / tickRateHz).toFixed(1);
  if (reading.behind >= limits.badBehindTicks) return { level: 'bad', text: `Behind ${behind} s` };
  if (reading.latencyMs >= limits.badPingMs) {
    return { level: 'bad', text: `Slow link · ${reading.latencyMs} ms` };
  }
  if (reading.behind >= limits.slowBehindTicks) {
    return { level: 'slow', text: `Behind ${behind} s` };
  }
  if (reading.latencyMs >= limits.slowPingMs) {
    return { level: 'slow', text: `Slow link · ${reading.latencyMs} ms` };
  }
  // No round trip measured yet: the first ping goes out two seconds in.
  const ms = reading.latencyMs > 0 ? ` · ${reading.latencyMs} ms` : '';
  return { level: 'good', text: `Online${ms}` };
}

/** The badge itself, beside the Pause button, for the length of an online match. */
export class NetworkBadge {
  private readonly node = document.createElement('div');
  private shown = '';

  constructor() {
    this.node.id = 'network';
    this.node.title = 'Round trip to the server, and whether this page keeps up with it';
    document.body.append(this.node);
  }

  update(reading: NetworkReading, tickRateHz: number): void {
    const { level, text } = netHealth(reading, tickRateHz);
    const key = `${level}|${text}`;
    if (key === this.shown) return;
    this.shown = key;
    this.node.className = level;
    this.node.textContent = text;
  }

  destroy(): void {
    this.node.remove();
  }
}
