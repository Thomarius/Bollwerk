import { loadConfigBundle } from '@bollwerk/config/node';
import { PROTOCOL_VERSION } from '@bollwerk/protocol';

import { repoRoot } from './paths.js';
import { startServer } from './server.js';

/**
 * The server from the command line: `npm start`, and the image. The server itself is
 * `startServer` (`server.ts`), which the desktop app starts and stops as well.
 *
 * Where to listen is the one thing the environment is allowed to say. Every game rule
 * lives in `config/*.json` behind a strict schema and is reachable from nowhere else — a
 * rule that could be changed by an environment variable is a rule two clients could
 * disagree about, which is a desync rather than a setting. A port is not a rule: it is
 * where this process binds, and hosts like Fly and Railway hand it to us in `$PORT` rather
 * than letting us choose. So these two read the environment first and the config file
 * second, and nothing else does.
 */
const portText = process.env['PORT'];
const port = portText === undefined ? undefined : Number(portText);
if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) {
  console.error(`PORT must be a port number, got ${JSON.stringify(portText)}`);
  process.exit(1);
}

// Opening the port on the router is the host's choice (PLAN 11.21): `npm start -- --upnp`.
// A flag, not the environment: the image must never ask, and nothing in it passes one.
const upnp = process.argv.slice(2).includes('--upnp');

const started = await startServer({
  root: repoRoot,
  upnp,
  ...(port === undefined ? {} : { port }),
  ...(process.env['HOST'] === undefined ? {} : { host: process.env['HOST'] }),
});
if (!started.ok) {
  console.error(
    started.reason === 'port_in_use'
      ? `port ${started.port} is already in use — is another server running? (PORT=... picks another)`
      : `not allowed to listen on port ${started.port}`,
  );
  process.exit(1);
}

const { server } = started;
const [first, ...others] = server.urls;
console.error(
  `bollwerk server on ${first} (protocol ${PROTOCOL_VERSION}, ${loadConfigBundle(repoRoot).ruleset.tickRateHz}Hz)`,
);
for (const url of others) console.error(`  on the network at ${url}`);
if (upnp) {
  console.error(`  asking the router to open port ${server.port} to the internet…`);
  server.onInternet((status) => {
    // The server itself says where it is reachable; the failures are said here.
    if (status.state === 'no_router') {
      console.error(
        `  the router did not answer (UPnP is off on it, or not supported): forward port ${server.port} by hand`,
      );
    } else if (status.state === 'refused') {
      console.error(
        `  the router would not open port ${server.port} (${status.detail}): forward it by hand`,
      );
    } else if (status.state === 'no_public_address') {
      console.error(
        `  this connection has no public address (${status.address}): no router setting can open it`,
      );
    } else if (status.state === 'open' && status.ipv6 !== null) {
      console.error(
        `  guests with IPv6 may also reach http://[${status.ipv6}]:${server.port}, if the router lets them`,
      );
    }
  });
}
