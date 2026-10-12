// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { namesOf } from './names.js';
import { pluginFiles, type PluginFiles } from './templates.js';

/** Version of Mosaikit that this generator belongs to. */
export const MOSAIKIT_VERSION = '0.1.0-SNAPSHOT';

const USAGE = `Usage: create-mosaikit-plugin <id> [options]

Creates a Mosaikit plugin in a new directory named after the last part of <id>.

  <id>                   reverse-DNS identifier, such as dev.acme.traffic
  --name <name>          human readable name (default: from the identifier)
  --backend              add Java code, a database schema and actions for assistants
  --directory <path>     where to create it (default: ./<last part of id>)
  --author <name>        for the licence headers (default: the identifier's organization)
  --mosaikit <version>   version of the plugin API (default: ${MOSAIKIT_VERSION})
`;

/** Writes the files of a plugin into an empty or new directory. */
export function writePlugin(directory: string, files: PluginFiles): void {
  if (existsSync(directory) && readdirSync(directory).length > 0) {
    throw new Error(`${directory} exists and is not empty`);
  }
  for (const [path, content] of files) {
    const file = join(directory, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
}

/** Runs the command; returns the exit code. */
export function main(args: readonly string[], out: (line: string) => void = console.log): number {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...args],
      allowPositionals: true,
      options: {
        name: { type: 'string' },
        backend: { type: 'boolean', default: false },
        directory: { type: 'string' },
        author: { type: 'string' },
        mosaikit: { type: 'string', default: MOSAIKIT_VERSION },
        help: { type: 'boolean', default: false },
      },
    });
  } catch (error) {
    out(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
    return 2;
  }
  const [id] = parsed.positionals;
  if (parsed.values.help || id === undefined) {
    out(USAGE);
    return parsed.values.help ? 0 : 2;
  }
  try {
    const names = namesOf(id, parsed.values.name);
    const directory = resolve(parsed.values.directory ?? names.slug);
    const files = pluginFiles({
      names,
      backend: parsed.values.backend,
      mosaikitVersion: parsed.values.mosaikit,
      author: parsed.values.author ?? id.split('.').slice(0, -1).join('.'),
    });
    writePlugin(directory, files);
    out(
      `Created ${names.name} (${names.id}) in ${directory}: ${String(files.size)} files. See its README.md.`,
    );
    return 0;
  } catch (error) {
    out(`Error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
