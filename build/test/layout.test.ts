// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));

function tracked(pattern: string): string[] {
  return execFileSync('git', ['ls-files', pattern], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter((file) => file.length > 0);
}

describe('repository layout (MK-049)', () => {
  it.each([
    'src/server',
    'src/web',
    'tests/fixtures/extensions',
    'sdk',
    'distribution',
    'tests/e2e',
    'build',
  ])('has %s', (folder) => {
    expect(existsSync(join(root, folder))).toBe(true);
  });

  it.each([
    'kernel',
    'extensions',
    'src/extensions',
    'distributions',
    'e2e',
    'tools',
    'docs/developer',
    'docs/user',
  ])('no longer tracks %s', (folder) => {
    expect(tracked(`${folder}/`)).toEqual([]);
  });
});
