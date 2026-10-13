// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import {
  chmodSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const WINDOWS = process.platform === 'win32';

/** Where the snapshots and the releases of Mosaikit are published (ADR-0035). */
export const RELEASES = 'https://github.com/mosaikit/mosaikit/releases/download';

/** The settings of an installation, as in config/application.properties. */
export type Settings = Record<string, string>;

/** The version of Mosaikit that this package belongs to, and so the installation it tests on. */
export function ownVersion(): string {
  const manifest = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { version: string };
  return manifest.version;
}

/**
 * The address of the installation archive of a version: a snapshot of `main`
 * (`0.1.0-dev.<date>.<run>`) is in the pre-release `snapshot`, a release in its tag.
 */
export function archiveUrl(version: string): string {
  const tag = /-dev\./.test(version) ? 'snapshot' : `v${version}`;
  return `${RELEASES}/${tag}/mosaikit-${version}.tar.gz`;
}

/**
 * The directory of an installation to test on: `explicit`, else MOSAIKIT_INSTALLATION, else the
 * archive of the version of this package, downloaded once into the cache of the user.
 */
export async function locateInstallation(explicit?: string): Promise<string> {
  const given = explicit ?? process.env.MOSAIKIT_INSTALLATION;
  if (given) {
    if (!existsSync(join(given, 'bin', 'kernel'))) {
      throw new Error(`${given} is not a Mosaikit installation (no bin/kernel)`);
    }
    return given;
  }
  const version = ownVersion();
  if (version.endsWith('-SNAPSHOT')) {
    throw new Error(
      `@mosaikit/testing ${version} is a build of the repository: set MOSAIKIT_INSTALLATION to an installation (target/dist/mosaikit)`,
    );
  }
  const cache = join(
    process.env.MOSAIKIT_CACHE ?? join(homedir(), '.cache', 'mosaikit'),
    'installations',
    version,
  );
  const installation = join(cache, 'mosaikit');
  if (existsSync(join(installation, 'bin', 'kernel'))) {
    return installation;
  }
  mkdirSync(cache, { recursive: true });
  const url = archiveUrl(version);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Cannot download ${url}: ${String(response.status)}`);
  }
  const archive = join(cache, 'mosaikit.tar.gz');
  writeFileSync(archive, Buffer.from(await response.arrayBuffer()));
  const unpacked = join(cache, 'unpacked');
  rmSync(unpacked, { recursive: true, force: true });
  mkdirSync(unpacked);
  execFileSync('tar', ['-xzf', archive, '-C', unpacked]);
  renameSync(join(unpacked, 'mosaikit'), installation);
  rmSync(unpacked, { recursive: true, force: true });
  rmSync(archive, { force: true });
  return installation;
}

export function writeSettings(installation: string, settings: Settings): void {
  const lines = Object.entries(settings).map(([key, value]) => `${key}=${value}`);
  writeFileSync(join(installation, 'config', 'application.properties'), lines.join('\n') + '\n');
}

/** The launcher of an installation, started and stopped by the bench. */
export class Launcher {
  private process: ChildProcess | undefined;

  constructor(
    readonly installation: string,
    readonly baseUrl: string,
    readonly log: string,
  ) {}

  /** Starts the launcher and waits until the kernel is ready. */
  async start(timeout = 180_000): Promise<void> {
    if (!WINDOWS) {
      chmodSync(join(this.installation, 'mosaikit'), 0o755);
    }
    const log = createWriteStream(this.log, { flags: 'a' });
    const script = WINDOWS ? `"${join(this.installation, 'mosaikit.cmd')}"` : './mosaikit';
    const launcher = spawn(script, [], {
      cwd: this.installation,
      shell: WINDOWS,
      detached: !WINDOWS,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.process = launcher;
    launcher.stdout.pipe(log);
    launcher.stderr.pipe(log);
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (launcher.exitCode !== null) {
        throw new Error(
          `The installation stopped (exit ${String(launcher.exitCode)}); see ${this.log}`,
        );
      }
      try {
        if ((await fetch(`${this.baseUrl}/q/health/ready`)).ok) {
          return;
        }
      } catch {
        // not yet
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`The installation did not become ready; see ${this.log}`);
  }

  /** Stops the launcher and the kernel it started, and waits for the port to be free. */
  async stop(): Promise<void> {
    const launcher = this.process;
    this.process = undefined;
    if (launcher?.pid === undefined || launcher.exitCode !== null) {
      return;
    }
    const exited = new Promise((resolve) => launcher.once('exit', resolve));
    try {
      if (WINDOWS) {
        execFileSync('taskkill', ['/pid', String(launcher.pid), '/t', '/f'], { stdio: 'ignore' });
      } else {
        process.kill(-launcher.pid, 'SIGTERM');
      }
    } catch {
      // already gone
    }
    // The timer is cleared at once: a pending one kept Node alive for 30 s after every bench.
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      exited,
      new Promise((resolve) => {
        timer = setTimeout(resolve, 30_000);
      }),
    ]);
    clearTimeout(timer);
    launcher.stdout?.destroy();
    launcher.stderr?.destroy();
    for (let i = 0; i < 30; i++) {
      try {
        await fetch(`${this.baseUrl}/q/health/ready`);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch {
        return;
      }
    }
  }

  /** The length of the log, to read later what was written since ({@link logSince}). */
  logLength(): number {
    return existsSync(this.log) ? readFileSync(this.log, 'utf8').length : 0;
  }

  logSince(mark: number): string {
    return existsSync(this.log) ? readFileSync(this.log, 'utf8').slice(mark) : '';
  }
}
