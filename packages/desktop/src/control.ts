import type { InternetStatus, RunningServer, StartResult } from '@bollwerk/server';

import type { Tunnel, TunnelStatus } from './tunnel.js';

/**
 * The server as the window shows it (PLAN 11.17 A2), kept apart from Electron so it can be
 * tested on its own: starting, running with the addresses to open, stopped, or failed and
 * why. A failure to bind is a state the window offers a way out of — the next port — not
 * an error.
 */
export type ControlState = (
  | { status: 'stopped'; port: number }
  | { status: 'starting'; port: number }
  | { status: 'running'; port: number; urls: string[]; internet: InternetStatus }
  | { status: 'stopping'; port: number }
  | { status: 'failed'; port: number; reason: 'port_in_use' | 'no_permission' | 'error' }
) & {
  /** The host's switch "Open to the internet" (PLAN 11.21), whatever the server's state. */
  upnp: boolean;
  /** The host's switch "Share a link online", whatever the server's state. */
  tunnel: boolean;
  /** The tunnel's link, while the server runs and the switch is on. */
  link: TunnelStatus;
};

/** The part of a tunnel the control needs; the real one, or a fake in tests. */
export type TunnelLike = Pick<Tunnel, 'open' | 'close' | 'status' | 'onChange'>;

/** The port to offer once one is taken: the next, wrapping inside the unprivileged range. */
export function nextPort(port: number): number {
  return port >= 65535 ? 1024 : port + 1;
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export class ServerControl {
  private server: RunningServer | null = null;
  private current: ControlState;
  private readonly listeners: ((state: ControlState) => void)[] = [];

  private upnp: boolean;
  private tunnelOn: boolean;

  constructor(
    private readonly start: (port: number) => Promise<StartResult>,
    port: number,
    switches: { upnp?: boolean; tunnel?: boolean } = {},
    private readonly tunnel: TunnelLike | null = null,
  ) {
    this.upnp = switches.upnp === true;
    this.tunnelOn = switches.tunnel === true;
    this.current = {
      status: 'stopped',
      port,
      upnp: this.upnp,
      tunnel: this.tunnelOn,
      link: { state: 'off' },
    };
    tunnel?.onChange((link) => {
      this.server?.setInvite(link.state === 'open' ? link.url : null);
      this.set(this.current);
    });
  }

  get state(): ControlState {
    return this.current;
  }

  onChange(listener: (state: ControlState) => void): void {
    this.listeners.push(listener);
  }

  /** Sets the state, the switches and the link carried along. */
  private set(state: DistributiveOmit<ControlState, 'upnp' | 'tunnel' | 'link'>): void {
    this.current = {
      ...state,
      upnp: this.upnp,
      tunnel: this.tunnelOn,
      link: this.tunnel?.status ?? { state: 'off' },
    } as ControlState;
    for (const listener of this.listeners) listener(this.current);
  }

  /** Starts on the port given, or the last one; does nothing unless stopped or failed. */
  async startOn(port = this.current.port): Promise<void> {
    if (this.current.status !== 'stopped' && this.current.status !== 'failed') return;
    this.set({ status: 'starting', port });
    let result: StartResult;
    try {
      result = await this.start(port);
    } catch {
      this.set({ status: 'failed', port, reason: 'error' });
      return;
    }
    if (!result.ok) {
      this.set({ status: 'failed', port, reason: result.reason });
      return;
    }
    const server = result.server;
    this.server = server;
    const running = (internet: InternetStatus) => ({
      status: 'running' as const,
      port: server.port,
      urls: server.urls,
      internet,
    });
    server.onInternet((internet) => {
      if (this.server === server && this.current.status === 'running') this.set(running(internet));
    });
    this.set(running(server.internet));
    if (this.upnp) void server.setInternet(true);
    if (this.tunnelOn) void this.tunnel?.open(server.port);
  }

  /** The host's switch: remembered, and acted on at once if the server is running. */
  async setUpnp(on: boolean): Promise<void> {
    this.upnp = on;
    this.set(this.current);
    if (this.server !== null && this.current.status === 'running') {
      await this.server.setInternet(on);
    }
  }

  /** The host's other switch: remembered, and acted on at once if the server is running. */
  async setTunnel(on: boolean): Promise<void> {
    this.tunnelOn = on;
    this.set(this.current);
    if (this.server === null || this.current.status !== 'running') return;
    if (on) await this.tunnel?.open(this.server.port);
    else this.tunnel?.close();
  }

  /** Stops it, resolving once the port is free; does nothing unless running. */
  async stop(): Promise<void> {
    const server = this.server;
    if (server === null || this.current.status !== 'running') return;
    this.set({ status: 'stopping', port: this.current.port });
    this.tunnel?.close();
    await server.stop();
    this.server = null;
    this.set({ status: 'stopped', port: this.current.port });
  }
}
