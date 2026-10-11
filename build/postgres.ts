// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import EmbeddedPostgres from 'embedded-postgres';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

/** pg_ctl of the binaries that npm installed for this platform. */
function pgCtl(): string | undefined {
  const platform = `${process.platform === 'win32' ? 'windows' : process.platform}-${process.arch}`;
  const file = join(
    ROOT,
    'node_modules',
    '@embedded-postgres',
    platform,
    'native',
    'bin',
    process.platform === 'win32' ? 'pg_ctl.exe' : 'pg_ctl',
  );
  return existsSync(file) ? file : undefined;
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
    initdbFlags: ['--locale=C', '--encoding=UTF8'],
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
      await server.stop();
    },
  };
}
