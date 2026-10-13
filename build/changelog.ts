// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
/**
 * Changelog fragments: a pull request adds `changelog.d/<id>.md` instead of editing CHANGELOG.md,
 * so that pull requests no longer conflict on the Unreleased section. At release time
 * (distribution/release/prepare.sh) the fragments go into `## [Unreleased]` and are deleted.
 *
 * A fragment starts with a heading of Keep a Changelog and its entries, as list items:
 *
 *   ### Added
 *
 *   - Signed links to the files of extensions (MK-093): ...
 *
 * It may hold more than one heading. The id is the requirement (`MK-093.md`) or a short slug
 * (`fix-session-cookie.md`); two fragments of one requirement take a suffix (`MK-093-api.md`).
 *
 *   node build/changelog.ts check              validate every fragment
 *   node build/changelog.ts assemble           move the fragments into CHANGELOG.md
 *   node build/changelog.ts assemble --dry-run print the changelog it would write
 */
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const KINDS = ['Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security'] as const;
export type Kind = (typeof KINDS)[number];

export interface Section {
  readonly kind: Kind;
  /** The entries, list items with their continuation lines, without blank lines around them. */
  readonly body: string;
}

export interface Fragment {
  readonly name: string;
  readonly sections: readonly Section[];
}

export const FRAGMENTS = 'changelog.d';
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/;
const HEADING = /^### (.+)$/;

/** The file names of the fragments in a directory, in order; README.md is not one. */
export function fragmentFiles(directory: string): string[] {
  let names: string[];
  try {
    names = readdirSync(directory);
  } catch {
    return [];
  }
  return names.filter((name) => name.endsWith('.md') && name !== 'README.md').sort();
}

/** Reads a fragment; throws an error that names the file and the problem. */
export function parseFragment(name: string, text: string): Fragment {
  const fail = (problem: string): never => {
    throw new Error(`${FRAGMENTS}/${name}: ${problem}`);
  };
  if (!NAME.test(name)) {
    fail('the name is the requirement or a short slug, such as MK-093.md or fix-session-cookie.md');
  }
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const sections: { kind: Kind; lines: string[] }[] = [];
  for (const line of lines) {
    const heading = HEADING.exec(line);
    if (heading) {
      const kind = KINDS.find((k) => k === heading[1]?.trim());
      if (!kind) {
        fail(`"${line}" is not one of ${KINDS.map((k) => `### ${k}`).join(', ')}`);
      }
      sections.push({ kind: kind as Kind, lines: [] });
    } else if (sections.length === 0) {
      if (line.trim() !== '') {
        fail(`the first line is a heading such as "### Added", not "${line}"`);
      }
    } else if (/^#/.test(line)) {
      fail(`only "### <kind>" headings, not "${line}"`);
    } else {
      sections.at(-1)?.lines.push(line);
    }
  }
  if (sections.length === 0) {
    fail('empty: a heading such as "### Added" and an entry "- ..."');
  }
  return {
    name,
    sections: sections.map(({ kind, lines: body }) => {
      const text = body.join('\n').trim();
      if (text === '') {
        fail(`no entry under "### ${kind}"`);
      }
      if (!text.startsWith('- ')) {
        fail(`the entries under "### ${kind}" are list items starting with "- "`);
      }
      return { kind, body: text };
    }),
  };
}

/**
 * Puts the entries of the fragments into the Unreleased section of a changelog: at the top of the
 * first subsection of their kind, in the order of the fragments, or in a new subsection at the end of
 * Unreleased. The entries already there do not move.
 */
export function assemble(changelog: string, fragments: readonly Fragment[]): string {
  const lines = changelog.replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex((line) => /^## \[Unreleased\]/.test(line));
  if (start < 0) {
    throw new Error('CHANGELOG.md has no "## [Unreleased]" section');
  }
  const blocks = new Map<Kind, string[]>();
  for (const fragment of fragments) {
    for (const section of fragment.sections) {
      blocks.set(section.kind, [...(blocks.get(section.kind) ?? []), section.body]);
    }
  }
  for (const kind of KINDS) {
    const bodies = blocks.get(kind);
    if (!bodies) {
      continue;
    }
    const entries = bodies.join('\n').split('\n');
    let end = lines.findIndex((line, i) => i > start && /^## /.test(line));
    if (end < 0) {
      end = lines.length;
    }
    const heading = lines.findIndex((line, i) => i > start && i < end && line === `### ${kind}`);
    if (heading >= 0) {
      // After the heading and its blank line.
      let at = heading + 1;
      while (at < end && lines[at]?.trim() === '') {
        at++;
      }
      lines.splice(at, 0, ...entries);
      continue;
    }
    // A new subsection at the end of Unreleased, before the blank lines that close it.
    let at = end;
    while (at > start + 1 && lines[at - 1]?.trim() === '') {
      at--;
    }
    const insert = ['', `### ${kind}`, '', ...entries];
    if (at < lines.length && lines[at]?.trim() !== '') {
      insert.push('');
    }
    lines.splice(at, 0, ...insert);
  }
  return lines.join('\n');
}

/** Reads and validates every fragment of a directory. */
export function readFragments(directory: string): Fragment[] {
  return fragmentFiles(directory).map((name) =>
    parseFragment(name, readFileSync(join(directory, name), 'utf8')),
  );
}

function main(argv: readonly string[]): void {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const directory = join(root, FRAGMENTS);
  const [command, ...options] = argv;
  if (command === 'check') {
    const fragments = readFragments(directory);
    process.stdout.write(`${String(fragments.length)} changelog fragment(s), all valid.\n`);
    return;
  }
  if (command === 'assemble') {
    const fragments = readFragments(directory);
    const file = join(root, 'CHANGELOG.md');
    const changelog = assemble(readFileSync(file, 'utf8'), fragments);
    if (options.includes('--dry-run')) {
      process.stdout.write(changelog);
      return;
    }
    writeFileSync(file, changelog);
    for (const fragment of fragments) {
      rmSync(join(directory, fragment.name));
    }
    process.stdout.write(
      `${String(fragments.length)} changelog fragment(s) moved into CHANGELOG.md.\n`,
    );
    return;
  }
  process.stderr.write('usage: node build/changelog.ts check | assemble [--dry-run]\n');
  process.exitCode = 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
