#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { existsSync, mkdirSync, statSync, symlinkSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { Bench } from './bench.js';

const USAGE = `Usage: mosaikit-bench [--port <port>] [--work <directory>] [<extension directory or package> ...]

Starts a Mosaikit installation with the given extensions, on an embedded PostgreSQL, and keeps it
running until Ctrl+C. Without arguments, the extension of the current directory (its manifest.yaml).

An extension directory is linked into the installation and watched: a changed frontend shows at once in
the open page; Java code and schemas are read again at the next start. A package (.zip) is signed
with the key of the bench and installed.

The installation is MOSAIKIT_INSTALLATION when set, otherwise the one of the version of this
package, downloaded once.`;

async function main(argv: string[]): Promise<void> {
  let port: number | undefined;
  let work = resolve('.mosaikit-bench');
  const sources: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const argument = argv[i] ?? '';
    if (argument === '--help' || argument === '-h') {
      process.stdout.write(`${USAGE}\n`);
      return;
    } else if (argument === '--port') {
      port = Number(argv[++i]);
    } else if (argument === '--work') {
      work = resolve(argv[++i] ?? work);
    } else {
      sources.push(resolve(argument));
    }
  }
  if (sources.length === 0) {
    if (!existsSync('manifest.yaml')) {
      throw new Error('No extension here (no manifest.yaml): name the extensions to start with');
    }
    sources.push(resolve('.'));
  }
  const directories = sources.filter((source) => statSync(source).isDirectory());
  const packages = sources.filter((source) => !directories.includes(source));

  const bench = await Bench.start({
    work,
    extensions: packages,
    ...(port === undefined ? {} : { port }),
    settings: {
      'mosaikit.extensions.watch': 'true',
      // Extensions in development are not signed: their frontends run like verified ones.
      'mosaikit.extensions.unverified-frontends': 'module',
    },
    beforeStart: (installation) => {
      for (const directory of directories) {
        const link = join(installation, 'extensions', basename(directory));
        mkdirSync(join(installation, 'extensions'), { recursive: true });
        symlinkSync(directory, link, process.platform === 'win32' ? 'junction' : 'dir');
      }
    },
  });
  const { baseUrl, admin, organization, people } = bench.info;
  process.stdout.write(
    [
      `Mosaikit is running at ${baseUrl}`,
      `  administrator: ${admin.user} / ${admin.password}`,
      ...people.map((person) => `  ${organization.name}: ${person.user} / ${person.password}`),
      `  log: ${join(work, 'installation.log')}`,
      'Ctrl+C stops it.',
      '',
    ].join('\n'),
  );
  await new Promise<void>((done) => {
    process.once('SIGINT', () => {
      done();
    });
  });
  await bench.stop();
}

main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
