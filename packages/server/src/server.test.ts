import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PROTOCOL_VERSION } from '@bollwerk/protocol';
import { describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import { repoRoot } from './paths.js';
import { startServer, staticAnswer, type RunningServer } from './server.js';
import { PortOpener, type Router } from './upnp.js';

/** A server on a free port, recording into a folder of its own, as the desktop app's. */
async function started(port = 0): Promise<RunningServer> {
  const result = await startServer({
    root: repoRoot,
    port,
    host: '127.0.0.1',
    recordingsDir: mkdtempSync(join(tmpdir(), 'bollwerk-server-')),
    commit: null,
    log: () => undefined,
  });
  if (!result.ok) throw new Error(`could not start: ${result.reason}`);
  return result.server;
}

/** Opens a socket, creates a room, and resolves with the first message back. */
function createRoom(port: number): Promise<{ type: string }> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    socket.on('error', reject);
    socket.on('open', () =>
      socket.send(
        JSON.stringify({ type: 'create', protocol: PROTOCOL_VERSION, name: 'Ada', players: 2 }),
      ),
    );
    socket.on('message', (data) => {
      resolve(JSON.parse(String(data)) as { type: string });
      socket.close();
    });
  });
}

describe('the server as something a program starts and stops', () => {
  it('serves rooms, says when its port is taken, and starts again once stopped', async () => {
    const server = await started();
    expect(server.urls[0]).toBe(`http://127.0.0.1:${server.port}`);
    const rooms = await fetch(`http://127.0.0.1:${server.port}/api/rooms`);
    expect(rooms.status).toBe(200);
    expect((await createRoom(server.port)).type).toBe('welcome');

    // A second server on the same port is told so, rather than thrown at.
    const second = await startServer({
      root: repoRoot,
      port: server.port,
      host: '127.0.0.1',
      recordingsDir: mkdtempSync(join(tmpdir(), 'bollwerk-server-')),
      commit: null,
      log: () => undefined,
    });
    expect(second).toMatchObject({ ok: false, reason: 'port_in_use', port: server.port });

    await server.stop();
    await expect(fetch(`http://127.0.0.1:${server.port}/api/rooms`)).rejects.toThrow();

    // The port is free again, and a server started on it works as the first did.
    const again = await started(server.port);
    expect((await createRoom(again.port)).type).toBe('welcome');
    await again.stop();
  });
});

describe('a connection', () => {
  it('sits in one room: a second create or join on it is refused', async () => {
    const server = await started();
    const replies: { type: string; code?: string }[] = [];
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}`);
    const create = { type: 'create', protocol: PROTOCOL_VERSION, name: 'Ada', players: 2 };
    await new Promise<void>((resolve, reject) => {
      socket.on('error', reject);
      socket.on('open', () => socket.send(JSON.stringify(create)));
      socket.on('message', (data) => {
        const reply = JSON.parse(String(data)) as { type: string; code?: string };
        replies.push(reply);
        if (reply.type === 'welcome') socket.send(JSON.stringify(create));
        if (reply.type === 'error') resolve();
      });
    });
    socket.close();
    expect(replies.some((r) => r.type === 'welcome')).toBe(true);
    expect(replies.at(-1)).toMatchObject({ type: 'error', code: 'in_a_room' });
    // And the second create made no room: only the first is open.
    const open = (await (await fetch(`http://127.0.0.1:${server.port}/api/rooms`)).json()) as {
      rooms: unknown[];
    };
    expect(open.rooms).toHaveLength(1);
    await server.stop();
  });
});

describe('opening the port to the internet', () => {
  it('puts the public address in the lobby while open, and takes it out when closed', async () => {
    const router: Router = {
      host: '192.168.178.1',
      externalIp: () => Promise.resolve('203.0.113.7'),
      map: (_port, _host, o) =>
        Promise.resolve({ externalHost: '203.0.113.7', externalPort: o.externalPort }),
      unmap: () => Promise.resolve(),
      stop: () => Promise.resolve(),
    };
    const opener = new PortOpener({
      leaseSeconds: 3600,
      searchMs: 10,
      interfaces: () => ({
        eth: [{ address: '192.168.178.20', family: 'IPv4', internal: false } as never],
      }),
      find: () => Promise.resolve(router),
    });
    const result = await startServer({
      root: repoRoot,
      port: 0,
      host: '127.0.0.1',
      recordingsDir: mkdtempSync(join(tmpdir(), 'bollwerk-server-')),
      commit: null,
      log: () => undefined,
      opener,
    });
    if (!result.ok) throw new Error('could not start');
    const server = result.server;
    const open = await server.setInternet(true);
    expect(open).toMatchObject({ state: 'open', url: `http://203.0.113.7:${server.port}` });

    // A host's lobby, told the address; then the tunnel's ahead of it while there is one, the
    // router's again once it goes; then told again, without either, once closed.
    const rooms: { internet: string | null }[] = [];
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}`);
    await new Promise<void>((resolve, reject) => {
      socket.on('error', reject);
      socket.on('open', () =>
        socket.send(
          JSON.stringify({ type: 'create', protocol: PROTOCOL_VERSION, name: 'Ada', players: 2 }),
        ),
      );
      socket.on('message', (data) => {
        const message = JSON.parse(String(data)) as { type: string; internet: string | null };
        if (message.type !== 'room') return;
        rooms.push(message);
        if (rooms.length === 1) server.setInvite('https://a-b.trycloudflare.com');
        else if (rooms.length === 2) server.setInvite(null);
        else if (rooms.length === 3) void server.setInternet(false);
        else resolve();
      });
    });
    socket.close();
    expect(rooms.map((r) => r.internet)).toEqual([
      `http://203.0.113.7:${server.port}`,
      'https://a-b.trycloudflare.com',
      `http://203.0.113.7:${server.port}`,
      null,
    ]);
    expect(server.internet).toEqual({ state: 'off' });
    await server.stop();
  });
});

describe('the static files, kept by the browser', () => {
  it('tags a file by its size and time, and answers a matching tag with 304', () => {
    const file = { size: 9000, mtimeMs: 1_700_000_000_000.5 };
    const { status, etag } = staticAnswer(file, undefined);
    expect(status).toBe(200);
    expect(staticAnswer(file, etag)).toEqual({ status: 304, etag });
    expect(staticAnswer(file, `W/"other", ${etag}`).status).toBe(304);
    expect(staticAnswer({ ...file, size: 9001 }, etag).status).toBe(200);
    expect(staticAnswer({ ...file, mtimeMs: file.mtimeMs + 1000 }, etag).status).toBe(200);
  });

  it('serves a file once, then only says it has not changed, until it has', async () => {
    const clientDir = mkdtempSync(join(tmpdir(), 'bollwerk-client-'));
    mkdirSync(join(clientDir, 'audio'));
    const path = join(clientDir, 'audio', 'track.mp3');
    writeFileSync(path, 'first');
    const result = await startServer({
      root: repoRoot,
      port: 0,
      host: '127.0.0.1',
      clientDir,
      recordingsDir: mkdtempSync(join(tmpdir(), 'bollwerk-server-')),
      commit: null,
      log: () => undefined,
    });
    if (!result.ok) throw new Error(result.reason);
    const url = `http://127.0.0.1:${result.server.port}/audio/track.mp3`;

    const first = await fetch(url);
    expect(first.status).toBe(200);
    expect(first.headers.get('cache-control')).toBe('no-cache');
    expect(first.headers.get('content-type')).toBe('audio/mpeg');
    expect(first.headers.get('content-length')).toBe('5');
    expect(await first.text()).toBe('first');
    const etag = first.headers.get('etag') ?? '';

    const again = await fetch(url, { headers: { 'if-none-match': etag } });
    expect(again.status).toBe(304);
    expect(await again.text()).toBe('');

    writeFileSync(path, 'second, longer');
    utimesSync(path, new Date(), new Date(Date.now() + 5000));
    const changed = await fetch(url, { headers: { 'if-none-match': etag } });
    expect(changed.status).toBe(200);
    expect(await changed.text()).toBe('second, longer');
    expect(changed.headers.get('etag')).not.toBe(etag);
    await result.server.stop();
  });
});
