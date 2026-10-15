// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import type { KernelClient, OrganizationSummary } from './api.js';
import { t } from './i18n.js';

/** What the list of organizations tells the page around it. */
export interface OrganizationListEvents {
  changed(): void;
  announce(message: string, failed: boolean): void;
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Whether what the administrator wrote names the organization, as the kernel asks to delete it. */
export function confirms(organization: OrganizationSummary, typed: string): boolean {
  return typed.trim() === organization.slug;
}

/**
 * The organizations of the installation for platform administrators, without the view: reads them
 * and deletes one once its slug is written again (MK-130), and says what happened.
 */
export class OrganizationList {
  organizations: readonly OrganizationSummary[] | undefined;

  constructor(
    private readonly client: Pick<KernelClient, 'organizations' | 'deleteOrganization'> | undefined,
    private readonly events: OrganizationListEvents,
    private readonly when: (iso: string) => string,
  ) {}

  async load(): Promise<void> {
    if (!this.client) {
      return;
    }
    try {
      this.organizations = await this.client.organizations();
    } catch (error) {
      this.events.announce(
        t('The organizations cannot be read: {reason}', { reason: reason(error) }),
        true,
      );
    }
    this.events.changed();
  }

  /** Deletes an organization when `typed` is its slug; answers whether it was deleted. */
  async remove(organization: OrganizationSummary, typed: string): Promise<boolean> {
    if (!this.client) {
      return false;
    }
    if (!confirms(organization, typed)) {
      this.events.announce(
        t('Write {slug} to confirm: nothing was deleted.', { slug: organization.slug }),
        true,
      );
      return false;
    }
    try {
      const deleted = await this.client.deleteOrganization(organization.slug, typed.trim());
      await this.load();
      this.events.announce(
        t('{name} deleted: {members} people lost access. Its data are removed from {date}.', {
          name: deleted.name,
          members: String(deleted.members),
          date: this.when(deleted.removableFrom),
        }),
        false,
      );
      return true;
    } catch (error) {
      this.events.announce(t('Not deleted: {reason}', { reason: reason(error) }), true);
      return false;
    }
  }
}
