// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import type { AllowedOrigin, ContentSecurityPolicy, KernelClient } from './api.js';
import { t } from './i18n.js';

/**
 * What the kernel accepts as an external origin (MK-128), checked in the page before sending: a
 * scheme, a host with at most one leading `*.` before a name of two labels or more, and a port. The
 * kernel checks again, and more strictly.
 */
const ORIGIN =
  /^(https|wss|http|ws):\/\/(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?\/?$/i;

/** Whether a text looks like an origin the kernel accepts. */
export function looksLikeOrigin(text: string): boolean {
  const value = text.trim();
  if (!ORIGIN.test(value)) {
    return false;
  }
  // A wildcard covers the sub-domains of a name of at least two labels.
  const host = value.replace(/^[a-z]+:\/\//i, '').replace(/[:/].*$/, '');
  return !host.startsWith('*.') || host.slice(2).includes('.');
}

/** When and by whom an origin was allowed, or that the configuration allows it. */
export function describeOrigin(origin: AllowedOrigin, when: (iso: string) => string): string {
  if (origin.source === 'CONFIGURATION') {
    return t('Set in the configuration of the installation');
  }
  return t('{when} by {person}', {
    when: origin.addedAt ? when(origin.addedAt) : '',
    person: origin.addedBy ?? '',
  });
}

/** What the list of origins tells the page around it. */
export interface OriginListEvents {
  changed(): void;
  announce(message: string, failed: boolean): void;
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The external origins of the content security policy for platform administrators (MK-128), without
 * the view: reads them, allows and removes one, and says what happened.
 */
export class OriginList {
  policy: ContentSecurityPolicy | undefined;

  constructor(
    private readonly client:
      Pick<KernelClient, 'contentSecurityPolicy' | 'allowOrigin' | 'disallowOrigin'> | undefined,
    private readonly events: OriginListEvents,
  ) {}

  async load(): Promise<void> {
    if (!this.client) {
      return;
    }
    try {
      this.policy = await this.client.contentSecurityPolicy();
    } catch (error) {
      this.events.announce(
        t('The origins cannot be read: {reason}', { reason: reason(error) }),
        true,
      );
    }
    this.events.changed();
  }

  /** Allows an origin; answers whether it was allowed. */
  async allow(text: string): Promise<boolean> {
    if (!this.client) {
      return false;
    }
    if (!looksLikeOrigin(text)) {
      this.events.announce(
        t(
          'Write an origin such as https://tiles.example.org: a scheme (https, wss, http or ws), a host and a port, without a path.',
        ),
        true,
      );
      return false;
    }
    try {
      const added = await this.client.allowOrigin(text.trim());
      await this.load();
      this.events.announce(t('{origin} allowed.', { origin: added.origin }), false);
      return true;
    } catch (error) {
      this.events.announce(t('Not allowed: {reason}', { reason: reason(error) }), true);
      return false;
    }
  }

  async remove(origin: AllowedOrigin): Promise<void> {
    if (!this.client || origin.source === 'CONFIGURATION') {
      return;
    }
    try {
      await this.client.disallowOrigin(origin.origin);
    } catch (error) {
      this.events.announce(t('Not removed: {reason}', { reason: reason(error) }), true);
      return;
    }
    await this.load();
    this.events.announce(t('{origin} removed.', { origin: origin.origin }), false);
  }
}
