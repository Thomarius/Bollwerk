import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize } from 'node:path';

import { loadConfigBundle } from '@bollwerk/config/node';
import {
  PROTOCOL_VERSION,
  decodeClientMessage,
  encode,
  type RoomList,
  type ServerMessage,
} from '@bollwerk/protocol';
import { WebSocketServer, type WebSocket } from 'ws';

import { openableUrls } from './addresses.js';
import type { Connection, Room } from './room.js';
import { openRecordingStore } from './recordings.js';
import { codeVersion } from './version.js';
import { RoomManager } from './rooms.js';
import { PortOpener, type InternetStatus } from './upnp.js';

/**
 * The server as something a program starts and stops (PLAN 11.17 A1): the command line in
 * `main.ts` for `npm start` and the image, and the desktop app for a release. Everything
 * found by walking up from the server's own file before is passed in, since a packaged
 * app keeps its config and client in its resources and cannot write recordings inside
 * itself.
 */

/**
 * A message as sent, encoded once however many seats it goes to: a room broadcasts the
 * same message object to every connection, thirty times a second. Kept by the object,
 * which nothing changes once it is sent.
 */
const encodings = new WeakMap<ServerMessage, string>();
function encoded(message: ServerMessage): string {
  let text = encodings.get(message);
  if (text === undefined) {
    text = encode(message);
    encodings.set(message, text);
  }
  return text;
}

export interface ServerOptions {
  /** Where `config/` is: the repository, or a packaged app's resources. */
  root: string;
  /** The built client it serves; the repository's `packages/client/dist` by default. */
  clientDir?: string;
  /**
   * Where recordings go; the config's folder under `root` by default. A packaged app passes
   * a folder of the user's, which it can write to. `recordings.enabled` still decides.
   */
  recordingsDir?: string;
  /** The config's by default. Port 0 takes any free one, as tests do. */
  port?: number;
  host?: string;
  /** The code stamped into recordings; asked of git under `root` by default. */
  commit?: string | null;
  /** Where the server's own news goes; stderr by default, as its start-up line does. */
  log?: (message: string) => void;
  /**
   * Ask the router to open the port as the server starts (PLAN 11.21): the host's choice,
   * never a default. `setInternet` changes it while running.
   */
  upnp?: boolean;
  /** The port opener; a real one by default, a fake in tests. */
  opener?: PortOpener;
}

export interface RunningServer {
  port: number;
  host: string;
  /** Where a browser can reach it: this machine, then each network address. */
  urls: string[];
  /** Closes every connection, room and timer, and resolves once the port is free. */
  stop(): Promise<void>;
  /** Whether the port is open to the internet, and where. */
  readonly internet: InternetStatus;
  /** Asks the router to open the port, or closes it; resolves with what happened. */
  setInternet(on: boolean): Promise<InternetStatus>;
  /** Told whenever `internet` changes. */
  onInternet(listener: (status: InternetStatus) => void): void;
}

/** A start that could not bind: told as such, so a caller can say so rather than crash. */
export type StartResult =
  | { ok: true; server: RunningServer }
  | { ok: false; reason: 'port_in_use' | 'no_permission'; port: number; host: string };

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  // Audio cues may be supplied in any format the browser can decode, so the manifest
  // names whatever file exists and this has to be able to describe it. `decodeAudioData`
  // reads the bytes and ignores the content type, so getting one of these wrong is not
  // fatal — but serving a sound as an unknown binary blob confuses caches and anything
  // else that looks at the response before the game does.
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
};

export async function startServer(options: ServerOptions): Promise<StartResult> {
  const bundle = loadConfigBundle(options.root);
  const log = options.log ?? ((message: string) => console.error(message));
  const clientDist = options.clientDir ?? join(options.root, 'packages', 'client', 'dist');
  const port = options.port ?? bundle.server.port;
  const host = options.host ?? bundle.server.host;

  /**
   * Recordings of every match, for tuning the rules against people rather than bots; see
   * `recordings.ts`. On by default: the files are small, and a test session is exactly the
   * data there is least of.
   */
  const store = bundle.server.recordings.enabled
    ? openRecordingStore(
        options.recordingsDir ?? join(options.root, bundle.server.recordings.dir),
        bundle.server.recordings.maxUploadBytes,
        bundle,
        log,
        options.commit === undefined ? codeVersion(options.root) : options.commit,
      )
    : null;
  // The public address while the port is open, for the lobby's invitation (PLAN 11.21).
  let internet: InternetStatus = { state: 'off' };
  const internetListeners: ((status: InternetStatus) => void)[] = [];
  const rooms = new RoomManager(
    bundle,
    undefined,
    store === null ? undefined : () => store.writer(),
    () => (internet.state === 'open' ? internet.url : null),
  );

  /**
   * A local match's recording, sent a few lines at a time by the browser playing it:
   * `POST /recordings/<id>` with the lines as the body.
   */
  const receiveRecording = (req: IncomingMessage, res: ServerResponse, id: string): void => {
    if (store === null) {
      res.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > bundle.server.recordings.maxUploadBytes) req.destroy();
      else chunks.push(chunk);
    });
    req.on('end', () => {
      const result = store.upload(id, Buffer.concat(chunks).toString('utf8'));
      res.writeHead(result.ok ? 204 : 400, { 'content-type': 'text/plain' });
      res.end(result.ok ? undefined : result.reason);
    });
  };

  /** Serves the built client, so one process is the whole deployment. */
  const serveStatic = (req: IncomingMessage, res: ServerResponse): void => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const rel = normalize(url.pathname).replace(/^(\.\.[/\\])+/, '');
    let file = join(clientDist, rel);
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(clientDist, 'index.html');

    if (!existsSync(file)) {
      res.writeHead(503, { 'content-type': 'text/plain' });
      res.end('client not built — run: npm run build -w @bollwerk/client');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  };

  const http = createServer((req, res) => {
    const upload = /^\/recordings\/([^/]+)$/.exec(req.url ?? '');
    if (req.method === 'POST' && upload !== null) {
      receiveRecording(req, res, upload[1] as string);
      return;
    }
    // The games browser: open public rooms, polled by the menu, which has no socket open.
    // With the protocol, so a page from an older build can tell it cannot join them.
    if (req.method === 'GET' && (req.url ?? '').split('?')[0] === '/api/rooms') {
      const body: RoomList = { protocol: PROTOCOL_VERSION, rooms: rooms.listOpen() };
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(body));
      return;
    }
    serveStatic(req, res);
  });

  // Bind first: a port somebody else holds is the one failure a host will meet, and it
  // must come back as an answer, not as an error thrown from deep inside the server.
  const bound = await new Promise<'ok' | 'port_in_use' | 'no_permission'>((resolve, reject) => {
    const failed = (error: NodeJS.ErrnoException): void => {
      if (error.code === 'EADDRINUSE') resolve('port_in_use');
      else if (error.code === 'EACCES') resolve('no_permission');
      else reject(error);
    };
    http.once('error', failed);
    http.listen(port, host, () => {
      http.off('error', failed);
      resolve('ok');
    });
  });
  if (bound !== 'ok') return { ok: false, reason: bound, port, host };

  const wss = new WebSocketServer({ server: http });
  let nextConnectionId = 0;
  /** Which room each connection is in, so later messages can be routed without a scan. */
  const joined = new Map<string, Room>();

  wss.on('connection', (socket: WebSocket) => {
    const id = `c${nextConnectionId++}`;
    let messagesThisSecond = 0;
    let windowStart = Date.now();

    const connection: Connection = {
      id,
      send(message: ServerMessage) {
        if (socket.readyState === socket.OPEN) socket.send(encoded(message));
      },
      close(reason: string) {
        connection.send({ type: 'error', code: 'closed', message: reason });
        socket.close();
      },
    };

    socket.on('message', (raw: Buffer | string) => {
      const now = Date.now();
      if (now - windowStart > 1000) {
        windowStart = now;
        messagesThisSecond = 0;
      }
      if (++messagesThisSecond > bundle.server.limits.maxMessagesPerSecond) return;

      const text = typeof raw === 'string' ? raw : raw.toString('utf8');
      if (text.length > bundle.server.limits.maxMessageBytes) return;

      const message = decodeClientMessage(text);
      if (message === null) {
        connection.send({ type: 'error', code: 'bad_message', message: 'unparseable message' });
        return;
      }

      if (message.type === 'create' || message.type === 'join') {
        if (message.protocol !== PROTOCOL_VERSION) {
          connection.close(`protocol ${message.protocol} is not ${PROTOCOL_VERSION}`);
          return;
        }
        // One room a connection: a second seat was left behind still connected when the
        // socket closed, so its room was never emptied and never closed, and a match never
        // handed it to a bot. The client opens a new socket for every room.
        if (joined.has(connection.id)) {
          connection.send({ type: 'error', code: 'in_a_room', message: 'already in a room' });
          return;
        }
      }

      if (message.type === 'create') {
        const room = rooms.create(message.players, message.public ?? true);
        if (room === null) {
          connection.send({ type: 'error', code: 'no_capacity', message: 'server is full' });
          return;
        }
        room.join(connection, message.name);
        joined.set(connection.id, room);
        return;
      }

      if (message.type === 'join') {
        const room = rooms.get(message.code);
        if (room === undefined) {
          connection.send({ type: 'error', code: 'no_room', message: 'no room with that code' });
          return;
        }
        if (room.join(connection, message.name, message.token) === null) {
          connection.send({ type: 'error', code: 'room_full', message: 'that room is full' });
          return;
        }
        joined.set(connection.id, room);
        return;
      }

      // Everything else is only meaningful inside a room this connection is in.
      const room = joined.get(connection.id);
      if (room === undefined) {
        connection.send({ type: 'error', code: 'no_room', message: 'join a room first' });
        return;
      }
      room.handle(connection, message);
    });

    const forget = (): void => {
      joined.get(connection.id)?.leave(connection);
      joined.delete(connection.id);
    };
    socket.on('close', forget);
    socket.on('error', forget);
  });

  const tickMs = 1000 / bundle.ruleset.tickRateHz;
  let last = Date.now();
  const ticking = setInterval(() => {
    const now = Date.now();
    rooms.update(now - last);
    last = now;
  }, tickMs);

  const address = http.address();
  const actualPort = typeof address === 'object' && address !== null ? address.port : port;
  let stopping: Promise<void> | null = null;
  const opener =
    options.opener ??
    new PortOpener({
      leaseSeconds: bundle.server.upnp.leaseSeconds,
      searchMs: bundle.server.upnp.searchMs,
      interfaces: networkInterfaces,
    });
  const announce = (status: InternetStatus): InternetStatus => {
    internet = status;
    rooms.refreshLobbies();
    for (const listener of internetListeners) listener(status);
    return status;
  };
  // The latest request wins: an answer to one the host has since withdrawn is dropped.
  let request = 0;
  const setInternet = async (on: boolean): Promise<InternetStatus> => {
    const mine = ++request;
    if (!on) {
      await opener.close();
      return announce({ state: 'off' });
    }
    announce({ state: 'searching' });
    const status = await opener.open(actualPort);
    if (mine !== request || stopping !== null) return internet;
    if (status.state === 'open') log(`reachable from the internet at ${status.url}`);
    return announce(status);
  };
  if (options.upnp === true) void setInternet(true);
  return {
    ok: true,
    server: {
      get internet() {
        return internet;
      },
      setInternet,
      onInternet(listener) {
        internetListeners.push(listener);
      },
      port: actualPort,
      host,
      // The addresses to open, not the one bound: a browser refuses http://0.0.0.0:8080.
      urls: openableUrls(host, actualPort, networkInterfaces()),
      stop() {
        // The mapping goes first, so a router is not left pointing at a port nobody holds;
        // bounded, since a router that does not answer must not hold up a stop.
        const unmapped = Promise.race([
          opener.close(),
          new Promise<void>((resolve) => setTimeout(resolve, 2000).unref()),
        ]);
        stopping ??= new Promise<void>((resolve) => {
          clearInterval(ticking);
          for (const client of wss.clients) client.terminate();
          wss.close();
          http.closeAllConnections();
          http.close(() => resolve());
        }).then(() => unmapped);
        return stopping;
      },
    },
  };
}
