import type { NetworkInterfaceInfo } from 'node:os';

/**
 * Where a browser can reach the server, for the startup line. Bound to every interface —
 * 0.0.0.0, the default — the bind address itself is no address to open: a browser refuses
 * http://0.0.0.0:8080 outright, which is what the line used to print. So: localhost for this
 * machine, and each of its network addresses for the others at a test session.
 */
export function openableUrls(
  host: string,
  port: number,
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>,
): string[] {
  const everywhere = host === '0.0.0.0' || host === '::' || host === '';
  if (!everywhere) return [`http://${host.includes(':') ? `[${host}]` : host}:${port}`];
  const network = Object.values(interfaces)
    .flatMap((list) => list ?? [])
    .filter((info) => info.family === 'IPv4' && !info.internal)
    .map((info) => `http://${info.address}:${port}`);
  return [`http://localhost:${port}`, ...network];
}
