// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import type { KernelClient, OrganizationSummary, SignInMethod } from './api.js';
import { type Metric, count, matchesText } from './admin-view.js';
import { t } from './i18n.js';

/** The longest reason for a suspension that the kernel accepts. */
export const MAX_SUSPENSION_REASON = 500;

/** Which organizations the page lists, by whether their members may sign in. */
export type OrganizationState = 'all' | 'active' | 'suspended';

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

/** How the members of an organization sign in, as the pages say it. */
export function signInLabel(method: SignInMethod | undefined): string {
  switch (method) {
    case 'realm':
      return t('Through its identity provider');
    case 'password-or-realm':
      return t('Password or identity provider');
    default:
      return t('Password');
  }
}

/** The organizations whose name, slug or email domains contain a text, in a state (MK-072). */
export function filterOrganizations(
  organizations: readonly OrganizationSummary[],
  search: string,
  state: OrganizationState,
): OrganizationSummary[] {
  return organizations.filter(
    (organization) =>
      (state === 'all' || (state === 'suspended') === Boolean(organization.suspended)) &&
      matchesText(search, organization.name, organization.slug, ...organization.emailDomains),
  );
}

/** The metrics on top of the page of organizations (MK-072). */
export function organizationMetrics(organizations: readonly OrganizationSummary[]): Metric[] {
  const suspended = organizations.filter((organization) => organization.suspended).length;
  const realm = organizations.filter((organization) => organization.identityRealm).length;
  return [
    { label: t('Organizations'), value: count(organizations.length) },
    {
      label: t('Active'),
      value: count(organizations.length - suspended),
      tone: 'ok',
    },
    {
      label: t('Suspended'),
      value: count(suspended),
      note: t('Their members cannot sign in to them.'),
      ...(suspended > 0 ? { tone: 'warn' as const } : {}),
    },
    {
      label: t('With an identity provider'),
      value: count(realm),
      note: t('The others sign in with a password.'),
    },
  ];
}

/**
 * The organizations of the installation for platform administrators, without the view: reads them,
 * suspends and reactivates one (MK-072) and deletes one once its slug is written again (MK-130), and
 * says what happened.
 */
export class OrganizationList {
  organizations: readonly OrganizationSummary[] | undefined;

  constructor(
    private readonly client:
      | Pick<
          KernelClient,
          'organizations' | 'deleteOrganization' | 'suspendOrganization' | 'reactivateOrganization'
        >
      | undefined,
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

  /** Suspends an organization with a reason; answers whether it was suspended (MK-072). */
  async suspend(organization: OrganizationSummary, why: string): Promise<boolean> {
    if (!this.client) {
      return false;
    }
    const text = why.trim();
    if (!text) {
      this.events.announce(t('Write the reason for the suspension.'), true);
      return false;
    }
    if (text.length > MAX_SUSPENSION_REASON) {
      this.events.announce(
        t('The reason is longer than {max} characters.', { max: String(MAX_SUSPENSION_REASON) }),
        true,
      );
      return false;
    }
    try {
      const suspended = await this.client.suspendOrganization(organization.slug, text);
      this.replace(suspended);
      this.events.announce(
        t(
          '{name} is suspended: its members cannot sign in to it, and their sessions in it ended.',
          {
            name: suspended.name,
          },
        ),
        false,
      );
      return true;
    } catch (error) {
      this.events.announce(
        t('The organization cannot be suspended: {reason}', { reason: reason(error) }),
        true,
      );
      return false;
    } finally {
      this.events.changed();
    }
  }

  /** Lets the members of a suspended organization sign in again; answers whether it was reactivated. */
  async reactivate(organization: OrganizationSummary): Promise<boolean> {
    if (!this.client) {
      return false;
    }
    try {
      const reactivated = await this.client.reactivateOrganization(organization.slug);
      this.replace(reactivated);
      this.events.announce(
        t('{name} is active again: its members sign in.', { name: reactivated.name }),
        false,
      );
      return true;
    } catch (error) {
      this.events.announce(
        t('The organization cannot be reactivated: {reason}', { reason: reason(error) }),
        true,
      );
      return false;
    } finally {
      this.events.changed();
    }
  }

  /** Adds an organization just created, in the order of names. */
  added(organization: OrganizationSummary): void {
    this.organizations = [...(this.organizations ?? []), organization].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    this.events.changed();
  }

  private replace(changed: OrganizationSummary): void {
    this.organizations = (this.organizations ?? []).map((organization) =>
      organization.slug === changed.slug ? changed : organization,
    );
  }
}
