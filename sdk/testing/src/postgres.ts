// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import EmbeddedPostgres from 'embedded-postgres';
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/** pg_ctl of the binaries that npm installed for this platform. */
function pgCtl(): string | undefined {
  const platform = `${process.platform === 'win32' ? 'windows' : process.platform}-${process.arch}`;
  try {
    const manifest = createRequire(import.meta.url).resolve(
      `@embedded-postgres/${platform}/package.json`,
    );
    const file = join(
      dirname(manifest),
      'native',
      'bin',
      process.platform === 'win32' ? 'pg_ctl.exe' : 'pg_ctl',
    );
    return existsSync(file) ? file : undefined;
  } catch {
    return undefined;
  }
}

/**
 * On Windows an I/O worker of PostgreSQL 18 can outlive its server, and keeps the files of
 * node_modules locked so that the next npm ci fails: ends the processes of these binaries whose
 * server is gone. The servers still running, such as those of other benches, are left alone.
 */
function endOrphans(ctl: string): void {
  if (process.platform !== 'win32') {
    return;
  }
  const binaries = dirname(ctl).replaceAll('\\', '/');
  const script = [
    'Get-CimInstance Win32_Process -Filter "Name=\'postgres.exe\'"',
    `| Where-Object { $_.CommandLine -and $_.CommandLine.Replace('\\', '/') -like '*${binaries}/*'`,
    '-and -not (Get-Process -Id $_.ParentProcessId -ErrorAction SilentlyContinue) }',
    '| ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }',
  ].join(' ');
  spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
    stdio: 'ignore',
  });
}

/**
 * PostgreSQL 18 for development and the end-to-end tests, from the binaries that npm installs
 * (@embedded-postgres, the same as the portable distribution and the Java tests): no Docker, no
 * server to install.
 */
export interface Database {
  readonly url: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  stop(): Promise<void>;
}

export const USER = 'mosaikit';
export const PASSWORD = 'mosaikit';

/** A free TCP port of 127.0.0.1. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => {
        resolve(port);
      });
    });
  });
}

/**
 * Starts a server on a cluster in `directory`, initialized at the first start; `persistent: false`
 * deletes it at stop and trades durability for speed.
 */
export async function startPostgres(options: {
  directory: string;
  persistent: boolean;
  port?: number;
  database?: string;
}): Promise<Database> {
  const port = options.port ?? (await freePort());
  const database = options.database ?? 'mosaikit';
  const quick = options.persistent ? [] : ['-c', 'fsync=off', '-c', 'synchronous_commit=off'];
  const server = new EmbeddedPostgres({
    databaseDir: options.directory,
    port,
    user: USER,
    password: PASSWORD,
    persistent: options.persistent,
    // A disposable cluster needs no sync to disk while it is created.
    initdbFlags: ['--locale=C', '--encoding=UTF8', ...(options.persistent ? [] : ['--no-sync'])],
    postgresFlags: ['-c', 'listen_addresses=127.0.0.1', '-c', 'unix_socket_directories=', ...quick],
    onLog: () => undefined,
    onError: (message: unknown) => {
      process.stderr.write(`[postgres] ${String(message)}\n`);
    },
  });
  if (!existsSync(join(options.directory, 'PG_VERSION'))) {
    await server.initialise();
  }
  await server.start();
  try {
    await server.createDatabase(database);
  } catch {
    // It exists already: a persistent cluster of a previous run.
  }
  return {
    url: `jdbc:postgresql://127.0.0.1:${String(port)}/${database}`,
    port,
    user: USER,
    password: PASSWORD,
    stop: async () => {
      // A fast shutdown asks the server to end its own processes. The package kills it instead
      // (taskkill on Windows), which can leave its I/O workers running and the files of
      // node_modules locked, so that the next npm ci fails.
      const ctl = pgCtl();
      if (ctl) {
        spawnSync(ctl, ['stop', '-D', options.directory, '-m', 'fast', '-w', '-t', '30'], {
          stdio: 'ignore',
        });
      }
      let failure: Error | undefined;
      try {
        await server.stop();
      } catch (error) {
        failure = error instanceof Error ? error : new Error('PostgreSQL did not stop');
      }
      if (ctl) {
        endOrphans(ctl);
      }
      if (failure !== undefined) {
        // On Windows the files of a server that just stopped can stay locked for a moment, and
        // the package fails to delete the cluster (EBUSY): retry for a few seconds.
        if (options.persistent) {
          throw failure;
        }
        rmSync(options.directory, {
          recursive: true,
          force: true,
          maxRetries: 20,
          retryDelay: 250,
        });
      }
    },
  };
}
