import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PROTOCOL_VERSION } from '@bollwerk/protocol';
import { describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import { repoRoot } from './paths.js';
import { startServer, type RunningServer } from './server.js';

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
