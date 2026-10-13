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
  'sdk/java/src/main/resources/dev/mosaikit/kernel/api/extension/extension-manifest.schema.json',
);
const schema = JSON.parse(readFileSync(schemaFile, 'utf8')) as object;
const validate = new Ajv2020({ allErrors: true }).compile(schema);

function manifestsIn(directory: string): string[] {
  return readdirSync(join(root, directory), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, directory, entry.name, 'manifest.yaml'));
}

describe('extension manifest schema', () => {
  it.each([
    ...manifestsIn('tests/fixtures/extensions'),
    ...manifestsIn('src/server/src/test/resources/extensions'),
  ])('accepts %s', (file) => {
    const valid = validate(parse(readFileSync(file, 'utf8')));
    expect(validate.errors ?? []).toEqual([]);
    expect(valid).toBe(true);
  });

  it('MK-055 MK-056: accepts permissions and resource types with their sharing levels', () => {
    const manifest = {
      id: 'dev.example.dashboards',
      version: '1.0.0',
      name: 'Dashboards',
      kind: 'app',
      platform: '>=0.1',
      permissions: [
        {
          name: 'create-dashboard',
          title: 'Create dashboards',
          description: 'Create new dashboards of the organization',
          i18n: { it: { title: 'Creare cruscotti' } },
        },
      ],
      resources: [
        {
          type: 'dashboard',
          title: 'Dashboard',
          i18n: { it: { title: 'Cruscotto' } },
          levels: [
            { name: 'view', title: 'View', i18n: { it: { title: 'Vedere' } } },
            { name: 'edit', title: 'Edit' },
          ],
          subjects: ['person', 'group', 'organization', 'link'],
        },
      ],
    };
    const valid = validate(manifest);
    expect(validate.errors ?? []).toEqual([]);
    expect(valid).toBe(true);
  });

  it.each([
    ['an id that is not reverse-DNS', { id: 'Traffic' }],
    ['a partial version', { version: '1.0' }],
    ['an unknown kind', { kind: ['widget'] }],
    ['a frontend path outside the extension', { frontend: { entry: '../escape.js' } }],
    ['a schema outside the extension namespace', { database: { schema: 'public' } }],
    [
      'a backend that is not a jar inside the extension',
      { backend: { jar: '../code.jar', api: 'code' } },
    ],
    ['a backend file that is not a jar', { backend: { jar: 'lib/code.zip', api: 'code' } }],
    ['a backend without api', { backend: { jar: 'lib/code.jar' } }],
    ['a backend api that is not a path segment', { backend: { jar: 'lib/code.jar', api: 'a/b' } }],
    ['a contribution without id', { contributes: { 'launcher.app': [{ route: '/x' }] } }],
    ['MK-056: a permission without title', { permissions: [{ name: 'export' }] }],
    [
      'MK-056: a permission name with spaces',
      { permissions: [{ name: 'Export all', title: 'x' }] },
    ],
    [
      'MK-056: a translation of a permission attribute that is not a text',
      { permissions: [{ name: 'export', title: 'x', i18n: { it: { icon: 'x' } } }] },
    ],
    ['MK-055: a resource type without levels', { resources: [{ type: 'dashboard', title: 'x' }] }],
    [
      'MK-055: a resource type with no level',
      { resources: [{ type: 'dashboard', title: 'x', levels: [] }] },
    ],
    [
      'MK-055: an unknown subject',
      {
        resources: [
          {
            type: 'dashboard',
            title: 'x',
            levels: [{ name: 'view', title: 'View' }],
            subjects: ['everyone'],
          },
        ],
      },
    ],
  ])('rejects %s', (_label, change) => {
    const manifest = {
      id: 'dev.example.extension',
      version: '1.0.0',
      name: 'Extension',
      kind: 'app',
      platform: '>=0.1',
      ...change,
    };
    expect(validate(manifest)).toBe(false);
  });
});
