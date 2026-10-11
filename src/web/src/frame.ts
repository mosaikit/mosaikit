// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
/**
 * Runtime of a plugin frontend isolated in a sandboxed iframe (MK-014). The shell creates the
 * frame with this script only; the runtime asks for the plugin, imports its module, activates it
 * with a context that goes through the bridge, and renders the requested app.
 */
import {
  dataCollections,
  NO_LIVE,
  EventBus,
  isMosaikitPlugin,
  type EventHandler,
  type PluginContext,
} from '@mosaikit/sdk';
import { isShellMessage, type FrameMessage, type InitMessage } from './bridge-protocol.js';

/** Events of the frame: published through the shell, received for declared subscriptions only. */
export class FrameEventBus extends EventBus {
  private readonly counts = new Map<string, number>();

  constructor(private readonly send: (message: FrameMessage) => void) {
    super((error, topic) => {
      console.error(`A handler of '${topic}' failed`, error);
    });
  }

  override publish(topic: string, payload: unknown): void {
    this.send({ mk: 1, type: 'publish', topic, payload });
  }

  override on(pattern: string, handler: EventHandler): () => void {
    const unsubscribe = super.on(pattern, handler);
    const count = this.counts.get(pattern) ?? 0;
    this.counts.set(pattern, count + 1);
    if (count === 0) {
      this.send({ mk: 1, type: 'subscribe', pattern });
    }
    let active = true;
    return () => {
      if (!active) {
        return;
      }
      active = false;
      unsubscribe();
      const left = (this.counts.get(pattern) ?? 1) - 1;
      if (left === 0) {
        this.counts.delete(pattern);
        this.send({ mk: 1, type: 'unsubscribe', pattern });
      } else {
        this.counts.set(pattern, left);
      }
    };
  }

  /** Delivers an event received from the shell to the handlers of the frame. */
  deliver(topic: string, payload: unknown): void {
    super.publish(topic, payload);
  }
}

/** Calls of the frame waiting for their result. */
export class PendingCalls {
  private next = 1;
  private readonly waiting = new Map<number, (result: Response | Error) => void>();

  constructor(private readonly send: (message: FrameMessage) => void) {}

  /** `fetch` of the plugin context: only the backend API of the plugin, through the shell. */
  readonly fetch = (path: string, init: RequestInit = {}): Promise<Response> => {
    if (init.body !== undefined && init.body !== null && typeof init.body !== 'string') {
      return Promise.reject(new TypeError('An isolated plugin can only send text bodies'));
    }
    const body = typeof init.body === 'string' ? init.body : undefined;
    const id = this.next++;
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((value, name) => {
      headers[name] = value;
    });
    return new Promise((resolve, reject) => {
      this.waiting.set(id, (result) => {
        if (result instanceof Error) {
          reject(result);
        } else {
          resolve(result);
        }
      });
      this.send({
        mk: 1,
        type: 'call',
        id,
        service: 'api',
        method: (init.method ?? 'GET').toUpperCase(),
        path,
        headers,
        ...(body === undefined ? {} : { body }),
      });
    });
  };

  /** Settles a call with its result. */
  settle(result: {
    id: number;
    status?: number;
    headers?: Readonly<Record<string, string>>;
    body?: string;
    error?: string;
  }): void {
    const complete = this.waiting.get(result.id);
    if (!complete) {
      return;
    }
    this.waiting.delete(result.id);
    if (result.error !== undefined || result.status === undefined) {
      complete(new Error(result.error ?? 'The call failed'));
      return;
    }
    const noBody = result.status === 204 || result.status === 304;
    complete(
      new Response(noBody ? null : (result.body ?? ''), {
        status: result.status,
        ...(result.headers ? { headers: result.headers } : {}),
      }),
    );
  }
}

/** The parts of the document of the frame that the runtime uses. */
export interface FrameDocument {
  readonly baseURI: string;
  readonly documentElement: { readonly style: Pick<CSSStyleDeclaration, 'setProperty'> };
  readonly body: Pick<HTMLElement, 'replaceChildren'> & { textContent: string | null };
  createElement(name: string): HTMLElement;
}

/** Imports the plugin, activates it and renders the app of the init message. */
export async function start(
  init: InitMessage,
  events: EventBus,
  fetch: PluginContext['fetch'],
  importModule: (url: string) => Promise<unknown> = (url) => import(/* @vite-ignore */ url),
  doc: FrameDocument = document,
): Promise<void> {
  for (const [name, value] of Object.entries(init.theme)) {
    if (name.startsWith('--mk-')) {
      doc.documentElement.style.setProperty(name, value);
    }
  }
  const module = await importModule(new URL(init.entry, doc.baseURI).href);
  const plugin = (module as { default?: unknown }).default;
  if (!isMosaikitPlugin(plugin)) {
    throw new Error('the module has no default plugin export');
  }
  await plugin.activate({
    plugin: init.plugin,
    contributions: init.contributions,
    // The elements of other plugins are not loaded in the frame (MK-020).
    contributionsTo: () => [],
    events,
    locale: init.locale,
    user: init.user,
    fetch,
    // Through the data service of the bridge, which the shell checks (ADR-0031).
    data: dataCollections(fetch, init.plugin.id),
    // An isolated frame has no real-time channel of its own (MK-031).
    live: NO_LIVE,
    notify: () => Promise.reject(new Error('Notifications are not sent from an isolated frame')),
  });
  doc.body.replaceChildren(doc.createElement(init.element));
}

/**
 * Connects the frame to the shell that created it. The frame sends the shell, and only the shell
 * origin, one end of a new message channel with its `ready` message: every other message of both
 * sides goes through that channel, which no other window can use.
 */
export function connect(
  parent: Pick<Window, 'postMessage'> = window.parent,
  doc: FrameDocument = document,
  importModule?: (url: string) => Promise<unknown>,
  channel: MessageChannel = new MessageChannel(),
): void {
  const shellOrigin = new URL(doc.baseURI).origin;
  const port = channel.port1;
  const send = (message: FrameMessage): void => {
    port.postMessage(message);
  };
  const events = new FrameEventBus(send);
  const calls = new PendingCalls(send);
  let started = false;
  port.onmessage = (event: MessageEvent<unknown>) => {
    if (!isShellMessage(event.data)) {
      return;
    }
    const message = event.data;
    if (message.type === 'init' && !started) {
      started = true;
      start(message, events, calls.fetch, importModule, doc).catch((error: unknown) => {
        doc.body.textContent = `This app could not be started: ${String(error)}`;
      });
    } else if (message.type === 'event') {
      events.deliver(message.topic, message.payload);
    } else if (message.type === 'result') {
      calls.settle(message);
    }
  };
  const ready: FrameMessage = { mk: 1, type: 'ready' };
  parent.postMessage(ready, shellOrigin, [channel.port2]);
}

if (typeof window !== 'undefined' && window.parent !== window) {
  connect();
}
