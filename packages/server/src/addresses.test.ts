import type { NetworkInterfaceInfo } from 'node:os';
import { describe, expect, it } from 'vitest';

import { openableUrls } from './addresses.js';

const info = (address: string, family: 'IPv4' | 'IPv6', internal: boolean) =>
  ({ address, family, internal }) as NetworkInterfaceInfo;

const interfaces = {
  loopback: [info('127.0.0.1', 'IPv4', true), info('::1', 'IPv6', true)],
  ethernet: [info('192.168.1.20', 'IPv4', false), info('fe80::1', 'IPv6', false)],
  wifi: [info('10.0.0.5', 'IPv4', false)],
};

describe('the startup line’s addresses', () => {
  it('offers localhost and each network address, never the bind-all address', () => {
    expect(openableUrls('0.0.0.0', 8080, interfaces)).toEqual([
      'http://localhost:8080',
      'http://192.168.1.20:8080',
      'http://10.0.0.5:8080',
    ]);
  });

  it('prints a host it was bound to as it is', () => {
    expect(openableUrls('127.0.0.1', 8091, interfaces)).toEqual(['http://127.0.0.1:8091']);
    expect(openableUrls('::1', 8091, interfaces)).toEqual(['http://[::1]:8091']);
  });

  it('still offers localhost with no network at all', () => {
    expect(openableUrls('0.0.0.0', 8080, { loopback: interfaces.loopback })).toEqual([
      'http://localhost:8080',
    ]);
  });
});
