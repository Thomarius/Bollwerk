import type { NetworkInterfaceInfo } from 'node:os';

import { describe, expect, it } from 'vitest';

import {
  PortOpener,
  addressFacing,
  addressKind,
  publicIpv6,
  type FindRouter,
  type Router,
} from './upnp.js';

const info = (address: string, family: 'IPv4' | 'IPv6' = 'IPv4'): NetworkInterfaceInfo =>
  ({ address, family, internal: false, netmask: '', mac: '', cidr: null }) as NetworkInterfaceInfo;

const home = { eth: [info('10.0.0.5'), info('192.168.178.20'), info('2a01:db8::20', 'IPv6')] };

/** A router that remembers what it was asked. */
function fakeRouter(outside = '203.0.113.7', refuse = false) {
  const log: string[] = [];
  const router: Router = {
    host: '192.168.178.1',
    externalIp: () => Promise.resolve(outside),
    map: (port, host, o) => {
      log.push(`map ${host}:${port} -> ${o.externalPort} for ${o.ttl}s`);
      return refuse
        ? Promise.reject(new Error('ConflictInMappingEntry'))
        : Promise.resolve({ externalHost: outside, externalPort: o.externalPort });
    },
    unmap: (port) => {
      log.push(`unmap ${port}`);
      return Promise.resolve();
    },
    stop: () => {
      log.push('stop');
      return Promise.resolve();
    },
  };
  return { router, log };
}

const opener = (find: FindRouter) =>
  new PortOpener({ leaseSeconds: 3600, searchMs: 10, interfaces: () => home, find });

describe('opening the port on the router', () => {
  it('maps the port from the address facing the router, and removes it on close', async () => {
    const { router, log } = fakeRouter();
    const o = opener(() => Promise.resolve(router));
    expect(await o.open(8080)).toEqual({
      state: 'open',
      url: 'http://203.0.113.7:8080',
      ipv6: '2a01:db8::20',
    });
    await o.close();
    expect(log).toEqual(['map 192.168.178.20:8080 -> 8080 for 3600s', 'unmap 8080', 'stop']);
  });

  it('says when no router answers', async () => {
    expect(await opener(() => Promise.resolve(null)).open(8080)).toEqual({ state: 'no_router' });
  });

  it('says when the router refuses, and lets it go', async () => {
    const { router, log } = fakeRouter('203.0.113.7', true);
    const result = await opener(() => Promise.resolve(router)).open(8080);
    expect(result).toEqual({ state: 'refused', detail: 'ConflictInMappingEntry' });
    expect(log.at(-1)).toBe('stop');
  });

  it('does not map at all on a line with no public address', async () => {
    const { router, log } = fakeRouter('100.70.1.2');
    const result = await opener(() => Promise.resolve(router)).open(8080);
    expect(result).toEqual({ state: 'no_public_address', address: '100.70.1.2' });
    expect(log).toEqual(['stop']);
  });

  it('drops an answer that arrives after the host switched it off', async () => {
    const { router, log } = fakeRouter();
    let answer: (r: Router) => void = () => {};
    const o = opener(() => new Promise((resolve) => (answer = resolve)));
    const opening = o.open(8080);
    await o.close();
    answer(router);
    expect(await opening).toEqual({ state: 'off' });
    expect(log).toEqual(['stop']);
  });
});

describe('addresses', () => {
  it('tells public from private and carrier-grade', () => {
    expect(addressKind('203.0.113.7')).toBe('public');
    expect(addressKind('192.168.0.1')).toBe('private');
    expect(addressKind('172.20.1.1')).toBe('private');
    expect(addressKind('10.1.2.3')).toBe('private');
    expect(addressKind('100.64.0.1')).toBe('shared');
    expect(addressKind('100.127.255.1')).toBe('shared');
    expect(addressKind('100.128.0.1')).toBe('public');
    expect(addressKind('nonsense')).toBe('private');
  });

  it('picks the address on the router’s network, and a public IPv6 one', () => {
    expect(addressFacing('192.168.178.1', home)).toBe('192.168.178.20');
    expect(addressFacing('172.16.0.1', home)).toBe('10.0.0.5');
    expect(publicIpv6(home)).toBe('2a01:db8::20');
    expect(publicIpv6({ eth: [info('fe80::1', 'IPv6')] })).toBeNull();
  });
});
