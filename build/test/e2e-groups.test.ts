// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GROUP,
  GROUP_SETTINGS,
  assignGroups,
  discoverGroups,
  readHeader,
} from '../../tests/e2e/groups.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const SPDX =
  '// SPDX-FileCopyrightText: 2026 Massimo Antonini\n// SPDX-License-Identifier: MPL-2.0\n';

describe('groups of the end-to-end tests', () => {
  it('reads the group and the installed fixtures from the comments at the top', () => {
    expect(
      readHeader('a', `${SPDX}// e2e-group: C\n// e2e-installs: todo, theme\nimport x from 'y';`),
    ).toEqual({ group: 'C', installs: ['todo', 'theme'] });
  });

  it('ignores tags after the first line of code', () => {
    expect(readHeader('a', `${SPDX}import x from 'y';\n// e2e-group: C\n`)).toEqual({
      installs: [],
    });
  });

  it.each([
    [`${SPDX}// e2e-group: C\n// e2e-group: A\n`, /more than one/],
    [`${SPDX}// e2e-group: fast\n`, /not a group name/],
  ])('refuses a wrong header', (text, problem) => {
    expect(() => readHeader('a', text)).toThrow(problem);
  });

  it('puts the files in their groups, in the order of their names', () => {
    const groups = assignGroups([
      { name: '20-b.e2e.ts', text: `${SPDX}// e2e-group: C\n` },
      { name: '10-a.e2e.ts', text: `${SPDX}// e2e-group: C\n// e2e-installs: todo\n` },
      { name: '30-c.e2e.ts', text: SPDX },
    ]);
    expect(groups.find((g) => g.name === 'C')).toMatchObject({
      files: ['10-a', '20-b'],
      installs: { '10-a': ['todo'] },
      preinstall: ['activities', 'estimates', 'notes', 'hello'],
    });
    // Without a tag: the default group.
    expect(groups.find((g) => g.name === DEFAULT_GROUP)?.files).toEqual(['30-c']);
  });

  it('fails loudly for a file that would run in no group', () => {
    expect(() =>
      assignGroups([
        { name: '10-a.e2e.ts', text: `${SPDX}// e2e-group: Z\n` },
        { name: '11-b.spec.ts', text: SPDX },
      ]),
    ).toThrow(
      /would run in no group:\n {2}10-a.e2e.ts: group Z does not exist[^\n]*\n {2}11-b\.spec\.ts/,
    );
  });

  it('every file of tests/e2e/tests runs in exactly one group', () => {
    const groups = discoverGroups(join(root, 'tests', 'e2e', 'tests'));
    const files = groups.flatMap((group) => group.files);
    expect(new Set(files).size).toBe(files.length);
    expect(files.length).toBeGreaterThan(0);
    expect(groups.map((group) => group.name)).toEqual(GROUP_SETTINGS.map((group) => group.name));
    // The marketplace installs the fixtures that group A uses after it.
    expect(groups[0]?.installs?.['01-marketplace']).toEqual([
      'activities',
      'estimates',
      'notes',
      'hello',
    ]);
  });
});
