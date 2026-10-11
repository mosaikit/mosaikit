// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const root = join(import.meta.dirname, '..', '..', '..', '..', '..');
const schemaFile = join(
  root,
  'sdk/java/src/main/resources/dev/mosaikit/kernel/api/plugin/plugin-manifest.schema.json',
);
const schema = JSON.parse(readFileSync(schemaFile, 'utf8')) as object;
const validate = new Ajv2020({ allErrors: true }).compile(schema);

function manifestsIn(directory: string): string[] {
  return readdirSync(join(root, directory), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, directory, entry.name, 'manifest.yaml'));
}

describe('plugin manifest schema', () => {
  it.each([...manifestsIn('src/plugins'), ...manifestsIn('src/server/src/test/resources/plugins')])(
    'accepts %s',
    (file) => {
      const valid = validate(parse(readFileSync(file, 'utf8')));
      expect(validate.errors ?? []).toEqual([]);
      expect(valid).toBe(true);
    },
  );

  it.each([
    ['an id that is not reverse-DNS', { id: 'Traffic' }],
    ['a partial version', { version: '1.0' }],
    ['an unknown kind', { kind: ['widget'] }],
    ['a frontend path outside the plugin', { frontend: { entry: '../escape.js' } }],
    ['a schema outside the plugin namespace', { database: { schema: 'public' } }],
    [
      'a backend that is not a jar inside the plugin',
      { backend: { jar: '../code.jar', api: 'code' } },
    ],
    ['a backend file that is not a jar', { backend: { jar: 'lib/code.zip', api: 'code' } }],
    ['a backend without api', { backend: { jar: 'lib/code.jar' } }],
    ['a backend api that is not a path segment', { backend: { jar: 'lib/code.jar', api: 'a/b' } }],
    ['a contribution without id', { contributes: { 'launcher.app': [{ route: '/x' }] } }],
  ])('rejects %s', (_label, change) => {
    const manifest = {
      id: 'dev.example.plugin',
      version: '1.0.0',
      name: 'Plugin',
      kind: 'app',
      platform: '>=0.1',
      ...change,
    };
    expect(validate(manifest)).toBe(false);
  });
});
