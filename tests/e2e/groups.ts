// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The groups of the end-to-end tests, read from the files themselves: a file names its group in a
 * comment at its top, so that a new file needs no edit of a shared list (which every pull request
 * with a new file used to change, and conflict on).
 *
 *   // e2e-group: C
 *   // e2e-installs: todo        the fixture extensions the file installs, which later files use
 *
 * Within a group the files run in the order of their names. A file without a group runs in the
 * lightest group, DEFAULT_GROUP; a group that does not exist, or a test file that Playwright would
 * not run, is an error.
 */
export interface Group {
  readonly name: string;
  readonly files: readonly string[];
  /** Fixture extensions installed before the first start, as the files before them left them. */
  readonly preinstall?: readonly string[];
  /** The fixture extensions that a file installs, which the next files of the group use. */
  readonly installs?: Readonly<Record<string, readonly string[]>>;
}

/** The groups, each on a bench of its own; what is set here holds for the group, not for a file. */
export const GROUP_SETTINGS: readonly Omit<Group, 'files' | 'installs'>[] = [
  // The marketplace (01) installs the fixtures that the next files use.
  { name: 'A' },
  { name: 'B' },
  { name: 'C', preinstall: ['activities', 'estimates', 'notes', 'hello'] },
];

/** The group of a file that names none: the one with the shortest run, and nothing preinstalled. */
export const DEFAULT_GROUP = 'B';

const SUFFIX = '.e2e.ts';
const TAG = /^\s*\/\/\s*e2e-(group|installs):\s*(.*?)\s*$/;

export interface Header {
  readonly group?: string;
  readonly installs: readonly string[];
}

/** Reads the tags of the comments at the top of a file, before its first import or code. */
export function readHeader(file: string, text: string): Header {
  let group: string | undefined;
  let installs: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() !== '' && !line.trimStart().startsWith('//')) {
      break;
    }
    const tag = TAG.exec(line);
    if (!tag) {
      continue;
    }
    const value = tag[2] ?? '';
    if (tag[1] === 'group') {
      if (group !== undefined) {
        throw new Error(`${file}: more than one "// e2e-group:" line`);
      }
      if (!/^[A-Z]$/.test(value)) {
        throw new Error(`${file}: "// e2e-group: ${value}" is not a group name such as C`);
      }
      group = value;
    } else {
      installs = value
        .split(',')
        .map((name) => name.trim())
        .filter((name) => name !== '');
    }
  }
  return group === undefined ? { installs } : { group, installs };
}

/** The groups of the files of a directory, given as file name and text. */
export function assignGroups(
  files: readonly { readonly name: string; readonly text: string }[],
): Group[] {
  const problems: string[] = [];
  const known = new Set(GROUP_SETTINGS.map((group) => group.name));
  const members = new Map<string, { files: string[]; installs: Record<string, string[]> }>(
    GROUP_SETTINGS.map((group) => [group.name, { files: [], installs: {} }]),
  );
  for (const { name, text } of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    if (!name.endsWith(SUFFIX)) {
      problems.push(`${name}: Playwright runs only files named *${SUFFIX}`);
      continue;
    }
    let header: Header;
    try {
      header = readHeader(name, text);
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
      continue;
    }
    const group = header.group ?? DEFAULT_GROUP;
    const member = members.get(group);
    if (!known.has(group) || !member) {
      problems.push(
        `${name}: group ${group} does not exist (${[...known].join(', ')}; see GROUP_SETTINGS)`,
      );
      continue;
    }
    const id = name.slice(0, -SUFFIX.length);
    member.files.push(id);
    if (header.installs.length > 0) {
      member.installs[id] = [...header.installs];
    }
  }
  if (problems.length > 0) {
    throw new Error(
      `End-to-end test files that would run in no group:\n${problems.map((p) => `  ${p}`).join('\n')}`,
    );
  }
  return GROUP_SETTINGS.map((settings) => {
    const member = members.get(settings.name) ?? { files: [], installs: {} };
    return { ...settings, files: member.files, installs: member.installs };
  });
}

/** The groups of the files of tests/e2e/tests. */
export function discoverGroups(directory: string): Group[] {
  const names = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => entry.name);
  return assignGroups(
    names.map((name) => ({ name, text: readFileSync(join(directory, name), 'utf8') })),
  );
}
