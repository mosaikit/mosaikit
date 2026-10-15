// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import type { EmbedSite, KernelClient } from './api.js';
import { t } from './i18n.js';
import { looksLikeOrigin } from './origins.js';

/**
 * Whether a text looks like a site the kernel accepts (MK-100): an origin as for the content security
 * policy, with the scheme https, or http for a test site. The kernel checks again, and more strictly.
 */
export function looksLikeSite(text: string): boolean {
  return /^https?:\/\//i.test(text.trim()) && looksLikeOrigin(text);
}

/** What the list of sites tells the page around it. */
export interface EmbedSiteListEvents {
  changed(): void;
  announce(message: string, failed: boolean): void;
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The sites that may show the views of an organization in an iframe, for its administrators
 * (MK-100), without the view: reads them, adds and removes one, and says what happened.
 */
export class EmbedSiteList {
  sites: EmbedSite[] | undefined;

  constructor(
    private readonly client:
      Pick<KernelClient, 'embedSites' | 'addEmbedSite' | 'removeEmbedSite'> | undefined,
    private readonly organization: string | undefined,
    private readonly events: EmbedSiteListEvents,
  ) {}

  async load(): Promise<void> {
    if (!this.client || !this.organization) {
      return;
    }
    try {
      this.sites = await this.client.embedSites(this.organization);
    } catch (error) {
      this.events.announce(
        t('The sites cannot be read: {reason}', { reason: reason(error) }),
        true,
      );
    }
    this.events.changed();
  }

  /** Adds a site; answers whether it was added. */
  async add(text: string): Promise<boolean> {
    if (!this.client || !this.organization) {
      return false;
    }
    if (!looksLikeSite(text)) {
      this.events.announce(
        t(
          'Write a site such as https://www.example.org: https (or http for a test site), a host and a port, without a path.',
        ),
        true,
      );
      return false;
    }
    try {
      const added = await this.client.addEmbedSite(this.organization, text.trim());
      await this.load();
      this.events.announce(t('{origin} may show your views.', { origin: added.origin }), false);
      return true;
    } catch (error) {
      this.events.announce(t('Not added: {reason}', { reason: reason(error) }), true);
      return false;
    }
  }

  async remove(site: EmbedSite): Promise<void> {
    if (!this.client || !this.organization) {
      return;
    }
    try {
      await this.client.removeEmbedSite(this.organization, site.origin);
    } catch (error) {
      this.events.announce(t('Not removed: {reason}', { reason: reason(error) }), true);
      return;
    }
    await this.load();
    this.events.announce(t('{origin} removed.', { origin: site.origin }), false);
  }
}
