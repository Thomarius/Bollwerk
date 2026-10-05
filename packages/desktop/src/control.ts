import type { InternetStatus, RunningServer, StartResult } from '@bollwerk/server';

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
};

/** The port to offer once one is taken: the next, wrapping inside the unprivileged range. */
export function nextPort(port: number): number {
  return port >= 65535 ? 1024 : port + 1;
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export class ServerControl {
  private server: RunningServer | null = null;
  private current: ControlState;
  private readonly listeners: ((state: ControlState) => void)[] = [];

  constructor(
    private readonly start: (port: number) => Promise<StartResult>,
    port: number,
    private upnp = false,
  ) {
    this.current = { status: 'stopped', port, upnp };
  }

  get state(): ControlState {
    return this.current;
  }

  onChange(listener: (state: ControlState) => void): void {
    this.listeners.push(listener);
  }

  /** Sets the state, the switch carried along. */
  private set(state: DistributiveOmit<ControlState, 'upnp'>): void {
    this.current = { ...state, upnp: this.upnp } as ControlState;
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
  }

  /** The host's switch: remembered, and acted on at once if the server is running. */
  async setUpnp(on: boolean): Promise<void> {
    this.upnp = on;
    this.set(this.current);
    if (this.server !== null && this.current.status === 'running') {
      await this.server.setInternet(on);
    }
  }

  /** Stops it, resolving once the port is free; does nothing unless running. */
  async stop(): Promise<void> {
    const server = this.server;
    if (server === null || this.current.status !== 'running') return;
    this.set({ status: 'stopping', port: this.current.port });
    await server.stop();
    this.server = null;
    this.set({ status: 'stopped', port: this.current.port });
  }
}
