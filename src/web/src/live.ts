// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import type { LiveChannel } from '@mosaikit/sdk';

/** The part of a WebSocket that the client uses, so that the tests can replace it. */
export interface Socket {
  readyState: number;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  send(data: string): void;
  close(): void;
}

type Handler = (data: unknown) => void;

const OPEN = 1;
const MAX_DELAY_MS = 15_000;

/**
 * The real-time channel of the page (MK-031): one WebSocket to /api/v1/live for the organization of
 * the person, shared by the shell and every plugin. It subscribes to a topic once whatever the
 * number of handlers, and after a lost connection it connects again, waiting longer each time, and
 * subscribes again to every topic.
 */
export class LiveClient implements LiveChannel {
  private readonly handlers = new Map<string, Set<Handler>>();
  private socket: Socket | undefined;
  private url: string | undefined;
  private delay = 1000;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly open: (url: string) => Socket = (url) => new WebSocket(url),
    private readonly report: (message: string) => void = (message) => {
      console.warn(message);
    },
  ) {}

  /** Connects for an organization, or without one, replacing the current connection. */
  connect(organization: string | undefined): void {
    this.close();
    const query = organization ? `?organization=${encodeURIComponent(organization)}` : '';
    const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.url = `${scheme}//${location.host}/api/v1/live${query}`;
    this.start();
  }

  /** Ends the connection, at sign-out; the handlers stay for the next one. */
  close(): void {
    this.url = undefined;
    clearTimeout(this.timer);
    const socket = this.socket;
    this.socket = undefined;
    socket?.close();
  }

  subscribe(topic: string, handler: Handler): () => void {
    let set = this.handlers.get(topic);
    if (!set) {
      set = new Set();
      this.handlers.set(topic, set);
      this.write({ type: 'subscribe', topic });
    }
    set.add(handler);
    return () => {
      const current = this.handlers.get(topic);
      current?.delete(handler);
      if (current?.size === 0) {
        this.handlers.delete(topic);
        this.write({ type: 'unsubscribe', topic });
      }
    };
  }

  private start(): void {
    if (!this.url) {
      return;
    }
    const socket = this.open(this.url);
    this.socket = socket;
    socket.onopen = () => {
      this.delay = 1000;
      for (const topic of this.handlers.keys()) {
        this.write({ type: 'subscribe', topic });
      }
    };
    socket.onmessage = (event) => {
      this.receive(event.data);
    };
    socket.onclose = () => {
      if (this.socket !== socket || !this.url) {
        return;
      }
      this.socket = undefined;
      this.timer = setTimeout(() => {
        this.start();
      }, this.delay);
      this.delay = Math.min(this.delay * 2, MAX_DELAY_MS);
    };
  }

  private receive(data: unknown): void {
    let message: { type?: unknown; topic?: unknown; data?: unknown; reason?: unknown };
    try {
      message = JSON.parse(String(data)) as typeof message;
    } catch {
      return;
    }
    const topic = typeof message.topic === 'string' ? message.topic : '';
    if (message.type === 'event') {
      for (const handler of this.handlers.get(topic) ?? []) {
        try {
          handler(message.data);
        } catch (error) {
          this.report(`A handler of the live topic '${topic}' failed: ${String(error)}`);
        }
      }
    } else if (message.type === 'refused') {
      this.report(`The live topic '${topic}' was refused: ${String(message.reason)}`);
    }
  }

  private write(message: { type: string; topic: string }): void {
    if (this.socket?.readyState === OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }
}
