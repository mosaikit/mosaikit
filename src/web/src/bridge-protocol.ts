// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import type { Contribution, CurrentUser } from '@mosaikit/sdk';

/**
 * Messages between the shell and a plugin frontend isolated in a sandboxed iframe (MK-014). They
 * travel with `postMessage`; every message carries `mk: 1`, and each side checks the window that
 * sent it, since the frame has an opaque origin.
 */

/** Sent by the frame once its runtime is loaded. */
export interface ReadyMessage {
  readonly mk: 1;
  readonly type: 'ready';
}

/** Publishes an event on the bus of the shell. */
export interface PublishMessage {
  readonly mk: 1;
  readonly type: 'publish';
  readonly topic: string;
  readonly payload: unknown;
}

/** Starts or stops receiving the events of a topic or prefix. */
export interface SubscriptionMessage {
  readonly mk: 1;
  readonly type: 'subscribe' | 'unsubscribe';
  readonly pattern: string;
}

/** A request to a service of the shell: `api`, the backend API of the plugin. */
export interface CallMessage {
  readonly mk: 1;
  readonly type: 'call';
  readonly id: number;
  readonly service: string;
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
}

export type FrameMessage = ReadyMessage | PublishMessage | SubscriptionMessage | CallMessage;

/** What the frame needs to activate the plugin and render one of its apps. */
export interface InitMessage {
  readonly mk: 1;
  readonly type: 'init';
  readonly plugin: { readonly id: string; readonly version: string };
  readonly entry: string;
  readonly element: string;
  readonly contributions: readonly Contribution[];
  readonly user: CurrentUser;
  readonly locale: string;
  /** Design tokens of the shell (`--mk-*` custom properties), so that the app looks the same. */
  readonly theme: Readonly<Record<string, string>>;
}

/** An event of a subscription of the frame. */
export interface EventMessage {
  readonly mk: 1;
  readonly type: 'event';
  readonly topic: string;
  readonly payload: unknown;
}

/** The answer to a call: a response, or the reason it was refused. */
export interface ResultMessage {
  readonly mk: 1;
  readonly type: 'result';
  readonly id: number;
  readonly status?: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly error?: string;
}

export type ShellMessage = InitMessage | EventMessage | ResultMessage;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === 'string');
}

/** Checks the shape of a message received from a frame; anything else is ignored. */
export function isFrameMessage(data: unknown): data is FrameMessage {
  if (!isRecord(data) || data.mk !== 1) {
    return false;
  }
  switch (data.type) {
    case 'ready':
      return true;
    case 'publish':
      return typeof data.topic === 'string';
    case 'subscribe':
    case 'unsubscribe':
      return typeof data.pattern === 'string';
    case 'call':
      return (
        typeof data.id === 'number' &&
        typeof data.service === 'string' &&
        typeof data.method === 'string' &&
        typeof data.path === 'string' &&
        isStringRecord(data.headers) &&
        (data.body === undefined || typeof data.body === 'string')
      );
    default:
      return false;
  }
}

/** Checks the shape of a message received from the shell. */
export function isShellMessage(data: unknown): data is ShellMessage {
  if (!isRecord(data) || data.mk !== 1) {
    return false;
  }
  switch (data.type) {
    case 'init':
      return (
        typeof data.entry === 'string' && typeof data.element === 'string' && isRecord(data.user)
      );
    case 'event':
      return typeof data.topic === 'string';
    case 'result':
      return typeof data.id === 'number';
    default:
      return false;
  }
}
