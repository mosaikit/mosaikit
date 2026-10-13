// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Checks that the documentation still matches the repository, at every push (ADR-0023): links,
 * indexes and the evidence named by the compliance documents.
 */
const root = resolve(import.meta.dirname, '..', '..');
const skipped = new Set(['node_modules', 'target', 'dist', 'coverage', '.git', 'LICENSES']);

function files(directory: string, suffix: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (skipped.has(entry.name) || entry.name.startsWith('.')) {
      continue;
    }
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...files(path, suffix));
    } else if (entry.name.endsWith(suffix)) {
      found.push(path);
    }
  }
  return found;
}

const markdown = files(root, '.md');
const LINK = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

function withoutCode(text: string): string {
  return text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
}

describe('documentation', () => {
  it('links only to files that exist', () => {
    const broken: string[] = [];
    for (const file of markdown) {
      for (const match of withoutCode(readFileSync(file, 'utf8')).matchAll(LINK)) {
        const target = match[1] ?? '';
        if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#')) {
          continue;
        }
        const path = decodeURIComponent(target.split('#')[0] ?? '');
        if (path && !existsSync(resolve(dirname(file), path))) {
          broken.push(`${relative(root, file)} -> ${target}`);
        }
      }
    }
    expect(broken).toEqual([]);
  });

  it('lists every architecture decision in the index', () => {
    const index = readFileSync(join(root, 'docs/adr/README.md'), 'utf8');
    const records = readdirSync(join(root, 'docs/adr')).filter((name) =>
      /^\d{4}-.*\.md$/.test(name),
    );
    expect(records.filter((name) => !index.includes(`(${name})`))).toEqual([]);
  });

  it('names as evidence only tests, requirements and non-conformities that exist', () => {
    const compliance = ['matrix.md', 'non-conformities.md', 'evidence.md']
      .map((name) => readFileSync(join(root, 'docs/compliance', name), 'utf8'))
      .join('\n');
    const tests = new Set(
      [...files(root, '.java'), ...files(root, '.ts')].map((file) =>
        basename(file).replace(/\.(java|ts)$/, ''),
      ),
    );
    const requirements = new Set(
      readdirSync(join(root, 'docs/requirements'))
        .filter((name) => /^MK-\d{3,}\.md$/.test(name))
        .map((name) => name.replace('.md', '')),
    );
    const nonConformities = readFileSync(join(root, 'docs/compliance/non-conformities.md'), 'utf8');

    const missingTests = [...compliance.matchAll(/`([A-Z][A-Za-z]+(?:Test|IT))`/g)]
      .map((match) => match[1] ?? '')
      .filter((name) => !tests.has(name));
    const missingRequirements = [...compliance.matchAll(/\bMK-\d{3}\b/g)]
      .map((match) => match[0])
      .filter((id) => !requirements.has(id));
    const missingNonConformities = [...compliance.matchAll(/\bNC-\d{2}\b/g)]
      .map((match) => match[0])
      .filter((id) => !nonConformities.includes(`### ${id} `));

    expect([...new Set(missingTests)]).toEqual([]);
    expect([...new Set(missingRequirements)]).toEqual([]);
    expect([...new Set(missingNonConformities)]).toEqual([]);
  });

  it('keeps an Unreleased section in the changelog', () => {
    expect(readFileSync(join(root, 'CHANGELOG.md'), 'utf8')).toContain('## [Unreleased]');
  });
});
