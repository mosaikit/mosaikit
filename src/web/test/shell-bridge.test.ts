// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { EventBus, type FrontendBridge, type FrontendPlugin } from '@mosaikit/sdk';
import { describe, expect, it, vi } from 'vitest';
import type { ShellMessage } from '../src/bridge-protocol.js';
import { ShellBridge } from '../src/shell-bridge.js';

const declared: FrontendBridge = {
  publishes: ['boxed.saved', 'boxed.status.*'],
  subscribes: ['maps.*', 'shell.theme.changed'],
  services: ['api'],
  api: '/api/v1/p/boxed/',
};

const plugin: FrontendPlugin = {
  id: 'dev.example.boxed',
  version: '1.0.0',
  entry: '/api/v1/plugin-assets/dev.example.boxed/web/index.js',
  isolation: 'iframe',
  bridge: declared,
  contributions: [],
};

function setup(target: FrontendPlugin = plugin) {
  const events = new EventBus();
  const sent: ShellMessage[] = [];
  const warnings: string[] = [];
  const request = vi.fn((path: string, init?: RequestInit) =>
    Promise.resolve(
      new Response(JSON.stringify({ path, method: init?.method, body: init?.body }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
  const bridge = new ShellBridge(
    target,
    events,
    request,
    (message) => sent.push(message),
    (warning) => warnings.push(warning),
  );
  return { bridge, events, sent, warnings, request };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('ShellBridge (MK-014)', () => {
  it('recognises the ready message and ignores anything that is not a bridge message', () => {
    const { bridge } = setup();

    expect(bridge.handle({ mk: 1, type: 'ready' })).toBe(true);
    expect(bridge.handle({ type: 'ready' })).toBe(false);
    expect(bridge.handle('ready')).toBe(false);
    expect(bridge.handle({ mk: 1, type: 'teleport' })).toBe(false);
  });

  it('publishes only the declared topics', () => {
    const { bridge, events, warnings } = setup();
    const received: string[] = [];
    events.on('boxed.*', (_payload, topic) => received.push(topic));

    bridge.handle({ mk: 1, type: 'publish', topic: 'boxed.saved', payload: 1 });
    bridge.handle({ mk: 1, type: 'publish', topic: 'boxed.status.ok', payload: 2 });
    bridge.handle({ mk: 1, type: 'publish', topic: 'boxed.deleted', payload: 3 });

    expect(received).toEqual(['boxed.saved', 'boxed.status.ok']);
    expect(warnings).toEqual([expect.stringContaining("may not publish 'boxed.deleted'")]);
  });

  it('forwards the events of declared subscriptions until they end', () => {
    const { bridge, events, sent, warnings } = setup();

    bridge.handle({ mk: 1, type: 'subscribe', pattern: 'maps.selection.changed' });
    bridge.handle({ mk: 1, type: 'subscribe', pattern: 'maps.selection.changed' });
    bridge.handle({ mk: 1, type: 'subscribe', pattern: 'accounts.*' });
    events.publish('maps.selection.changed', { id: 7 });
    events.publish('accounts.created', { id: 8 });
    bridge.handle({ mk: 1, type: 'unsubscribe', pattern: 'maps.selection.changed' });
    events.publish('maps.selection.changed', { id: 9 });

    expect(sent).toEqual([
      { mk: 1, type: 'event', topic: 'maps.selection.changed', payload: { id: 7 } },
    ]);
    expect(warnings).toEqual([expect.stringContaining("may not receive 'accounts.*'")]);
  });

  it('ends every subscription when disposed', () => {
    const { bridge, events, sent } = setup();
    bridge.handle({ mk: 1, type: 'subscribe', pattern: 'shell.theme.changed' });

    bridge.dispose();
    events.publish('shell.theme.changed', 'dark');

    expect(sent).toEqual([]);
  });

  it('calls the API of the plugin with the credentials of the shell', async () => {
    const { bridge, sent, request } = setup();

    bridge.handle({
      mk: 1,
      type: 'call',
      id: 1,
      service: 'api',
      method: 'POST',
      path: 'notes',
      headers: { 'content-type': 'application/json', authorization: 'Bearer stolen', cookie: 'x' },
      body: '{"text":"hi"}',
    });
    bridge.handle({
      mk: 1,
      type: 'call',
      id: 2,
      service: 'api',
      method: 'GET',
      path: '/api/v1/p/boxed/notes?limit=5',
      headers: {},
    });
    await settle();

    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0]).toEqual([
      '/api/v1/p/boxed/notes',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"text":"hi"}' },
    ]);
    expect(request.mock.calls[1]?.[0]).toBe('/api/v1/p/boxed/notes?limit=5');
    expect(sent[0]).toMatchObject({
      type: 'result',
      id: 1,
      status: 201,
      headers: { 'content-type': 'application/json' },
    });
  });

  it('refuses calls outside the API of the plugin or to undeclared services', async () => {
    const { bridge, sent, request } = setup();
    const call = (id: number, service: string, method: string, path: string) =>
      bridge.handle({ mk: 1, type: 'call', id, service, method, path, headers: {} });

    call(1, 'api', 'GET', '/api/v1/organizations');
    call(2, 'api', 'GET', '../../organizations');
    call(3, 'api', 'GET', '//attacker.example/steal');
    call(4, 'api', 'TRACE', 'notes');
    call(5, 'storage', 'GET', 'notes');
    call(6, 'api', 'GET', '/api/v1/p/boxed/..%2F..%2Forganizations');
    await settle();

    expect(request).not.toHaveBeenCalled();
    expect(sent.map((message) => message.type === 'result' && message.error)).toEqual([
      expect.stringContaining('only the API of the plugin'),
      expect.stringContaining('only the API of the plugin'),
      expect.stringContaining('only the API of the plugin'),
      expect.stringContaining('method TRACE'),
      expect.stringContaining("service 'storage'"),
      expect.stringContaining('only the API of the plugin'),
    ]);
  });

  it('lets nothing through for a plugin without a bridge or without an API', async () => {
    const bare: FrontendPlugin = {
      id: plugin.id,
      version: plugin.version,
      entry: plugin.entry,
      isolation: 'iframe',
      contributions: [],
    };
    const { bridge, sent, warnings } = setup(bare);
    bridge.handle({ mk: 1, type: 'publish', topic: 'boxed.saved', payload: 1 });
    bridge.handle({
      mk: 1,
      type: 'call',
      id: 1,
      service: 'api',
      method: 'GET',
      path: 'x',
      headers: {},
    });

    const noApi = setup({ ...plugin, bridge: { ...declared, api: null } });
    noApi.bridge.handle({
      mk: 1,
      type: 'call',
      id: 2,
      service: 'api',
      method: 'GET',
      path: 'x',
      headers: {},
    });
    await settle();

    expect(warnings).toHaveLength(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ id: 1 });
    expect(sent[0]?.type === 'result' ? sent[0].error : undefined).toContain("service 'api'");
    expect(noApi.sent).toEqual([
      expect.objectContaining({ id: 2, error: 'the plugin has no backend API' }),
    ]);
  });

  it('reports a failed request as an error result', async () => {
    const events = new EventBus();
    const sent: ShellMessage[] = [];
    const bridge = new ShellBridge(
      plugin,
      events,
      () => Promise.reject(new Error('offline')),
      (m) => sent.push(m),
    );

    bridge.handle({
      mk: 1,
      type: 'call',
      id: 9,
      service: 'api',
      method: 'GET',
      path: 'notes',
      headers: {},
    });
    await settle();

    expect(sent).toEqual([{ mk: 1, type: 'result', id: 9, error: 'Error: offline' }]);
  });

  it('reports invalid topics and messages that cannot be sent', () => {
    const events = new EventBus();
    const warnings: string[] = [];
    const bridge = new ShellBridge(
      { ...plugin, bridge: { ...declared, publishes: ['boxed.*'], subscribes: ['maps.*'] } },
      events,
      () => Promise.resolve(new Response()),
      () => {
        throw new Error('DataCloneError');
      },
      (warning) => warnings.push(warning),
    );

    bridge.handle({ mk: 1, type: 'publish', topic: 'boxed.Bad Topic', payload: 1 });
    bridge.handle({ mk: 1, type: 'subscribe', pattern: 'maps.**' });
    bridge.handle({ mk: 1, type: 'subscribe', pattern: 'maps.moved' });
    events.publish('maps.moved', () => undefined);

    expect(warnings).toEqual([
      expect.stringContaining('invalid event'),
      expect.stringContaining('invalid subscription'),
      expect.stringContaining('could not be sent'),
    ]);
  });

  it('calls the collections of a plugin that declared the data service (ADR-0031)', async () => {
    const { bridge, sent, request } = setup({
      ...plugin,
      bridge: {
        publishes: [],
        subscribes: [],
        services: ['data'],
        data: '/api/v1/data/dev.example.boxed/',
      },
    });
    const call = (id: number, path: string, headers: Record<string, string> = {}) =>
      bridge.handle({ mk: 1, type: 'call', id, service: 'api', method: 'PUT', path, headers });

    call(1, '/api/v1/data/dev.example.boxed/items/42', { 'If-Match': '3', Cookie: 'stolen' });
    call(2, '/api/v1/data/dev.example.other/items');
    call(3, '/api/v1/p/boxed/notes');
    await settle();

    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith('/api/v1/data/dev.example.boxed/items/42', {
      method: 'PUT',
      headers: { 'If-Match': '3' },
    });
    expect(sent.map((message) => (message.type === 'result' ? message.error : undefined))).toEqual([
      expect.stringContaining('under /api/v1/data/dev.example.boxed/'),
      expect.stringContaining('under /api/v1/data/dev.example.boxed/'),
      undefined,
    ]);
  });
});
