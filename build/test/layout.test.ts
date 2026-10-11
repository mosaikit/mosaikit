// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));

function tracked(pattern: string): string[] {
  return execFileSync('git', ['ls-files', pattern], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter((file) => file.length > 0);
}

describe('repository layout (MK-049)', () => {
  it.each(['src/server', 'src/web', 'src/plugins', 'sdk', 'distribution', 'tests/e2e', 'build'])(
    'has %s',
    (folder) => {
      expect(existsSync(join(root, folder))).toBe(true);
    },
  );

  it.each(['kernel', 'plugins', 'distributions', 'e2e', 'tools', 'docs/developer', 'docs/user'])(
    'no longer tracks %s',
    (folder) => {
      expect(tracked(`${folder}/`)).toEqual([]);
    },
  );

  it('links only to files that exist from its documentation', () => {
    const broken: string[] = [];
    for (const file of tracked('*.md')) {
      const text = readFileSync(join(root, file), 'utf8');
      for (const match of text.matchAll(/\]\(([^)#\s]+)(#[^)]*)?\)/g)) {
        const target = match[1] ?? '';
        if (/^[a-z]+:/.test(target) || target.startsWith('/')) {
          continue;
        }
        if (!existsSync(normalize(join(root, dirname(file), target)))) {
          broken.push(`${file} -> ${target}`);
        }
      }
    }
    expect(broken).toEqual([]);
  });
});
