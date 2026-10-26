import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, mkdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Cloudflare's tunnel program, fetched the first time the host shares a link online and kept
 * in the app's data folder — not shipped with the app, which most hosts never need it for.
 *
 * One release, pinned with its checksums as GitHub published them, so what runs is exactly
 * what was checked; a newer release is taken by changing these lines. Windows on ARM runs the
 * x64 build emulated, as Cloudflare publishes no other.
 */
export const CLOUDFLARED_VERSION = '2026.10.4';

const BUILDS: Record<string, { asset: string; sha256: string }> = {
  'win32-x64': {
    asset: 'cloudflared-windows-amd64.exe',
    sha256: '411b16d40c8d872243efeb52c550053d00af0a8a97fbb32e730fb8aba429eaa8',
  },
  'linux-x64': {
    asset: 'cloudflared-linux-amd64',
    sha256: 'ae5e8add7884b0531d66bbca4570d1de491ff6da51e4ebe7eb160cdf241d9e42',
  },
  'linux-arm64': {
    asset: 'cloudflared-linux-arm64',
    sha256: '2b7203b4fb0ba28a0c1e12f8855ce2c25f76d266a8d5edafac5540b6812acff6',
  },
};
BUILDS['win32-arm64'] = BUILDS['win32-x64']!;

/** No build of the program for this system. */
export class UnsupportedSystem extends Error {}

async function sha256Of(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

/**
 * The program's path in `dir`, fetched and checked first if it is not there yet; `progress`
 * hears how much of the download has arrived, 0–100. Throws when the system has no build,
 * the download fails or what arrived is not what was published.
 */
export async function cloudflaredBinary(
  dir: string,
  progress: (percent: number) => void,
  platform = `${process.platform}-${process.arch}`,
): Promise<string> {
  const build = BUILDS[platform];
  if (build === undefined) throw new UnsupportedSystem(platform);
  const file = join(
    dir,
    `cloudflared-${CLOUDFLARED_VERSION}${platform.startsWith('win32') ? '.exe' : ''}`,
  );
  // Checked again at every start, not only after the download: a file changed since is not run.
  const there = await stat(file).catch(() => null);
  if (there !== null && (await sha256Of(file)) === build.sha256) return file;

  await mkdir(dir, { recursive: true });
  const part = `${file}.part`;
  const url = `https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/${build.asset}`;
  const response = await fetch(url);
  if (!response.ok || response.body === null) throw new Error(`HTTP ${response.status}`);
  const total = Number(response.headers.get('content-length')) || 0;
  const hash = createHash('sha256');
  const out = createWriteStream(part);
  let received = 0;
  let told = -1;
  try {
    const reader = response.body.getReader();
    for (;;) {
      const { done, value: bytes } = await reader.read();
      if (done) break;
      hash.update(bytes);
      if (!out.write(bytes)) await new Promise((resolve) => out.once('drain', resolve));
      received += bytes.length;
      const percent = total > 0 ? Math.min(100, Math.floor((received / total) * 100)) : 0;
      if (percent !== told) progress((told = percent));
    }
    await new Promise<void>((resolve, reject) =>
      out.end((e?: Error | null) => (e ? reject(e) : resolve())),
    );
  } catch (e) {
    out.destroy();
    await rm(part, { force: true });
    throw e;
  }
  if (hash.digest('hex') !== build.sha256) {
    await rm(part, { force: true });
    throw new Error('the download was not the published file');
  }
  await chmod(part, 0o755);
  await rename(part, file);
  return file;
}
