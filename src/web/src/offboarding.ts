// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { toError, type OrganizationMember } from './api.js';
import { t } from './i18n.js';

/**
 * Offboarding a member (MK-071): the resources they own, per extension, and their removal with the
 * transfer of those resources to another member. Without the view, so that it can be tested.
 */

/** A resource a member owns. */
export interface OwnedResource {
  readonly type: string;
  readonly typeTitle: string;
  readonly id: string;
  readonly title: string;
  readonly link: string;
  readonly trashed: boolean;
}

/** The resources of one extension that a member owns. */
export interface OwnedByExtension {
  readonly extension: string;
  readonly extensionName: string;
  readonly resources: readonly OwnedResource[];
}

type Request = (path: string, init?: RequestInit) => Promise<Response>;

function memberPath(slug: string, email: string): string {
  return `/api/v1/organizations/${encodeURIComponent(slug)}/members/${encodeURIComponent(email)}`;
}

/** The REST API of offboarding, with the credentials of the shell. */
export class OffboardingApi {
  constructor(private readonly request: Request) {}

  async owned(slug: string, email: string): Promise<OwnedByExtension[]> {
    const response = await this.request(`${memberPath(slug, email)}/resources`);
    if (!response.ok) {
      throw await toError(response);
    }
    return (await response.json()) as OwnedByExtension[];
  }

  /** Removes a member; `transferTo` takes over what they own. */
  async remove(slug: string, email: string, transferTo?: string): Promise<void> {
    const query = transferTo ? `?transferTo=${encodeURIComponent(transferTo)}` : '';
    const response = await this.request(`${memberPath(slug, email)}${query}`, { method: 'DELETE' });
    if (!response.ok) {
      throw await toError(response);
    }
  }
}

/** How many resources a member owns. */
export function ownedCount(owned: readonly OwnedByExtension[]): number {
  return owned.reduce((count, group) => count + group.resources.length, 0);
}

/** Whether a member is only a guest of the organization. */
function guest(member: OrganizationMember): boolean {
  return (
    member.roles.includes('organization-guest') &&
    !member.roles.includes('organization-user') &&
    !member.roles.includes('organization-admin')
  );
}

/** The members who may take over the resources of the one who leaves: the others, not guests. */
export function heirs(
  members: readonly OrganizationMember[],
  leaving: string,
): readonly OrganizationMember[] {
  return members.filter((member) => member.username !== leaving && !guest(member));
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** What offboarding tells the page around it. */
export interface OffboardingEvents {
  changed(): void;
  announce(message: string, failed: boolean): void;
}

/**
 * The removal of one member, without the view: reads what they own, then removes them, giving it to
 * the member chosen.
 */
export class Offboarding {
  owned: readonly OwnedByExtension[] | undefined;
  /** The member chosen to take over the resources. */
  heir = '';

  constructor(
    private readonly api: Pick<OffboardingApi, 'owned' | 'remove'>,
    private readonly organization: string,
    readonly email: string,
    private readonly events: OffboardingEvents,
  ) {}

  /** Reads what the member owns; answers whether it could. */
  async load(): Promise<boolean> {
    try {
      this.owned = await this.api.owned(this.organization, this.email);
      this.events.changed();
      return true;
    } catch (error) {
      this.events.announce(
        t('What {email} owns cannot be read: {reason}', {
          email: this.email,
          reason: reason(error),
        }),
        true,
      );
      return false;
    }
  }

  /** Whether the removal may go on: what they own is read, and someone takes it over when needed. */
  get ready(): boolean {
    return this.owned !== undefined && (ownedCount(this.owned) === 0 || this.heir !== '');
  }

  /** Removes the member; answers whether they were removed. */
  async remove(): Promise<boolean> {
    if (!this.ready) {
      this.events.announce(t('Choose who takes over what they own.'), true);
      return false;
    }
    const count = ownedCount(this.owned ?? []);
    try {
      await this.api.remove(this.organization, this.email, count > 0 ? this.heir : undefined);
      this.events.announce(
        count > 0
          ? t('{email} was removed; {heir} owns their {count} resources.', {
              email: this.email,
              heir: this.heir,
              count: String(count),
            })
          : t('{email} was removed.', { email: this.email }),
        false,
      );
      return true;
    } catch (error) {
      this.events.announce(t('Not removed: {reason}', { reason: reason(error) }), true);
      return false;
    }
  }
}
