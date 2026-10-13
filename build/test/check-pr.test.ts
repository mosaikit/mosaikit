// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SEMGREP_CONFIGS, parseOptions, semgrepTargets } from '../check-pr.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));

describe('npm run check:pr', () => {
  it('compares with origin/main and runs the kernel tests by default', () => {
    expect(parseOptions([])).toEqual({ base: 'origin/main', java: true });
    expect(parseOptions(['--base', 'upstream/main', '--no-java'])).toEqual({
      base: 'upstream/main',
      java: false,
    });
  });

  it('refuses unknown options', () => {
    expect(() => parseOptions(['--fast'])).toThrow(/Unknown option --fast/);
    expect(() => parseOptions(['--base'])).toThrow(/needs a branch/);
  });

  it('gives semgrep the changed sources only', () => {
    expect(
      semgrepTargets(['a/B.java', 'docs/x.md', 'src/web/src/a.ts', 'x.d.ts', 'pom.xml', '']),
    ).toEqual(['a/B.java', 'src/web/src/a.ts']);
  });

  it('runs semgrep with the configuration of the job sast', () => {
    const workflow = readFileSync(`${root}.github/workflows/ci.yml`, 'utf8');
    const job = /semgrep scan ([^\n]*)/.exec(workflow)?.[1] ?? '';
    for (const config of SEMGREP_CONFIGS) {
      expect(job).toContain(`--config ${config}`);
    }
  });
});
