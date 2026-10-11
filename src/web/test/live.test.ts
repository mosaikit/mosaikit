// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveClient, type Socket } from '../src/live.js';

class FakeSocket implements Socket {
  readyState = 0;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  readonly sent: unknown[] = [];
  closed = false;

  constructor(readonly url: string) {}

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }

  close(): void {
    this.closed = true;
  }

  opens(): void {
    this.readyState = 1;
    this.onopen?.({} as Event);
  }

  receives(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent);
  }

  drops(): void {
    this.readyState = 3;
    this.onclose?.({} as CloseEvent);
  }
}

describe('LiveClient (MK-031)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('location', { protocol: 'https:', host: 'mosaikit.example.org' });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function client() {
    const sockets: FakeSocket[] = [];
    const warnings: string[] = [];
    const live = new LiveClient(
      (url) => {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket;
      },
      (warning) => warnings.push(warning),
    );
    return { live, sockets, warnings };
  }

  it('subscribes once per topic and gives the events to every handler', () => {
    const { live, sockets } = client();
    const first: unknown[] = [];
    const second: unknown[] = [];
    live.subscribe('documents.p.items', (data) => first.push(data));
    live.connect('comune di prova');
    const socket = sockets[0];
    expect(socket?.url).toBe(
      'wss://mosaikit.example.org/api/v1/live?organization=comune%20di%20prova',
    );
    socket?.opens();
    const stop = live.subscribe('documents.p.items', (data) => second.push(data));

    socket?.receives({ type: 'event', topic: 'documents.p.items', data: { id: '1' } });
    socket?.receives({ type: 'event', topic: 'other', data: {} });
    expect(first).toEqual([{ id: '1' }]);
    expect(second).toEqual([{ id: '1' }]);
    expect(socket?.sent).toEqual([{ type: 'subscribe', topic: 'documents.p.items' }]);

    stop();
    expect(socket?.sent).toHaveLength(1);
  });

  it('unsubscribes when the last handler goes, and reports refused topics', () => {
    const { live, sockets, warnings } = client();
    live.connect(undefined);
    sockets[0]?.opens();
    const stop = live.subscribe('secret', () => undefined);
    sockets[0]?.receives({ type: 'refused', topic: 'secret', reason: 'not a topic' });
    stop();

    expect(sockets[0]?.sent).toEqual([
      { type: 'subscribe', topic: 'secret' },
      { type: 'unsubscribe', topic: 'secret' },
    ]);
    expect(warnings).toEqual(["The live topic 'secret' was refused: not a topic"]);
  });

  it('connects again after a lost connection and subscribes again, but not after close', () => {
    const { live, sockets } = client();
    live.subscribe('notifications', () => undefined);
    live.connect('acme');
    sockets[0]?.opens();
    sockets[0]?.drops();
    vi.advanceTimersByTime(1000);
    expect(sockets).toHaveLength(2);
    sockets[1]?.opens();
    expect(sockets[1]?.sent).toEqual([{ type: 'subscribe', topic: 'notifications' }]);

    live.close();
    expect(sockets[1]?.closed).toBe(true);
    sockets[1]?.drops();
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(2);
  });

  it('keeps going when a handler fails or a message is not JSON', () => {
    const { live, sockets, warnings } = client();
    live.subscribe('t', () => {
      throw new Error('boom');
    });
    live.connect('acme');
    sockets[0]?.opens();
    sockets[0]?.onmessage?.({ data: 'not json' } as MessageEvent);
    sockets[0]?.receives({ type: 'event', topic: 't', data: 1 });
    expect(warnings[0]).toContain("A handler of the live topic 't' failed");
  });
});
