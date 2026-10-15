// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import {
  PresenceStore,
  defineExtension,
  type FrontendExtension,
  type ExtensionContext,
} from '@mosaikit/sdk';
import { describe, expect, it, vi } from 'vitest';
import { ExtensionLoader } from '../src/extension-loader.js';

const user = { username: 'ada@example.org', displayName: 'Ada', roles: ['organization-user'] };

const frontend = (id: string, isolation: 'module' | 'iframe' = 'module'): FrontendExtension => ({
  id,
  version: '1.0.0',
  entry: `/${id}.js`,
  isolation,
  contributions: [],
});

describe('ExtensionLoader (MK-008)', () => {
  it('activates extensions with their context and isolates failures', async () => {
    let received: ExtensionContext | undefined;
    const modules: Record<string, unknown> = {
      '/good.js': {
        default: defineExtension({
          activate: (context) => {
            received = context;
          },
        }),
      },
      '/broken.js': {
        default: defineExtension({
          activate: () => {
            throw new Error('boom');
          },
        }),
      },
      '/empty.js': {},
    };
    const request = vi.fn(() => Promise.resolve(new Response()));
    const loader = new ExtensionLoader(request, (url) =>
      url === '/missing.js' ? Promise.reject(new Error('404')) : Promise.resolve(modules[url]),
    );

    const results = await loader.loadAll(
      [
        frontend('good'),
        frontend('broken'),
        frontend('empty'),
        frontend('missing'),
        frontend('boxed', 'iframe'),
      ],
      user,
    );

    expect(results.map((result) => [result.extensionId, result.loaded])).toEqual([
      ['good', true],
      ['broken', false],
      ['empty', false],
      ['missing', false],
      // Loaded in its own frame when one of its apps opens (MK-014).
      ['boxed', true],
    ]);
    expect(received?.extension).toEqual({ id: 'good', version: '1.0.0' });
    expect(received?.user).toBe(user);
    expect(received?.events).toBe(loader.events);
  });

  it('gives an extension the contributions to the points it declares (MK-020)', async () => {
    let context: ExtensionContext | undefined;
    const owner: FrontendExtension = {
      ...frontend('activities'),
      points: ['activities.detail'],
    };
    const extension: FrontendExtension = {
      ...frontend('estimates'),
      contributions: [
        { point: 'activities.detail', id: 'estimate', attributes: { element: 'mk-estimate' } },
        { point: 'launcher.app', id: 'app', attributes: {} },
      ],
    };
    const loader = new ExtensionLoader(
      () => Promise.resolve(new Response()),
      (url) =>
        Promise.resolve(
          url === '/activities.js'
            ? { default: defineExtension({ activate: (received) => void (context = received) }) }
            : { default: defineExtension({ activate: () => undefined }) },
        ),
    );

    await loader.loadAll([owner, extension], user);

    expect(context?.contributionsTo('activities.detail')).toEqual([
      {
        point: 'activities.detail',
        id: 'estimate',
        attributes: { element: 'mk-estimate' },
        extensionId: 'estimates',
      },
    ]);
    expect(context?.contributionsTo('launcher.app')).toEqual([]);
  });

  it('tells an extension which others are active in the organization (MK-133)', async () => {
    let context: ExtensionContext | undefined;
    const presence = new PresenceStore([{ id: 'org.example.ext.catalog', version: '1.2.0' }]);
    const loader = new ExtensionLoader(
      () => Promise.resolve(new Response()),
      () =>
        Promise.resolve({
          default: defineExtension({ activate: (received) => void (context = received) }),
        }),
      undefined,
      undefined,
      presence,
    );

    await loader.loadAll([frontend('boards')], user);

    expect(context?.extensions.isActive('org.example.ext.catalog')).toBe(true);
    presence.apply({
      extension: 'org.example.ext.catalog',
      active: false,
      version: '1.2.0',
      reason: 'removed',
    });
    expect(context?.extensions.isActive('org.example.ext.catalog')).toBe(false);

    // Without a presence, no other extension is active.
    const alone = new ExtensionLoader(
      () => Promise.resolve(new Response()),
      () =>
        Promise.resolve({
          default: defineExtension({ activate: (received) => void (context = received) }),
        }),
    );
    await alone.loadAll([frontend('boards')], user);
    expect(context?.extensions.active()).toEqual([]);
  });

  it('reports errors of event handlers without throwing', () => {
    const report = vi.fn();
    const loader = new ExtensionLoader(vi.fn(), vi.fn(), report);
    loader.events.on('a.b', () => {
      throw new Error('handler');
    });

    loader.events.publish('a.b', null);

    expect(report).toHaveBeenCalledWith("A handler of 'a.b' failed", expect.any(Error));
  });
});
