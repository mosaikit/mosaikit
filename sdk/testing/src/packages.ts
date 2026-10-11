// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The plugin packages (zips) in the given directories: `target/` of a Maven build, `dist/` of the
 * workflow of the plugins, or a directory of packages.
 */
export function packagesIn(...directories: string[]): string[] {
  return directories
    .filter((directory) => existsSync(directory))
    .flatMap((directory) =>
      readdirSync(directory)
        .filter((name) => name.endsWith('.zip'))
        .map((name) => join(directory, name)),
    );
}
