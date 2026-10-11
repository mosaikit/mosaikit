// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import type { FrontendPlugin } from '@mosaikit/sdk';
import { describe, expect, it } from 'vitest';
import { entryForPath, initials, launcherEntries, matching } from '../src/navigation.js';

const plugin = (attributes: Record<string, unknown>, id = 'app'): FrontendPlugin => ({
  id: 'dev.example.plugin',
  version: '1.0.0',
  entry: '/index.js',
  isolation: 'module',
  contributions: [{ point: 'launcher.app', id, attributes }],
});

describe('launcherEntries (MK-008)', () => {
  it('builds entries from launcher contributions', () => {
    const entries = launcherEntries([
      plugin({ route: '/app/hello', element: 'mk-hello-app', title: 'Hello' }),
    ]);

    expect(entries).toEqual([
      {
        pluginId: 'dev.example.plugin',
        id: 'app',
        title: 'Hello',
        route: '/app/hello',
        element: 'mk-hello-app',
      },
    ]);
  });

  it('uses the contribution id when the title is missing', () => {
    const [entry] = launcherEntries([plugin({ route: '/app/x', element: 'x-app' }, 'fallback')]);

    expect(entry?.title).toBe('fallback');
  });

  it.each([
    { route: '/elsewhere', element: 'mk-hello-app' },
    { route: '/app/hello', element: 'noHyphen' },
    { route: '/app/hello' },
    { element: 'mk-hello-app' },
    { route: 42, element: 'mk-hello-app' },
  ])('ignores invalid contributions %j', (attributes) => {
    expect(launcherEntries([plugin(attributes)])).toEqual([]);
  });
});

describe('entryForPath', () => {
  const entries = launcherEntries([plugin({ route: '/app/hello', element: 'mk-hello-app' })]);

  it('matches the route, ignoring a trailing slash', () => {
    expect(entryForPath(entries, '/app/hello/')?.element).toBe('mk-hello-app');
    expect(entryForPath(entries, '/app/hello')?.element).toBe('mk-hello-app');
  });

  it('returns nothing for other paths', () => {
    expect(entryForPath(entries, '/')).toBeUndefined();
    expect(entryForPath(entries, '/app/other')).toBeUndefined();
  });
});

describe('the app bar (MK-025)', () => {
  const contribution = (
    point: string,
    id: string,
    attributes: Record<string, unknown>,
    pluginId = 'dev.example.plugin',
  ): FrontendPlugin => ({
    id: pluginId,
    version: '1.0.0',
    entry: '/index.js',
    isolation: 'module',
    contributions: [{ point, id, attributes }],
  });

  it('prefers rail.app, still shows launcher.app, and sorts by order', () => {
    const entries = launcherEntries([
      contribution('launcher.app', 'old', { route: '/app/old', element: 'x-old', title: 'Old' }),
      contribution('launcher.app', 'dup', { route: '/app/new', element: 'x-dup', title: 'Dup' }),
      contribution('rail.app', 'new', {
        route: '/app/new',
        element: 'x-new',
        title: 'New',
        order: 10,
        icon: 'web/icon.svg',
      }),
    ]);

    expect(entries.map((entry) => entry.title)).toEqual(['New', 'Old']);
    expect(entries[0]?.icon).toBe('/api/v1/plugin-assets/dev.example.plugin/web/icon.svg');
  });

  it.each(['../secret.svg', '/etc/icon.svg', 'web/icon.js', 'https://elsewhere.example/i.svg'])(
    'ignores the icon %s',
    (icon) => {
      const [entry] = launcherEntries([
        contribution('rail.app', 'a', { route: '/app/a', element: 'x-a', icon }),
      ]);

      expect(entry).toBeDefined();
      expect(entry?.icon).toBeUndefined();
    },
  );

  it('finds apps by a part of their title, and makes initials', () => {
    const items = [{ title: 'To do' }, { title: 'Notes' }, { title: 'Plugins' }];

    expect(matching(items, ' no')).toEqual([{ title: 'Notes' }]);
    expect(matching(items, 'O')).toHaveLength(2);
    expect(matching(items, '   ')).toEqual([]);
    expect(initials('Mario Rossi')).toBe('MR');
    expect(initials('anna maria bianchi')).toBe('AB');
    expect(initials('admin')).toBe('A');
    expect(initials('')).toBe('');
  });
});
