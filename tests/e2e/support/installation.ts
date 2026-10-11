// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  cpSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  BASE_URL,
  CATALOG,
  DATABASE,
  DIST,
  INSTALLATION,
  KEYS,
  KEY_NAME,
  ADMIN,
  MODEL_URL,
  SMTP_PORT,
  WINDOWS,
  WORK,
} from './env.js';
import { index, signingTool } from './tools.js';

const LOG = join(WORK, 'installation.log');

/** The settings of the test installation, as in config/application.properties. */
export type Settings = Record<string, string>;

export function defaultSettings(): Settings {
  return {
    'quarkus.datasource.jdbc.url': DATABASE.url,
    'quarkus.datasource.username': DATABASE.username,
    'quarkus.datasource.password': DATABASE.password,
    'mosaikit.bootstrap.admin-password': ADMIN.password,
    'quarkus.http.port': new URL(BASE_URL).port,
    // The default of the installation: a path relative to it.
    'mosaikit.marketplace.sources': 'catalog/',
    'mosaikit.assistant.url': MODEL_URL,
    'mosaikit.assistant.model': 'e2e-fake-model',
    // Mails go to the fake server of the global setup (MK-048).
    'quarkus.mailer.host': 'localhost',
    'quarkus.mailer.port': String(SMTP_PORT),
    'quarkus.mailer.start-tls': 'DISABLED',
  };
}

/**
 * A copy of the installation and of the catalog that `./mvnw install` writes to target/dist, with a
 * signing key of the tests that the installation trusts.
 */
export function prepare(): void {
  if (!existsSync(join(DIST, 'mosaikit', 'catalog', 'index.json'))) {
    throw new Error(`Build first: ./mvnw install -DskipTests (no ${DIST}/mosaikit/catalog)`);
  }
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  cpSync(join(DIST, 'mosaikit'), INSTALLATION, { recursive: true });
  // Artifacts of the CI keep no empty directory: the installation has no plugins yet.
  mkdirSync(join(INSTALLATION, 'plugins'), { recursive: true });
  if (!WINDOWS) {
    chmodSync(join(INSTALLATION, 'mosaikit'), 0o755);
  }
  mkdirSync(KEYS, { recursive: true });
  signingTool('keygen', KEYS, KEY_NAME);
  copyFileSync(
    join(KEYS, `${KEY_NAME}.pub.pem`),
    join(INSTALLATION, 'config', 'trusted-keys', `${KEY_NAME}.pub.pem`),
  );
  // The index of the build is signed by the build key; the tests re-index with theirs.
  index(CATALOG);
}

export function configure(settings: Settings): void {
  const lines = Object.entries(settings).map(([key, value]) => `${key}=${value}`);
  writeFileSync(join(INSTALLATION, 'config', 'application.properties'), lines.join('\n') + '\n');
}

let launcher: ChildProcess | undefined;

/** Starts the launcher and waits until the kernel is ready. */
export async function start(): Promise<void> {
  const log = createWriteStream(LOG, { flags: 'a' });
  const script = WINDOWS ? `"${join(INSTALLATION, 'mosaikit.cmd')}"` : './mosaikit';
  launcher = spawn(script, [], {
    cwd: INSTALLATION,
    shell: WINDOWS,
    detached: !WINDOWS,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  launcher.stdout?.pipe(log);
  launcher.stderr?.pipe(log);
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (launcher.exitCode !== null) {
      throw new Error(`The installation stopped (exit ${String(launcher.exitCode)}); see ${LOG}`);
    }
    try {
      const response = await fetch(`${BASE_URL}/q/health/ready`);
      if (response.ok) {
        return;
      }
    } catch {
      // not yet
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`The installation did not become ready; see ${LOG}`);
}

/** Stops the launcher and the kernel it started. */
export async function stop(): Promise<void> {
  const process_ = launcher;
  launcher = undefined;
  if (process_?.pid === undefined || process_.exitCode !== null) {
    return;
  }
  const exited = new Promise((resolve) => process_.once('exit', resolve));
  if (WINDOWS) {
    try {
      execFileSync('taskkill', ['/pid', String(process_.pid), '/t', '/f'], { stdio: 'ignore' });
    } catch {
      // already gone
    }
  } else {
    try {
      process.kill(-process_.pid, 'SIGTERM');
    } catch {
      // already gone
    }
  }
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 30_000))]);
  // The port must be free before the next start.
  for (let i = 0; i < 30; i++) {
    try {
      await fetch(`${BASE_URL}/q/health/ready`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch {
      return;
    }
  }
}

/** The part of the log written since a mark (the length of the log before). */
export function logSince(mark: number): string {
  return existsSync(LOG) ? readFileSync(LOG, 'utf8').slice(mark) : '';
}

export function logLength(): number {
  return existsSync(LOG) ? readFileSync(LOG, 'utf8').length : 0;
}
