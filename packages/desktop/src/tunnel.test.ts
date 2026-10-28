import { describe, expect, it } from 'vitest';

import { UnsupportedSystem } from './cloudflared.js';
import { Tunnel, readLine, type TunnelProcess, type TunnelStatus } from './tunnel.js';

/** A program that says what it is told to, when told to. */
function fakeProgram() {
  const lines: ((line: string) => void)[] = [];
  const exits: (() => void)[] = [];
  const program = {
    args: [] as string[],
    killed: false,
    say: (line: string) => lines.forEach((l) => l(line)),
    exit: () => exits.forEach((l) => l()),
    process: {
      onLine: (l) => void lines.push(l),
      onExit: (l) => void exits.push(l),
      kill: () => {
        program.killed = true;
        program.exit();
      },
    } as TunnelProcess,
  };
  return program;
}

// As the program writes them, version 2026.10.4.
const ADDRESS_LINE =
  '2026-10-26T21:41:02Z INF |  https://consists-gentleman-bite-arc.trycloudflare.com                                     |';
const CONNECTED_LINE =
  '2026-10-26T21:41:03Z INF Registered tunnel connection connIndex=0 connection=ab5b2014 event=0 ip=198.41.200.23 location=fra06 protocol=quic';

describe('the tunnel', () => {
  it('reads the address, the connection and errors from the program', () => {
    expect(readLine(ADDRESS_LINE)).toEqual({
      url: 'https://consists-gentleman-bite-arc.trycloudflare.com',
    });
    expect(readLine(CONNECTED_LINE)).toEqual({ connected: true });
    expect(readLine('2026-10-26T21:41:02Z ERR failed to dial edge error="no route"')).toEqual({
      error: 'failed to dial edge error="no route"',
    });
    expect(readLine('2026-10-26T21:41:02Z INF Requesting new quick Tunnel...')).toBeNull();
  });

  it('is open only once a connection stands, and closes the program', async () => {
    const program = fakeProgram();
    const seen: TunnelStatus['state'][] = [];
    let asked = 0;
    const tunnel = new Tunnel({
      binary: (progress) => {
        progress(50);
        return Promise.resolve('cloudflared');
      },
      run: (_file, args) => {
        program.args = args;
        queueMicrotask(() => {
          program.say(ADDRESS_LINE);
          program.say(CONNECTED_LINE);
        });
        return program.process;
      },
      // Not known by name at the first asking, as a new address often is not.
      reachable: () => Promise.resolve(++asked > 1),
      pollMs: 1,
      now: () => 1000,
    });
    const steps: TunnelStatus[] = [];
    tunnel.onChange((s) => {
      seen.push(s.state);
      steps.push(s);
    });
    await tunnel.open(8080);
    expect(program.args).toEqual(['tunnel', '--no-autoupdate', '--url', 'http://127.0.0.1:8080']);
    expect(tunnel.status).toEqual({
      state: 'open',
      url: 'https://consists-gentleman-bite-arc.trycloudflare.com',
    });
    expect(asked).toBe(2);
    tunnel.close();
    expect(program.killed).toBe(true);
    expect(seen).toEqual([
      'starting',
      'downloading',
      'starting',
      'registering',
      'publishing',
      'open',
      'off',
    ]);
    // Every step timed from the switch, and the address shown once a connection stands.
    expect(steps.slice(0, 5)).toEqual([
      { state: 'starting', since: 1000 },
      { state: 'downloading', percent: 50, since: 1000 },
      { state: 'starting', since: 1000 },
      { state: 'registering', since: 1000 },
      {
        state: 'publishing',
        url: 'https://consists-gentleman-bite-arc.trycloudflare.com',
        since: 1000,
      },
    ]);
  });

  it('says when the program stops, gives no answer, or cannot be had', async () => {
    const stops = fakeProgram();
    const stopping = new Tunnel({
      binary: () => Promise.resolve('cloudflared'),
      run: () => {
        queueMicrotask(() => {
          stops.say('2026-10-26T21:41:02Z ERR failed to request quick Tunnel');
          stops.exit();
        });
        return stops.process;
      },
    });
    await stopping.open(8080);
    expect(stopping.status).toEqual({
      state: 'failed',
      reason: 'exited',
      detail: 'failed to request quick Tunnel',
    });

    const silent = fakeProgram();
    const waiting = new Tunnel({
      binary: () => Promise.resolve('cloudflared'),
      run: () => silent.process,
      timeoutMs: 10,
    });
    await waiting.open(8080);
    expect(waiting.status).toMatchObject({ state: 'failed', reason: 'timeout' });
    expect(silent.killed).toBe(true);

    const nowhere = new Tunnel({
      binary: () => Promise.reject(new UnsupportedSystem('darwin-arm64')),
    });
    await nowhere.open(8080);
    expect(nowhere.status).toMatchObject({ state: 'failed', reason: 'unsupported' });
  });

  it('drops an opening the host switched off meanwhile', async () => {
    let fetched: (file: string) => void = () => undefined;
    let ran = false;
    const tunnel = new Tunnel({
      binary: () => new Promise((resolve) => (fetched = resolve)),
      run: () => {
        ran = true;
        return fakeProgram().process;
      },
    });
    const opening = tunnel.open(8080);
    tunnel.close();
    fetched('cloudflared');
    await opening;
    expect(ran).toBe(false);
    expect(tunnel.status).toEqual({ state: 'off' });
  });
});
