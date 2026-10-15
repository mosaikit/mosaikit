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

  it('MK-055 MK-056 MK-076: accepts permissions, measures and resource types with their sharing levels', () => {
    const manifest = {
      id: 'dev.example.dashboards',
      version: '1.0.0',
      name: 'Dashboards',
      kind: 'app',
      platform: '>=0.1',
      measures: [
        {
          id: 'renders',
          label: 'Renders',
          unit: 'renders',
          kind: 'counter',
          i18n: { it: { label: 'Rendering' } },
        },
        { id: 'tiles', label: 'Tiles', unit: 'bytes', kind: 'gauge' },
      ],
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
            { name: 'use', title: 'Use' },
            { name: 'edit', title: 'Edit', edits: true },
          ],
          subjects: ['person', 'group', 'organization', 'link'],
          linkLevel: 'use',
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
    [
      'MK-076: a measure without kind',
      { measures: [{ id: 'renders', label: 'Renders', unit: 'renders' }] },
    ],
    [
      'MK-076: a measure that is neither a counter nor a gauge',
      { measures: [{ id: 'renders', label: 'Renders', unit: 'renders', kind: 'rate' }] },
    ],
    [
      'MK-076: a unit with spaces',
      { measures: [{ id: 'credits', label: 'Credits', unit: 'AI credits', kind: 'counter' }] },
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
    [
      'MK-055: a link level for a type that accepts no links',
      {
        resources: [
          {
            type: 'dashboard',
            title: 'x',
            levels: [{ name: 'view', title: 'View' }],
            linkLevel: 'view',
          },
        ],
      },
    ],
    [
      'MK-055: a level that edits written as text',
      {
        resources: [
          {
            type: 'dashboard',
            title: 'x',
            levels: [{ name: 'edit', title: 'Edit', edits: 'yes' }],
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

  it('MK-132: accepts required and optional dependencies, each with a range of versions', () => {
    const manifest = {
      id: 'dev.example.board',
      version: '1.0.0',
      name: 'Board',
      kind: 'app',
      platform: '>=0.1',
      requires: { 'dev.example.base': '^2' },
      optional: { 'dev.example.maps': '>=3 <5' },
    };
    expect(validate(manifest)).toBe(true);
    expect(validate({ ...manifest, optional: { Maps: '^3' } })).toBe(false);
    expect(validate({ ...manifest, optional: { 'dev.example.maps': '' } })).toBe(false);
  });
});
