import { execFile } from 'node:child_process';

/**
 * Whether Windows Firewall lets other computers reach the server. Windows asks the first time
 * a program listens, and a Cancel there, or an Allow ticked for private networks only while
 * this one is public, leaves the router's port open and the game still unreachable — with
 * nothing to say why. So the window reads the rules and says.
 *
 * Read through the firewall's COM interface, which any user may read; the cmdlets
 * (`Get-NetFirewallRule`) are refused without administrator rights. Nothing is changed.
 */

/** A network profile: Domain 1, Private 2, Public 4, as the firewall numbers them. */
export type Network = 'domain' | 'private' | 'public';

export type FirewallStatus =
  /** Not checked: not Windows, or not yet. */
  | { state: 'unchecked' }
  /** The firewall is off for this network. */
  | { state: 'off' }
  /** Allowed in; `localOnly` when only from this network's own addresses. */
  | { state: 'allowed'; localOnly: boolean }
  /** A rule blocks the app, which no rule allowing it overrides. */
  | { state: 'blocked'; network: Network }
  /** Allowed, but only on other kinds of network than this one. */
  | { state: 'other_network'; network: Network }
  /** No rule at all: Windows drops what comes in. */
  | { state: 'no_rule'; network: Network }
  | { state: 'unknown' };

/** What the script reports. */
export interface FirewallReport {
  /** The profiles of the networks this machine is on, a mask. */
  current: number;
  profiles: { type: number; enabled: boolean; inboundAllow: boolean }[];
  /** Inbound rules naming this program, or naming ports and no program. */
  rules: {
    enabled: boolean;
    allow: boolean;
    /** A mask of profiles. */
    profiles: number;
    /** 6 TCP, 256 any. */
    protocol: number;
    ports: string;
    app: string;
    remote: string;
  }[];
}

const NETWORKS: [number, Network][] = [
  [4, 'public'],
  [2, 'private'],
  [1, 'domain'],
];

/** Whether a rule's ports, such as `*` or `80,8000-8100`, include `port`. */
export function coversPort(ports: string, port: number): boolean {
  return ports.split(',').some((part) => {
    const p = part.trim();
    if (p === '*' || p === '') return true;
    const range = /^(\d+)-(\d+)$/.exec(p);
    if (range !== null) return Number(range[1]) <= port && port <= Number(range[2]);
    return Number(p) === port;
  });
}

/** What the rules mean for this server on its port. */
export function firewallVerdict(report: FirewallReport, port: number): FirewallStatus {
  const on = NETWORKS.filter(
    ([type]) =>
      (report.current & type) !== 0 &&
      report.profiles.find((p) => p.type === type)?.enabled !== false,
  );
  if (on.length === 0) return { state: 'off' };
  const applies = report.rules.filter(
    (r) =>
      r.enabled &&
      (r.protocol === 6 || r.protocol === 256) &&
      // A rule naming a program applies to its ports; a rule naming none, only to the ones named.
      (r.app !== '' ? coversPort(r.ports, port) : r.ports !== '*' && coversPort(r.ports, port)),
  );
  // A blocking rule wins over every rule allowing.
  for (const [type, network] of on) {
    if (applies.some((r) => !r.allow && (r.profiles & type) !== 0))
      return { state: 'blocked', network };
  }
  let localOnly = true;
  for (const [type, network] of on) {
    const allowing = applies.filter((r) => r.allow && (r.profiles & type) !== 0);
    if (allowing.length === 0) {
      if (report.profiles.find((p) => p.type === type)?.inboundAllow === true) {
        localOnly = false;
        continue;
      }
      return applies.some((r) => r.allow)
        ? { state: 'other_network', network }
        : { state: 'no_rule', network };
    }
    if (allowing.some((r) => r.remote === '*' || r.remote === '')) localOnly = false;
  }
  return { state: 'allowed', localOnly };
}

/**
 * The rules as the script reads them. Rules for a service rather than a program never apply to
 * the app, and are left out; paths are compared with their variables expanded, ignoring case.
 */
const SCRIPT = `
$ErrorActionPreference = 'Stop'
$f = New-Object -ComObject HNetCfg.FwPolicy2
$exe = $env:BOLLWERK_EXE
$profiles = @(1, 2, 4 | ForEach-Object {
  [pscustomobject]@{ type = $_; enabled = [bool]$f.FirewallEnabled($_); inboundAllow = ($f.DefaultInboundAction($_) -eq 1) }
})
$rules = @($f.Rules | Where-Object {
  $_.Direction -eq 1 -and -not $_.ServiceName -and (
    ($_.ApplicationName -and [Environment]::ExpandEnvironmentVariables($_.ApplicationName) -ieq $exe) -or
    (-not $_.ApplicationName -and $_.LocalPorts -and $_.LocalPorts -ne '*'))
} | ForEach-Object {
  [pscustomobject]@{ enabled = [bool]$_.Enabled; allow = ($_.Action -eq 1); profiles = [int]$_.Profiles;
    protocol = [int]$_.Protocol; ports = [string]$_.LocalPorts; app = [string]$_.ApplicationName;
    remote = [string]$_.RemoteAddresses }
})
[pscustomobject]@{ current = [int]$f.CurrentProfileTypes; profiles = $profiles; rules = $rules } |
  ConvertTo-Json -Depth 4 -Compress
`;

/** PowerShell's JSON may give a list of one as the one; a list either way. */
function list<T>(value: T | T[] | null | undefined): T[] {
  return value === null || value === undefined ? [] : Array.isArray(value) ? value : [value];
}

/** Reads the rules for `exe` and says what they mean on `port`; `unchecked` off Windows. */
export function checkFirewall(exe: string, port: number): Promise<FirewallStatus> {
  if (process.platform !== 'win32') return Promise.resolve({ state: 'unchecked' });
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', SCRIPT],
      // The path goes in by the environment, so nothing in it is read as script.
      { env: { ...process.env, BOLLWERK_EXE: exe }, timeout: 20_000, windowsHide: true },
      (error, stdout) => {
        if (error !== null) return resolve({ state: 'unknown' });
        try {
          const raw = JSON.parse(stdout) as FirewallReport;
          resolve(
            firewallVerdict(
              { current: raw.current, profiles: list(raw.profiles), rules: list(raw.rules) },
              port,
            ),
          );
        } catch {
          resolve({ state: 'unknown' });
        }
      },
    );
  });
}
