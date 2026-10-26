import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

import { UnsupportedSystem } from './cloudflared.js';

/**
 * Sharing the server through a link online: a Cloudflare quick tunnel, which needs no
 * account and no router setting. The tunnel program connects out to Cloudflare and Cloudflare
 * hands back an address, `https://<words>.trycloudflare.com`, whose visitors it passes on to
 * this machine's port — so it works where opening a port cannot: no public address (DS-Lite,
 * carrier-grade NAT), UPnP off, two routers, a firewall that lets nothing in.
 *
 * Free and without an account, but without a promise of uptime either, and the address is new
 * every time; the host switches it on, never a default.
 */
export type TunnelStatus =
  | { state: 'off' }
  /** Fetching the tunnel program, the first time only. */
  | { state: 'downloading'; percent: number }
  | { state: 'connecting' }
  | { state: 'open'; url: string }
  | {
      state: 'failed';
      /** No build for this system; the download failed; the program stopped; no answer. */
      reason: 'unsupported' | 'download' | 'exited' | 'timeout';
      detail: string;
    };

/** The running program, as much of it as the tunnel needs; a fake in tests. */
export interface TunnelProcess {
  /** Every line it writes, either stream. */
  onLine(listener: (line: string) => void): void;
  onExit(listener: () => void): void;
  kill(): void;
}

export interface TunnelOptions {
  /** The program's path, fetched first if need be. */
  binary(progress: (percent: number) => void): Promise<string>;
  /** Runs it; the real program by default. */
  run?: (file: string, args: string[]) => TunnelProcess;
  /** How long Cloudflare may take to hand out an address and connect. */
  timeoutMs?: number;
  /** Whether the address answers yet; asked of the address itself by default. */
  reachable?: (url: string) => Promise<boolean>;
  /** How often to ask, and how long before giving the address anyway. */
  pollMs?: number;
  reachableWaitMs?: number;
}

const answers = (url: string): Promise<boolean> =>
  fetch(url, { signal: AbortSignal.timeout(4000) }).then(
    (response) => response.ok,
    () => false,
  );

const ADDRESS = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;

/** What one line of the program's output says, if anything the window needs. */
export function readLine(
  line: string,
): { url: string } | { connected: true } | { error: string } | null {
  const url = ADDRESS.exec(line);
  if (url !== null) return { url: url[0] };
  if (line.includes('Registered tunnel connection')) return { connected: true };
  const error = / (?:ERR|FTL) (.*)$/.exec(line);
  return error === null ? null : { error: error[1]!.trim() };
}

function runProgram(file: string, args: string[]): TunnelProcess {
  const child = spawn(file, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const lineListeners: ((line: string) => void)[] = [];
  for (const stream of [child.stdout, child.stderr]) {
    createInterface({ input: stream }).on('line', (line) => {
      for (const listener of lineListeners) listener(line);
    });
  }
  return {
    onLine: (listener) => void lineListeners.push(listener),
    onExit: (listener) => {
      child.on('exit', listener);
      // A program that cannot start at all reports so here, not by exiting.
      child.on('error', listener);
    },
    kill: () => void child.kill(),
  };
}

/** One tunnel to one port at a time; a later `open` or `close` supersedes one in flight. */
export class Tunnel {
  private process: TunnelProcess | null = null;
  private generation = 0;
  private current: TunnelStatus = { state: 'off' };
  private readonly listeners: ((status: TunnelStatus) => void)[] = [];

  constructor(private readonly options: TunnelOptions) {}

  get status(): TunnelStatus {
    return this.current;
  }

  onChange(listener: (status: TunnelStatus) => void): void {
    this.listeners.push(listener);
  }

  private set(status: TunnelStatus): void {
    this.current = status;
    for (const listener of this.listeners) listener(status);
  }

  /** Opens a tunnel to `port`, telling each step; resolves once it is open or has failed. */
  async open(port: number): Promise<void> {
    const mine = ++this.generation;
    this.end();
    this.set({ state: 'connecting' });
    let file: string;
    try {
      file = await this.options.binary((percent) => {
        if (mine === this.generation) this.set({ state: 'downloading', percent });
      });
    } catch (e) {
      if (mine !== this.generation) return;
      this.set(
        e instanceof UnsupportedSystem
          ? { state: 'failed', reason: 'unsupported', detail: e.message }
          : {
              state: 'failed',
              reason: 'download',
              detail: e instanceof Error ? e.message : String(e),
            },
      );
      return;
    }
    if (mine !== this.generation) return;
    this.set({ state: 'connecting' });

    // 127.0.0.1 rather than localhost: the server listens on IPv4, and the program may try ::1.
    const args = ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`];
    const child = (this.options.run ?? runProgram)(file, args);
    this.process = child;
    await new Promise<void>((resolve) => {
      let url: string | null = null;
      let connected = false;
      let lastError = '';
      const settle = (status: TunnelStatus | null): void => {
        clearTimeout(timer);
        if (status !== null && mine === this.generation) this.set(status);
        resolve();
      };
      const timer = setTimeout(() => {
        if (this.current.state === 'open' || mine !== this.generation) return;
        this.end();
        settle({ state: 'failed', reason: 'timeout', detail: lastError });
      }, this.options.timeoutMs ?? 45_000);
      child.onLine((line) => {
        const said = readLine(line);
        if (said === null) return;
        if ('url' in said) url = said.url;
        else if ('error' in said) lastError = said.error;
        // Open only once a connection stands, and the address answers: the address alone leads
        // nowhere yet, and its name takes some seconds more to be known — measured at 12 s,
        // 2026-10-26 — in which a guest opening it would be told it does not exist.
        else if (url !== null && !connected) {
          connected = true;
          clearTimeout(timer);
          const found = url;
          const live = () => mine === this.generation && this.process === child;
          void (async () => {
            const until = Date.now() + (this.options.reachableWaitMs ?? 30_000);
            while (live() && Date.now() < until) {
              if (await (this.options.reachable ?? answers)(found)) break;
              await new Promise((wait) => setTimeout(wait, this.options.pollMs ?? 1500));
            }
            if (live()) settle({ state: 'open', url: found });
          })();
        }
      });
      child.onExit(() => {
        // Ended here — closed, superseded or timed out — and told already: nothing to tell.
        if (this.process !== child) return settle(null);
        this.process = null;
        settle({ state: 'failed', reason: 'exited', detail: lastError });
      });
    });
  }

  /** Closes the tunnel, if there is one; never throws. */
  close(): void {
    this.generation++;
    this.end();
    if (this.current.state !== 'off') this.set({ state: 'off' });
  }

  private end(): void {
    const child = this.process;
    this.process = null;
    try {
      child?.kill();
    } catch {
      // Already gone.
    }
  }
}
