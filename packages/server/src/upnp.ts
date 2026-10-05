import type { NetworkInterfaceInfo } from 'node:os';

import { upnpNat } from '@achingbrain/nat-port-mapper';

/**
 * Opening the host's port on their router (UPnP IGD, PLAN 11.21), so friends outside the
 * house can join without anyone forwarding a port by hand — where the router allows it,
 * and saying plainly when it does not.
 *
 * Only the one port, only while the server runs: a lease the library renews, removed as the
 * server stops, and lapsing by itself if the process dies. Whether to ask at all is the
 * host's choice — the desktop app's switch, or `npm start -- --upnp` — never a default.
 */

/** What became of the request, for the host to read. */
export type InternetStatus =
  | { state: 'off' }
  | { state: 'searching' }
  /** Open: reachable at `url`; `ipv6` a public IPv6 address of this machine, if any. */
  | { state: 'open'; url: string; ipv6: string | null }
  /** No router answered: UPnP is switched off on it, or it does not speak it. */
  | { state: 'no_router' }
  /** A router answered and would not map the port. */
  | { state: 'refused'; detail: string }
  /**
   * The router's own outside address is private or carrier-grade (100.64.0.0/10): this
   * line has no public IPv4 address at all — DS-Lite cable, some fibre and mobile — and
   * no router setting can change it.
   */
  | { state: 'no_public_address'; address: string };

/** The part of a router this needs; the library's gateway, or a fake in tests. */
export interface Router {
  /** The router's own address on the home network. */
  host: string;
  externalIp(): Promise<string>;
  map(
    internalPort: number,
    internalHost: string,
    options: { externalPort: number; protocol: 'TCP'; ttl: number; description: string },
  ): Promise<{ externalHost: string; externalPort: number }>;
  unmap(internalPort: number): Promise<void>;
  stop(): Promise<void>;
}

/** Looks for a router for `searchMs`; null when none answers. */
export type FindRouter = (searchMs: number, leaseSeconds: number) => Promise<Router | null>;

/** The library's search: the first IPv4 internet gateway to answer. */
export const findRouter: FindRouter = async (searchMs, leaseSeconds) => {
  const client = upnpNat({ ttl: leaseSeconds, autoRefresh: true });
  try {
    for await (const gateway of client.findGateways({ signal: AbortSignal.timeout(searchMs) })) {
      if (gateway.family === 'IPv4') return gateway;
    }
  } catch {
    // The search timing out is how "no router" arrives.
  }
  return null;
};

/** Where an IPv4 address belongs: the internet, a home network, or a carrier's shared space. */
export function addressKind(ip: string): 'public' | 'private' | 'shared' {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return 'private';
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 100 && b >= 64 && b <= 127) return 'shared';
  if (a === 10 || a === 127 || a === 0) return 'private';
  if (a === 172 && b >= 16 && b <= 31) return 'private';
  if (a === 192 && b === 168) return 'private';
  if (a === 169 && b === 254) return 'private';
  return 'public';
}

/** This machine's address on the router's network: the one sharing its first three parts. */
export function addressFacing(
  router: string,
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>,
): string | null {
  const mine = Object.values(interfaces)
    .flatMap((list) => list ?? [])
    .filter((info) => info.family === 'IPv4' && !info.internal)
    .map((info) => info.address);
  const prefix = router.split('.').slice(0, 3).join('.');
  return mine.find((a) => a.startsWith(`${prefix}.`)) ?? mine[0] ?? null;
}

/**
 * A public IPv6 address of this machine (2000::/3), which a guest with IPv6 can reach
 * without any mapping — if the router's firewall lets them, which many do not by default.
 */
export function publicIpv6(interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>): string | null {
  const found = Object.values(interfaces)
    .flatMap((list) => list ?? [])
    .find((info) => info.family === 'IPv6' && !info.internal && /^[23]/.test(info.address));
  return found?.address ?? null;
}

const DESCRIPTION = 'Bollwerk game server';

/** One port's mapping, opened and closed; a later call supersedes one still in flight. */
export class PortOpener {
  private router: Router | null = null;
  private port: number | null = null;
  private generation = 0;

  constructor(
    private readonly options: {
      leaseSeconds: number;
      searchMs: number;
      interfaces: () => NodeJS.Dict<NetworkInterfaceInfo[]>;
      find?: FindRouter;
    },
  ) {}

  async open(port: number): Promise<InternetStatus> {
    // Taken before anything is awaited, so a close that comes meanwhile supersedes it.
    const mine = ++this.generation;
    await this.release();
    const { leaseSeconds, searchMs, interfaces } = this.options;
    const router = await (this.options.find ?? findRouter)(searchMs, leaseSeconds);
    if (router === null) return { state: 'no_router' };
    // Closed or reopened while the search ran: this answer belongs to nobody.
    if (mine !== this.generation) {
      await router.stop().catch(() => undefined);
      return { state: 'off' };
    }
    try {
      // Asked first: a line with no public address cannot be opened by any mapping.
      const outside = await router.externalIp();
      if (addressKind(outside) !== 'public') {
        await router.stop().catch(() => undefined);
        return { state: 'no_public_address', address: outside };
      }
      const host = addressFacing(router.host, interfaces());
      if (host === null) throw new Error('no network address of this machine faces the router');
      const mapped = await router.map(port, host, {
        externalPort: port,
        protocol: 'TCP',
        ttl: leaseSeconds,
        description: DESCRIPTION,
      });
      this.router = router;
      this.port = port;
      const external = mapped.externalHost || outside;
      return {
        state: 'open',
        url: `http://${external}:${mapped.externalPort}`,
        ipv6: publicIpv6(interfaces()),
      };
    } catch (e) {
      await router.stop().catch(() => undefined);
      return { state: 'refused', detail: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Removes the mapping, if there is one, and stops renewing it. Never throws. */
  async close(): Promise<void> {
    this.generation++;
    await this.release();
  }

  private async release(): Promise<void> {
    const { router, port } = this;
    this.router = null;
    this.port = null;
    if (router === null || port === null) return;
    await router.unmap(port).catch(() => undefined);
    await router.stop().catch(() => undefined);
  }
}
