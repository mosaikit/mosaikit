// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_GROUP, type Group, discoverGroups } from './groups.ts';

/**
 * Runs the end-to-end tests in groups at the same time, each on a bench of its own (ports, working
 * directory, database), so that the suite takes as long as its longest group. Within a group the
 * files run in order, as some use what an earlier one did; the groups share nothing.
 *
 * A file names its group in a comment at its top, `// e2e-group: C`, and the fixtures it installs
 * for the next files, `// e2e-installs: todo` (see groups.ts); a file without one runs in group B.
 *
 *   node tests/e2e/run.ts              every group
 *   node tests/e2e/run.ts B            one group
 *   node tests/e2e/run.ts 13-teams-shell   one file, on the bench of its group
 *   node tests/e2e/run.ts --check      list the groups; fails when a file would run in none
 *   node tests/e2e/run.ts -- <args>    every group, with more arguments for Playwright
 */
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const WINDOWS = process.platform === 'win32';

function run(group: Group, index: number, extra: readonly string[]): Promise<number> {
  const files = group.files.map((file) => `tests/${file}.e2e.ts`);
  const child = spawn('npx', ['playwright', 'test', '-c', 'tests/e2e', ...files, ...extra], {
    cwd: ROOT,
    shell: WINDOWS,
    env: {
      ...process.env,
      E2E_WORK: join(ROOT, 'tests', 'e2e', '.work', group.name),
      E2E_KERNEL_PORT: String(8181 + index * 10),
      E2E_CONTROL_PORT: String(18090 + index * 10),
      E2E_MODEL_PORT: String(18091 + index * 10),
      E2E_PREINSTALL: (group.preinstall ?? []).join(','),
    },
  });
  const prefix = (chunk: Buffer): string =>
    chunk
      .toString()
      .split(/\r?\n/)
      .filter((line) => line.trim() !== '')
      .map((line) => `[${group.name}] ${line}\n`)
      .join('');
  child.stdout.on('data', (chunk: Buffer) => process.stdout.write(prefix(chunk)));
  child.stderr.on('data', (chunk: Buffer) => process.stderr.write(prefix(chunk)));
  return new Promise((resolve) => {
    child.on('exit', (code) => {
      resolve(code ?? 1);
    });
  });
}

async function main(argv: string[]): Promise<void> {
  let groups: readonly Group[];
  try {
    groups = discoverGroups(join(ROOT, 'tests', 'e2e', 'tests'));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}
`);
    process.exitCode = 1;
    return;
  }
  if (argv[0] === '--check') {
    for (const group of groups) {
      process.stdout.write(`${group.name}: ${group.files.join(', ')}
`);
    }
    process.stdout.write(
      `Every end-to-end test file runs in a group (without "// e2e-group:", in ${DEFAULT_GROUP}).
`,
    );
    return;
  }
  const separator = argv.indexOf('--');
  const names = separator < 0 ? argv : argv.slice(0, separator);
  const extra = separator < 0 ? [] : argv.slice(separator + 1);
  // A name is a group (A) or a file (13-teams-shell), which runs in its group, on its bench.
  const chosen = groups.flatMap((group): Group[] => {
    if (names.length === 0 || names.includes(group.name)) {
      return [group];
    }
    const files = group.files.filter((file) => names.includes(file));
    if (files.length === 0) {
      return [];
    }
    // The files left out before the first chosen one would have installed these.
    const first = group.files.indexOf(files[0] ?? '');
    const before = group.files
      .slice(0, first)
      .flatMap((file) => (files.includes(file) ? [] : (group.installs?.[file] ?? [])));
    return [{ ...group, files, preinstall: [...(group.preinstall ?? []), ...before] }];
  });
  const unknown = names.filter(
    (name) => !groups.some((group) => group.name === name || group.files.includes(name)),
  );
  if (unknown.length > 0) {
    throw new Error(`No group or file named ${unknown.join(', ')}`);
  }
  const started = Date.now();
  const codes = await Promise.all(
    chosen.map((group) =>
      run(
        group,
        groups.findIndex((g) => g.name === group.name),
        extra,
      ),
    ),
  );
  const seconds = Math.round((Date.now() - started) / 1000);
  const failed = chosen.filter((_, i) => codes[i] !== 0).map((group) => group.name);
  process.stdout.write(
    failed.length === 0
      ? `End-to-end tests passed in ${String(seconds)} s (groups ${chosen.map((g) => g.name).join(', ')}).\n`
      : `End-to-end tests FAILED in group(s) ${failed.join(', ')} (${String(seconds)} s).\n`,
  );
  process.exitCode = failed.length === 0 ? 0 : 1;
}

await main(process.argv.slice(2));
