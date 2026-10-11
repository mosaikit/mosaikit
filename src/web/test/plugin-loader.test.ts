// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { definePlugin, type FrontendPlugin, type PluginContext } from '@mosaikit/sdk';
import { describe, expect, it, vi } from 'vitest';
import { PluginLoader } from '../src/plugin-loader.js';

const user = { username: 'ada@example.org', displayName: 'Ada', roles: ['organization-user'] };

const frontend = (id: string, isolation: 'module' | 'iframe' = 'module'): FrontendPlugin => ({
  id,
  version: '1.0.0',
  entry: `/${id}.js`,
  isolation,
  contributions: [],
});

describe('PluginLoader (MK-008)', () => {
  it('activates plugins with their context and isolates failures', async () => {
    let received: PluginContext | undefined;
    const modules: Record<string, unknown> = {
      '/good.js': {
        default: definePlugin({
          activate: (context) => {
            received = context;
          },
        }),
      },
      '/broken.js': {
        default: definePlugin({
          activate: () => {
            throw new Error('boom');
          },
        }),
      },
      '/empty.js': {},
    };
    const request = vi.fn(() => Promise.resolve(new Response()));
    const loader = new PluginLoader(request, (url) =>
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

    expect(results.map((result) => [result.pluginId, result.loaded])).toEqual([
      ['good', true],
      ['broken', false],
      ['empty', false],
      ['missing', false],
      // Loaded in its own frame when one of its apps opens (MK-014).
      ['boxed', true],
    ]);
    expect(received?.plugin).toEqual({ id: 'good', version: '1.0.0' });
    expect(received?.user).toBe(user);
    expect(received?.events).toBe(loader.events);
  });

  it('gives a plugin the contributions to the points it declares (MK-020)', async () => {
    let context: PluginContext | undefined;
    const owner: FrontendPlugin = {
      ...frontend('activities'),
      points: ['activities.detail'],
    };
    const extension: FrontendPlugin = {
      ...frontend('estimates'),
      contributions: [
        { point: 'activities.detail', id: 'estimate', attributes: { element: 'mk-estimate' } },
        { point: 'launcher.app', id: 'app', attributes: {} },
      ],
    };
    const loader = new PluginLoader(
      () => Promise.resolve(new Response()),
      (url) =>
        Promise.resolve(
          url === '/activities.js'
            ? { default: definePlugin({ activate: (received) => void (context = received) }) }
            : { default: definePlugin({ activate: () => undefined }) },
        ),
    );

    await loader.loadAll([owner, extension], user);

    expect(context?.contributionsTo('activities.detail')).toEqual([
      {
        point: 'activities.detail',
        id: 'estimate',
        attributes: { element: 'mk-estimate' },
        pluginId: 'estimates',
      },
    ]);
    expect(context?.contributionsTo('launcher.app')).toEqual([]);
  });

  it('reports errors of event handlers without throwing', () => {
    const report = vi.fn();
    const loader = new PluginLoader(vi.fn(), vi.fn(), report);
    loader.events.on('a.b', () => {
      throw new Error('handler');
    });

    loader.events.publish('a.b', null);

    expect(report).toHaveBeenCalledWith("A handler of 'a.b' failed", expect.any(Error));
  });
});
