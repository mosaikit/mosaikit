// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import {
  patternCovers,
  topicMatches,
  type EventBus,
  type FrontendBridge,
  type FrontendPlugin,
} from '@mosaikit/sdk';
import { isFrameMessage, type CallMessage, type ShellMessage } from './bridge-protocol.js';

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const HEADERS = new Set(['accept', 'content-type', 'if-match']);

/**
 * The side of the shell of the bridge with one isolated frontend (MK-014): it lets through only
 * the events and services the plugin declared, and calls the backend API of the plugin with the
 * credentials of the signed-in person, which the frame never sees.
 */
export class ShellBridge {
  private readonly subscriptions = new Map<string, () => void>();
  private readonly bridge: FrontendBridge;

  constructor(
    private readonly plugin: FrontendPlugin,
    private readonly events: EventBus,
    private readonly request: (path: string, init?: RequestInit) => Promise<Response>,
    private readonly post: (message: ShellMessage) => void,
    private readonly report: (message: string) => void = (message) => {
      console.warn(message);
    },
  ) {
    this.bridge = plugin.bridge ?? { publishes: [], subscribes: [], services: [] };
  }

  /** Handles a message from the frame; returns `true` for the `ready` message. */
  handle(data: unknown): boolean {
    if (!isFrameMessage(data)) {
      return false;
    }
    switch (data.type) {
      case 'ready':
        return true;
      case 'publish':
        this.publish(data.topic, data.payload);
        return false;
      case 'subscribe':
        this.subscribe(data.pattern);
        return false;
      case 'unsubscribe':
        this.subscriptions.get(data.pattern)?.();
        this.subscriptions.delete(data.pattern);
        return false;
      case 'call':
        void this.call(data);
        return false;
    }
  }

  /** Ends every subscription of the frame. */
  dispose(): void {
    for (const unsubscribe of this.subscriptions.values()) {
      unsubscribe();
    }
    this.subscriptions.clear();
  }

  private publish(topic: string, payload: unknown): void {
    if (!this.bridge.publishes.some((pattern) => topicMatches(pattern, topic))) {
      this.report(
        `Plugin ${this.plugin.id} may not publish '${topic}': it is not in bridge.publishes`,
      );
      return;
    }
    try {
      this.events.publish(topic, payload);
    } catch (error) {
      this.report(`Plugin ${this.plugin.id} published an invalid event: ${String(error)}`);
    }
  }

  private subscribe(pattern: string): void {
    if (this.subscriptions.has(pattern)) {
      return;
    }
    if (!this.bridge.subscribes.some((declared) => patternCovers(declared, pattern))) {
      this.report(
        `Plugin ${this.plugin.id} may not receive '${pattern}': it is not in bridge.subscribes`,
      );
      return;
    }
    try {
      const unsubscribe = this.events.on(pattern, (payload, topic) => {
        try {
          this.post({ mk: 1, type: 'event', topic, payload });
        } catch (error) {
          this.report(`An event for plugin ${this.plugin.id} could not be sent: ${String(error)}`);
        }
      });
      this.subscriptions.set(pattern, unsubscribe);
    } catch (error) {
      this.report(`Plugin ${this.plugin.id} asked for an invalid subscription: ${String(error)}`);
    }
  }

  private async call(message: CallMessage): Promise<void> {
    const refused = this.checkCall(message);
    if (refused) {
      this.post({ mk: 1, type: 'result', id: message.id, error: refused });
      return;
    }
    const path = this.resolve(message.path);
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(message.headers)) {
      if (HEADERS.has(name.toLowerCase())) {
        headers[name] = value;
      }
    }
    try {
      const response = await this.request(path, {
        method: message.method,
        headers,
        ...(message.body === undefined ? {} : { body: message.body }),
      });
      this.post({
        mk: 1,
        type: 'result',
        id: message.id,
        status: response.status,
        headers: { 'content-type': response.headers.get('content-type') ?? 'text/plain' },
        body: await response.text(),
      });
    } catch (error) {
      this.post({ mk: 1, type: 'result', id: message.id, error: String(error) });
    }
  }

  /** A relative path is relative to the backend API of the plugin. */
  private resolve(path: string): string {
    return path.startsWith('/') ? path : (this.bridge.api ?? '') + path;
  }

  /**
   * Where the frame may call: the backend API of the plugin (service `api`) and its collections of
   * documents (service `data`, ADR-0031), when it has them.
   */
  private bases(): string[] {
    const bases: string[] = [];
    if (this.bridge.services.includes('api') && this.bridge.api) {
      bases.push(this.bridge.api);
    }
    if (this.bridge.services.includes('data') && this.bridge.data) {
      bases.push(this.bridge.data);
    }
    return bases;
  }

  /** The reason a call is refused, or `undefined` when it may go through. */
  private checkCall(message: CallMessage): string | undefined {
    const declared = this.bridge.services.includes('api') || this.bridge.services.includes('data');
    if (message.service !== 'api' || !declared) {
      return `service '${message.service}' is not in bridge.services`;
    }
    const bases = this.bases();
    if (bases.length === 0) {
      return 'the plugin has no backend API';
    }
    if (!METHODS.has(message.method.toUpperCase())) {
      return `method ${message.method} is not allowed`;
    }
    const path = this.resolve(message.path);
    const resolved = new URL(path, 'https://shell.invalid');
    if (
      resolved.origin !== 'https://shell.invalid' ||
      !bases.some((base) => resolved.pathname.startsWith(base)) ||
      path.includes('..') ||
      path.includes('\\')
    ) {
      return `only the API of the plugin, under ${bases.join(' or ')}, can be called`;
    }
    return undefined;
  }
}
