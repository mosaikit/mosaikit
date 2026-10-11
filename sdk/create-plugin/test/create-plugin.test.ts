// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { main } from '../src/cli.js';
import { namesOf, titleOf } from '../src/names.js';
import { pluginFiles } from '../src/templates.js';

const root = join(import.meta.dirname, '..', '..', '..');
const schema = JSON.parse(
  readFileSync(
    join(
      root,
      'sdk/java/src/main/resources/dev/mosaikit/kernel/api/plugin/plugin-manifest.schema.json',
    ),
    'utf8',
  ),
) as object;
const validate = new Ajv2020({ allErrors: true }).compile(schema);

const options = (backend: boolean) => ({
  names: namesOf('dev.acme.traffic-lights'),
  backend,
  mosaikitVersion: '0.1.0',
  quarkusVersion: '3.39.5',
  author: 'Acme',
});

describe('create-mosaikit-plugin (MK-023)', () => {
  const directories: string[] = [];
  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('derives every name of a plugin from its identifier', () => {
    expect(namesOf('dev.acme.traffic-lights')).toEqual({
      id: 'dev.acme.traffic-lights',
      slug: 'traffic-lights',
      schema: 'p_traffic_lights',
      javaPackage: 'dev.acme.trafficlights',
      element: 'traffic-lights-app',
      name: 'Traffic lights',
    });
    expect(namesOf('org.public.maps', ' Maps ').javaPackage).toBe('org.public_.maps');
    expect(namesOf('org.public.maps', ' Maps ').name).toBe('Maps');
    expect(() => namesOf('Traffic')).toThrow('not a plugin identifier');
    expect(() => namesOf('dev.acme.x')).toThrow('2 to 40');
    expect(titleOf('a-b')).toBe('A b');
  });

  it.each([false, true])('writes a manifest that the kernel accepts (backend: %s)', (backend) => {
    const files = pluginFiles(options(backend));
    const manifest = parse(files.get('manifest.yaml') ?? '') as Record<string, unknown>;

    const valid = validate(manifest);
    expect(validate.errors ?? []).toEqual([]);
    expect(valid).toBe(true);
    expect(files.get('web/index.js')).toContain("customElements.define('traffic-lights-app'");
    expect(manifest).toMatchObject({
      contributes: { 'rail.app': [{ id: 'traffic-lights', icon: 'web/icon.svg' }] },
    });
    expect(files.get('web/icon.svg')).toContain('<svg');
    expect(files.has('pom.xml')).toBe(backend);
    // The bench of @mosaikit/testing to try the plugin and to test it (MK-050).
    const scripts = (JSON.parse(files.get('package.json') ?? '{}') as { scripts: object }).scripts;
    expect(scripts).toMatchObject({ test: 'playwright test' });
    expect(files.get('tests/global-setup.ts')).toContain('Bench.start(');
    expect(files.get('tests/traffic-lights.spec.ts')).toContain("openApp(page, 'Traffic lights')");
    if (backend) {
      expect(manifest).toMatchObject({
        backend: { jar: 'lib/traffic-lights.jar', api: 'traffic-lights' },
        database: { schema: 'p_traffic_lights' },
      });
      expect(files.get('db/V1__create_item.sql')).toContain('enable row level security');
      expect(files.get('src/main/java/dev/acme/trafficlights/ItemResource.java')).toContain(
        '@Path("/api/v1/p/traffic-lights/items")',
      );
      expect(files.get('pom.xml')).toContain('<mosaikit.version>0.1.0</mosaikit.version>');
    } else {
      expect(manifest).toMatchObject({ data: { collections: ['items'] } });
      expect(files.get('web/index.js')).toContain("context.data('items').create({ title })");
    }
  });

  it('creates the plugin from the command line', () => {
    const parent = mkdtempSync(join(tmpdir(), 'create-plugin-'));
    directories.push(parent);
    const lines: string[] = [];
    const target = join(parent, 'traffic');

    expect(
      main(['dev.acme.traffic', '--backend', '--directory', target], (line) => lines.push(line)),
    ).toBe(0);
    expect(existsSync(join(target, 'src/main/java/dev/acme/traffic/Item.java'))).toBe(true);
    expect(lines.join()).toContain('Created Traffic (dev.acme.traffic)');

    writeFileSync(join(parent, 'busy'), 'x');
    expect(main(['dev.acme.busy', '--directory', parent], (line) => lines.push(line))).toBe(1);
    expect(main(['Bad id', '--directory', join(parent, 'bad')], (line) => lines.push(line))).toBe(
      1,
    );
    expect(main([], (line) => lines.push(line))).toBe(2);
    expect(main(['--help'], (line) => lines.push(line))).toBe(0);
    expect(main(['--unknown'], (line) => lines.push(line))).toBe(2);
    expect(lines.join()).toContain('Usage: create-mosaikit-plugin');
  });
});
