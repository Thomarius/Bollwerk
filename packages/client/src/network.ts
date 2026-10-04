import { defaultArtConfig, type ArtConfig } from '@bollwerk/config';

import { formatNumber, onLanguageChange, t } from './i18n.js';

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
  if (reading.desynced) return { level: 'bad', text: t('network.desynced') };
  const seconds = formatNumber(reading.behind / tickRateHz, 1);
  const ms = reading.latencyMs;
  if (reading.behind >= limits.badBehindTicks) {
    return { level: 'bad', text: t('network.behind', { seconds }) };
  }
  if (ms >= limits.badPingMs) return { level: 'bad', text: t('network.slow', { ms }) };
  if (reading.behind >= limits.slowBehindTicks) {
    return { level: 'slow', text: t('network.behind', { seconds }) };
  }
  if (ms >= limits.slowPingMs) return { level: 'slow', text: t('network.slow', { ms }) };
  // No round trip measured yet: the first ping goes out two seconds in.
  return { level: 'good', text: ms > 0 ? t('network.onlinePing', { ms }) : t('network.online') };
}

/** The badge itself, beside the Pause button, for the length of an online match. */
export class NetworkBadge {
  private readonly node = document.createElement('div');
  private shown = '';
  private readonly stopListening: () => void;

  constructor() {
    this.node.id = 'network';
    this.node.title = t('network.title');
    // Its word is made afresh at each reading; its tooltip only here, and on a change.
    this.stopListening = onLanguageChange(() => {
      this.node.title = t('network.title');
      this.shown = '';
    });
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
    this.stopListening();
    this.node.remove();
  }
}
