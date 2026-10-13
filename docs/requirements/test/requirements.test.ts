// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

/** The front matter of a requirement (requirement.schema.json). */
interface Requirement {
  readonly id: string;
  readonly area: string;
  readonly status: 'proposed' | 'planned' | 'in-progress' | 'done' | 'dropped' | 'moved';
  readonly 'moved-to'?: string;
  readonly 'verified-in'?: string;
  readonly depends?: readonly string[];
}

/** requirements.json: the prefix of the ids of this repository, and its areas. */
interface Product {
  readonly prefix: string;
  /** Prefixes of the products this one builds on, whose requirements it may depend on. */
  readonly dependsOn: readonly string[];
  readonly areas: readonly string[];
}

const root = join(import.meta.dirname, '..', '..', '..');
const directory = join(root, 'docs', 'requirements');
const product = JSON.parse(readFileSync(join(directory, 'requirements.json'), 'utf8')) as Product;
const validate = new Ajv2020({ allErrors: true }).compile(
  JSON.parse(readFileSync(join(directory, 'requirement.schema.json'), 'utf8')) as object,
);
const ownId = new RegExp(`^${product.prefix}-\\d{3,}$`);
const files = readdirSync(directory).filter((name) => /^[A-Z]{2,4}-\d{3,}\.md$/.test(name));

/** Splits a requirement file into its front matter and its body. */
function read(name: string): { requirement: Requirement; body: string } {
  const text = readFileSync(join(directory, name), 'utf8');
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (!match) {
    throw new Error(`${name}: no front matter between --- lines`);
  }
  return { requirement: parse(match[1] ?? '') as Requirement, body: match[2] ?? '' };
}

const requirements = files.map((name) => read(name).requirement);
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
    // src/: the server and the web shell.
    ...filesUnder(join(root, 'src'), 'Test.java'),
    ...filesUnder(join(root, 'src'), 'IT.java'),
    ...filesUnder(join(root, 'src'), '.test.ts'),
    ...filesUnder(join(root, 'sdk'), 'Test.java'),
    ...filesUnder(join(root, 'sdk'), '.test.ts'),
    ...filesUnder(join(root, 'build'), '.test.ts'),
    // A requirement is done when its end-to-end tests pass, so they count too.
    ...filesUnder(join(root, 'tests', 'e2e', 'tests'), '.e2e.ts'),
  ];
  const tag = new RegExp(`\\b${product.prefix}-\\d{3,}\\b`, 'g');
  for (const file of sources) {
    for (const match of readFileSync(file, 'utf8').matchAll(tag)) {
      const list = references.get(match[0]) ?? [];
      list.push(relative(root, file));
      references.set(match[0], list);
    }
  }
  return references;
}

describe('requirements', () => {
  it.each(files)('%s follows the schema, is named after its id and describes itself', (name) => {
    const { requirement, body } = read(name);
    validate(requirement);
    expect(validate.errors ?? []).toEqual([]);
    expect(`${requirement.id}.md`).toBe(name);
    expect(requirement.id).toMatch(ownId);
    expect(product.areas).toContain(requirement.area);
    expect(body.trim().length).toBeGreaterThan(10);
  });

  it('depends only on existing requirements, of this product or of those it builds on', () => {
    const wrong = requirements.flatMap((r) =>
      (r.depends ?? []).filter((id) =>
        ownId.test(id) ? !ids.has(id) : !product.dependsOn.some((p) => id.startsWith(`${p}-`)),
      ),
    );
    expect(wrong).toEqual([]);
  });

  it('is referenced by tests only through existing ids', () => {
    const unknown = [...referencedIds().keys()].filter((id) => !ids.has(id));
    expect(unknown).toEqual([]);
  });

  it('verifies every requirement marked as done with at least one test', () => {
    const references = referencedIds();
    const untested = requirements
      .filter((requirement) => requirement.status === 'done')
      // Verified by the tests of the repository of an extension (ADR-0035).
      .filter((requirement) => requirement['verified-in'] === undefined)
      .filter((requirement) => !references.has(requirement.id))
      .map((requirement) => requirement.id);
    expect(untested).toEqual([]);
  });
});
