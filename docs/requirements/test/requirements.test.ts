// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

interface Requirement {
  readonly id: string;
  readonly status: 'planned' | 'in-progress' | 'done';
  readonly depends?: readonly string[];
}

const root = join(import.meta.dirname, '..', '..', '..');
const directory = join(root, 'docs', 'requirements');
const validate = new Ajv2020({ allErrors: true }).compile(
  JSON.parse(readFileSync(join(directory, 'requirement.schema.json'), 'utf8')) as object,
);
const files = readdirSync(directory).filter((name) => /^MK-\d{3}\.yaml$/.test(name));
const requirements = files.map(
  (name) => parse(readFileSync(join(directory, name), 'utf8')) as Requirement,
);
const ids = new Set(requirements.map((requirement) => requirement.id));

function filesUnder(path: string, suffix: string): string[] {
  return readdirSync(path, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(suffix))
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((file) => !file.includes('node_modules') && !file.includes('target'));
}

function referencedIds(): Map<string, string[]> {
  const references = new Map<string, string[]>();
  const sources = [
    // src/: the server, the web shell and the sample plugins.
    ...filesUnder(join(root, 'src'), 'Test.java'),
    ...filesUnder(join(root, 'src'), 'IT.java'),
    ...filesUnder(join(root, 'src'), '.test.ts'),
    ...filesUnder(join(root, 'sdk'), 'Test.java'),
    ...filesUnder(join(root, 'sdk'), '.test.ts'),
    ...filesUnder(join(root, 'build'), '.test.ts'),
    // A requirement is done when its end-to-end tests pass, so they count too.
    ...filesUnder(join(root, 'tests', 'e2e', 'tests'), '.e2e.ts'),
  ];
  for (const file of sources) {
    for (const match of readFileSync(file, 'utf8').matchAll(/MK-\d{3}/g)) {
      const list = references.get(match[0]) ?? [];
      list.push(relative(root, file));
      references.set(match[0], list);
    }
  }
  return references;
}

describe('requirements', () => {
  it.each(files)('%s follows the schema and is named after its id', (name) => {
    const requirement = parse(readFileSync(join(directory, name), 'utf8')) as Requirement;
    validate(requirement);
    expect(validate.errors ?? []).toEqual([]);
    expect(`${requirement.id}.yaml`).toBe(name);
  });

  it('depends only on existing requirements', () => {
    const missing = requirements.flatMap((r) => (r.depends ?? []).filter((id) => !ids.has(id)));
    expect(missing).toEqual([]);
  });

  it('is referenced by tests only through existing ids', () => {
    const unknown = [...referencedIds().keys()].filter((id) => !ids.has(id));
    expect(unknown).toEqual([]);
  });

  it('verifies every requirement marked as done with at least one test', () => {
    const references = referencedIds();
    const untested = requirements
      .filter((requirement) => requirement.status === 'done')
      .filter((requirement) => !references.has(requirement.id))
      .map((requirement) => requirement.id);
    expect(untested).toEqual([]);
  });
});
