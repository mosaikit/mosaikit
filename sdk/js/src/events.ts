// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0

/** Handler of an event published on a topic. */
export type EventHandler = (payload: unknown, topic: string) => void;

/** Receives failures of event handlers, so that one extension cannot break another. */
export type HandlerErrorListener = (error: unknown, topic: string) => void;

/**
 * Publish and subscribe channel between extensions in the browser.
 *
 * Topics are dotted names such as `maps.selection.changed`. A subscription may end with `.*`
 * to receive every topic below a prefix. Handlers run synchronously; an error thrown by one handler
 * is reported and does not stop the others.
 */
export class EventBus {
  private readonly handlers = new Map<string, Set<EventHandler>>();

  constructor(private readonly onHandlerError: HandlerErrorListener = () => undefined) {}

  /** Delivers a payload to every handler subscribed to the topic. */
  publish(topic: string, payload: unknown): void {
    assertTopic(topic, false);
    for (const [pattern, handlers] of this.handlers) {
      if (!topicMatches(pattern, topic)) {
        continue;
      }
      // A copy: a handler may subscribe or unsubscribe while the event is delivered.
      const current = [...handlers];
      for (const handler of current) {
        try {
          handler(payload, topic);
        } catch (error) {
          this.onHandlerError(error, topic);
        }
      }
    }
  }

  /** Subscribes to a topic or a prefix ending with `.*`. Returns a function that unsubscribes. */
  on(pattern: string, handler: EventHandler): () => void {
    assertTopic(pattern, true);
    const handlers = this.handlers.get(pattern) ?? new Set<EventHandler>();
    handlers.add(handler);
    this.handlers.set(pattern, handlers);
    return () => {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.handlers.delete(pattern);
      }
    };
  }
}

const TOPIC = /^[a-z][a-zA-Z0-9-]*(\.[a-z][a-zA-Z0-9-]*)+$/;

function assertTopic(topic: string, allowWildcard: boolean): void {
  if (!isTopic(topic, allowWildcard)) {
    throw new Error(
      `Invalid event topic '${topic}': use a dotted name such as 'maps.selection.changed'`,
    );
  }
}

/** Whether a topic is received by a subscription pattern (a topic, or a prefix ending with `.*`). */
export function topicMatches(pattern: string, topic: string): boolean {
  if (pattern.endsWith('.*')) {
    return topic.startsWith(pattern.slice(0, -1));
  }
  return pattern === topic;
}

/**
 * Whether a declared pattern allows a requested one: the same topic or prefix, or a topic or
 * prefix below a declared prefix.
 */
export function patternCovers(declared: string, requested: string): boolean {
  if (declared === requested) {
    return true;
  }
  return declared.endsWith('.*') && requested.startsWith(declared.slice(0, -1));
}

/** Whether a text is a valid topic, or with `allowWildcard` a prefix ending with `.*`. */
export function isTopic(text: string, allowWildcard = false): boolean {
  const name = allowWildcard && text.endsWith('.*') ? text.slice(0, -2) + '.x' : text;
  return TOPIC.test(name);
}
