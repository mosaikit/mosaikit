// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { definePlugin, type PluginContext } from '@mosaikit/sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  isFrameMessage,
  isShellMessage,
  type FrameMessage,
  type InitMessage,
} from '../src/bridge-protocol.js';
import { FrameEventBus, PendingCalls, connect, start, type FrameDocument } from '../src/frame.js';

const init: InitMessage = {
  mk: 1,
  type: 'init',
  plugin: { id: 'dev.example.boxed', version: '1.0.0' },
  entry: '/api/v1/plugin-assets/dev.example.boxed/web/index.js',
  element: 'mk-boxed',
  contributions: [],
  user: { username: 'ada', displayName: 'Ada', roles: [] },
  locale: 'it-IT',
  theme: { '--mk-accent': '#0b5', color: 'red' },
};

function fakeDocument() {
  const properties: Record<string, string> = {};
  const rendered: string[] = [];
  const doc = {
    baseURI: 'https://mosaikit.example.org/',
    documentElement: {
      style: { setProperty: (name: string, value: string) => (properties[name] = value) },
    },
    body: {
      textContent: '' as string | null,
      replaceChildren: (...nodes: unknown[]) => {
        rendered.push(...nodes.map((node) => (node as { name: string }).name));
      },
    },
    createElement: (name: string) => ({ name }) as unknown as HTMLElement,
  };
  return { doc: doc as unknown as FrameDocument & typeof doc, properties, rendered };
}

describe('frame runtime (MK-014)', () => {
  it('publishes through the shell and subscribes once per pattern', () => {
    const sent: FrameMessage[] = [];
    const events = new FrameEventBus((message) => sent.push(message));
    const received: unknown[] = [];

    events.publish('boxed.saved', 1);
    const first = events.on('maps.*', (payload) => received.push(payload));
    const second = events.on('maps.*', (payload) => received.push(payload));
    events.deliver('maps.moved', 'a');
    first();
    first();
    second();

    expect(received).toEqual(['a', 'a']);
    expect(sent).toEqual([
      { mk: 1, type: 'publish', topic: 'boxed.saved', payload: 1 },
      { mk: 1, type: 'subscribe', pattern: 'maps.*' },
      { mk: 1, type: 'unsubscribe', pattern: 'maps.*' },
    ]);
  });

  it('turns calls into messages and results into responses', async () => {
    const sent: FrameMessage[] = [];
    const calls = new PendingCalls((message) => sent.push(message));

    const created = calls.fetch('notes', {
      method: 'post',
      headers: { 'Content-Type': 'application/json' },
      body: '{"text":"hi"}',
    });
    const listed = calls.fetch('/api/v1/p/boxed/notes');
    const empty = calls.fetch('notes/1', { method: 'DELETE' });
    const failed = calls.fetch('other');
    calls.settle({
      id: 1,
      status: 201,
      headers: { 'content-type': 'application/json' },
      body: '{"id":1}',
    });
    calls.settle({ id: 2, status: 200, body: '[]' });
    calls.settle({ id: 3, status: 204 });
    calls.settle({ id: 4, error: 'refused' });
    calls.settle({ id: 99, status: 200 });

    expect(sent[0]).toEqual({
      mk: 1,
      type: 'call',
      id: 1,
      service: 'api',
      method: 'POST',
      path: 'notes',
      headers: { 'content-type': 'application/json' },
      body: '{"text":"hi"}',
    });
    expect(sent[1]).toMatchObject({ method: 'GET', path: '/api/v1/p/boxed/notes', headers: {} });
    expect(await (await created).json()).toEqual({ id: 1 });
    expect(await (await listed).text()).toBe('[]');
    expect((await empty).status).toBe(204);
    await expect(failed).rejects.toThrow('refused');
    await expect(calls.fetch('x', { body: new Blob(['x']) })).rejects.toThrow('text bodies');
  });

  it('activates the plugin and renders its app with the tokens of the shell', async () => {
    const { doc, properties, rendered } = fakeDocument();
    let context: PluginContext | undefined;
    const importModule = vi.fn(() =>
      Promise.resolve({
        default: definePlugin({
          activate: (received) => {
            context = received;
          },
        }),
      }),
    );
    const events = new FrameEventBus(() => undefined);
    const fetch = vi.fn(() => Promise.resolve(new Response()));

    await start(init, events, fetch, importModule, doc);

    expect(importModule).toHaveBeenCalledWith(
      'https://mosaikit.example.org/api/v1/plugin-assets/dev.example.boxed/web/index.js',
    );
    expect(properties).toEqual({ '--mk-accent': '#0b5' });
    expect(rendered).toEqual(['mk-boxed']);
    expect(context).toMatchObject({ plugin: init.plugin, locale: 'it-IT', user: init.user });
    expect(context?.events).toBe(events);
    expect(context?.fetch).toBe(fetch);
  });

  it('refuses a module that is not a plugin', async () => {
    const { doc } = fakeDocument();

    await expect(
      start(init, new FrameEventBus(() => undefined), fetch, () => Promise.resolve({}), doc),
    ).rejects.toThrow('no default plugin export');
  });

  it('talks with the shell through the channel it sends to the shell origin', async () => {
    const { doc, rendered } = fakeDocument();
    const announced: [unknown, string, Transferable[] | undefined][] = [];
    const parent = {
      postMessage: (message: unknown, origin: string, transfer?: Transferable[]) =>
        announced.push([message, origin, transfer]),
    };
    const received: unknown[] = [];
    const importModule = () =>
      Promise.resolve({
        default: definePlugin({
          activate: (context) => {
            context.events.on('maps.moved', (payload) => received.push(payload));
          },
        }),
      });

    const channel = new MessageChannel();
    connect(parent as unknown as Window, doc, importModule, channel);
    const shell = channel.port2;
    const posted: unknown[] = [];
    shell.onmessage = (event: MessageEvent<unknown>) => posted.push(event.data);
    const tick = () => new Promise((resolve) => setTimeout(resolve, 10));
    shell.postMessage({ mk: 1, type: 'event', topic: 'maps.moved', payload: 'ignored' });
    shell.postMessage(init);
    shell.postMessage(init);
    await tick();
    shell.postMessage({ mk: 1, type: 'event', topic: 'maps.moved', payload: 'seen' });
    shell.postMessage({ mk: 1, type: 'result', id: 1, status: 200 });
    shell.postMessage('noise');
    await tick();

    expect(announced).toHaveLength(1);
    expect(announced[0]?.[0]).toEqual({ mk: 1, type: 'ready' });
    expect(announced[0]?.[1]).toBe('https://mosaikit.example.org');
    expect(announced[0]?.[2]).toEqual([shell]);
    expect(posted[0]).toEqual({ mk: 1, type: 'subscribe', pattern: 'maps.moved' });
    expect(rendered).toEqual(['mk-boxed']);
    expect(received).toEqual(['seen']);
    channel.port1.close();
    shell.close();
  });

  it('shows why an app could not start', async () => {
    const { doc } = fakeDocument();
    const channel = new MessageChannel();
    connect({ postMessage: () => undefined }, doc, () => Promise.reject(new Error('404')), channel);

    channel.port2.postMessage(init);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(doc.body.textContent).toContain('could not be started: Error: 404');
    channel.port1.close();
    channel.port2.close();
  });
});

describe('bridge messages (MK-014)', () => {
  it('accepts only well-formed messages', () => {
    expect(isFrameMessage({ mk: 1, type: 'publish', topic: 'a.b', payload: 1 })).toBe(true);
    expect(isFrameMessage({ mk: 1, type: 'subscribe', pattern: 'a.*' })).toBe(true);
    expect(
      isFrameMessage({
        mk: 1,
        type: 'call',
        id: 1,
        service: 'api',
        method: 'GET',
        path: 'x',
        headers: {},
      }),
    ).toBe(true);
    expect(
      isFrameMessage({
        mk: 1,
        type: 'call',
        id: 1,
        service: 'api',
        method: 'GET',
        path: 'x',
        headers: { a: 1 },
      }),
    ).toBe(false);
    expect(
      isFrameMessage({
        mk: 1,
        type: 'call',
        id: 1,
        service: 'api',
        method: 'GET',
        path: 'x',
        headers: {},
        body: 1,
      }),
    ).toBe(false);
    expect(isFrameMessage({ mk: 2, type: 'ready' })).toBe(false);
    expect(isFrameMessage(null)).toBe(false);
    expect(isShellMessage(init)).toBe(true);
    expect(isShellMessage({ mk: 1, type: 'event', topic: 'a.b' })).toBe(true);
    expect(isShellMessage({ mk: 1, type: 'result', id: 1 })).toBe(true);
    expect(isShellMessage({ mk: 1, type: 'init', entry: 1 })).toBe(false);
    expect(isShellMessage({ mk: 1, type: 'other' })).toBe(false);
    expect(isShellMessage(undefined)).toBe(false);
  });
});
