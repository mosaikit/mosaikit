// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FRAGMENTS, assemble, fragmentFiles, parseFragment, readFragments } from '../changelog.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));

const CHANGELOG = `# Changelog

Intro.

## [Unreleased]

### Changed

- Old change.

### Added

- Old addition.

## [0.1.0] - 2026-01-01

### Fixed

- Old fix.
`;

describe('changelog fragments', () => {
  it('reads a fragment with one or more headings', () => {
    const fragment = parseFragment(
      'MK-093.md',
      '### Added\n\n- Signed links\n  to files.\n\n### Security\n\n- A fix.\n',
    );
    expect(fragment.sections).toEqual([
      { kind: 'Added', body: '- Signed links\n  to files.' },
      { kind: 'Security', body: '- A fix.' },
    ]);
  });

  it.each([
    ['MK-1.md', 'Added\n\n- x', /first line is a heading/],
    ['MK-1.md', '### New\n\n- x', /not one of/],
    ['MK-1.md', '### Added\n\n', /no entry/],
    ['MK-1.md', '### Added\n\nSome prose.', /list items/],
    ['MK-1.md', '### Added\n\n- x\n\n## [Unreleased]', /only "### <kind>" headings/],
    ['MK-1.md', '', /empty/],
    ['my fragment.md', '### Added\n\n- x', /short slug/],
  ])('refuses %s with %j', (name, text, problem) => {
    expect(() => parseFragment(name, text)).toThrow(problem);
  });

  it('puts the entries at the top of their subsection of Unreleased, in order', () => {
    const result = assemble(CHANGELOG, [
      parseFragment('MK-001.md', '### Added\n\n- First.\n'),
      parseFragment('MK-002.md', '### Added\n\n- Second,\n  on two lines.\n\n### Changed\n\n- C.'),
    ]);
    expect(result).toContain(
      '### Changed\n\n- C.\n- Old change.\n\n### Added\n\n- First.\n- Second,\n  on two lines.\n- Old addition.\n\n## [0.1.0]',
    );
  });

  it('adds a subsection at the end of Unreleased when there is none of the kind', () => {
    const result = assemble(CHANGELOG, [parseFragment('fix.md', '### Fixed\n\n- New fix.')]);
    expect(result).toContain('- Old addition.\n\n### Fixed\n\n- New fix.\n\n## [0.1.0]');
    // The Fixed of the released version is untouched.
    expect(result).toContain('## [0.1.0] - 2026-01-01\n\n### Fixed\n\n- Old fix.\n');
  });

  it('adds a subsection to an Unreleased section that is the last of the file', () => {
    const result = assemble('# Changelog\n\n## [Unreleased]\n', [
      parseFragment('a.md', '### Removed\n\n- Gone.'),
    ]);
    expect(result).toBe('# Changelog\n\n## [Unreleased]\n\n### Removed\n\n- Gone.\n');
  });

  it('changes nothing without fragments', () => {
    expect(assemble(CHANGELOG, [])).toBe(CHANGELOG);
  });

  it('needs an Unreleased section', () => {
    expect(() => assemble('# Changelog\n', [])).toThrow(/Unreleased/);
  });

  it('lists the fragments of a directory in order, without the README', () => {
    const directory = mkdtempSync(join(tmpdir(), 'changelog-'));
    for (const name of ['b.md', 'README.md', 'a.md', 'notes.txt']) {
      writeFileSync(join(directory, name), '### Added\n\n- x\n');
    }
    expect(fragmentFiles(directory)).toEqual(['a.md', 'b.md']);
    expect(readFragments(directory).map((f) => f.name)).toEqual(['a.md', 'b.md']);
    expect(fragmentFiles(join(directory, 'missing'))).toEqual([]);
  });

  it('every fragment of the repository is valid', () => {
    expect(() => readFragments(join(root, FRAGMENTS))).not.toThrow();
  });
});
