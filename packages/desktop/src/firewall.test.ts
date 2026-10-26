import { describe, expect, it } from 'vitest';

import { coversPort, firewallVerdict, type FirewallReport } from './firewall.js';

const ALL = 0x7fffffff;
const exe = 'C:\\Users\\a\\AppData\\Local\\Temp\\Bollwerk\\Bollwerk.exe';

/** A machine on a public network with the firewall on and inbound blocked, and these rules. */
function report(rules: Partial<FirewallReport['rules'][number]>[], current = 4): FirewallReport {
  return {
    current,
    profiles: [1, 2, 4].map((type) => ({ type, enabled: true, inboundAllow: false })),
    rules: rules.map((r) => ({
      enabled: true,
      allow: true,
      profiles: ALL,
      protocol: 6,
      ports: '*',
      app: exe,
      remote: '*',
      ...r,
    })),
  };
}

describe('what Windows Firewall makes of the server', () => {
  it('reads a rule’s ports', () => {
    expect(coversPort('*', 8080)).toBe(true);
    expect(coversPort('80,8000-8100', 8080)).toBe(true);
    expect(coversPort('80, 443', 8080)).toBe(false);
    expect(coversPort('RPC', 8080)).toBe(false);
  });

  it('lets players in by Windows’ own rule, or by a rule for the port', () => {
    expect(firewallVerdict(report([{}]), 8080)).toEqual({ state: 'allowed', localOnly: false });
    expect(firewallVerdict(report([{ app: '', ports: '8080' }]), 8080)).toEqual({
      state: 'allowed',
      localOnly: false,
    });
    // UDP alone, another port, or a rule switched off do not.
    expect(
      firewallVerdict(
        report([{ protocol: 17 }, { app: '', ports: '9000' }, { enabled: false }]),
        8080,
      ),
    ).toEqual({ state: 'no_rule', network: 'public' });
  });

  it('says when the rule allows only this network’s own addresses', () => {
    expect(firewallVerdict(report([{ remote: 'LocalSubnet' }]), 8080)).toEqual({
      state: 'allowed',
      localOnly: true,
    });
  });

  it('says a Cancel’s blocking rule wins over an allowing one', () => {
    // What Windows writes when its question is answered with Private ticked and Cancel:
    // allowed on private networks, blocked on public ones.
    const answered = report([{ profiles: 2 }, { profiles: 4, allow: false }]);
    expect(firewallVerdict(answered, 8080)).toEqual({ state: 'blocked', network: 'public' });
    expect(firewallVerdict({ ...answered, current: 2 }, 8080)).toEqual({
      state: 'allowed',
      localOnly: false,
    });
  });

  it('says when it is allowed on other kinds of network only', () => {
    expect(firewallVerdict(report([{ profiles: 2 }]), 8080)).toEqual({
      state: 'other_network',
      network: 'public',
    });
  });

  it('says nothing is in the way with the firewall off, or letting everything in', () => {
    const off = report([]);
    off.profiles = off.profiles.map((p) => ({ ...p, enabled: false }));
    expect(firewallVerdict(off, 8080)).toEqual({ state: 'off' });
    const open = report([]);
    open.profiles = open.profiles.map((p) => ({ ...p, inboundAllow: true }));
    expect(firewallVerdict(open, 8080)).toEqual({ state: 'allowed', localOnly: false });
  });
});
