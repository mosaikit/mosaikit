// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { type AccountStatus, type KernelClient, KernelError } from './api.js';
import { t } from './i18n.js';

/** The longest reason the kernel accepts. */
export const MAX_REASON = 500;

/** Who an account is, for the texts of the page: the name and the email address. */
export function accountName(account: AccountStatus): string {
  return account.displayName && account.displayName !== account.username
    ? `${account.displayName} (${account.username})`
    : account.username;
}

/** Whether an account signs in, or when, by whom and why it was suspended. */
export function describeStatus(account: AccountStatus, when: (iso: string) => string): string {
  if (!account.suspended) {
    return t('Active: the person signs in.');
  }
  const since = t('Suspended {when} by {person}.', {
    when: account.suspendedAt ? when(account.suspendedAt) : '',
    person: account.suspendedBy ?? '',
  });
  return account.reason
    ? `${since} ${t('Reason: {reason}', { reason: account.reason })}`
    : `${since} ${t('No reason was given.')}`;
}

/** What the suspensions tell the page around them. */
export interface SuspensionEvents {
  changed(): void;
  announce(message: string, failed: boolean): void;
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The suspension of accounts for platform administrators (MK-125), without the view: lists the
 * suspended accounts, finds an account by its email address, suspends it with a reason and reinstates
 * it, and says what happened.
 */
export class AccountSuspensions {
  suspended: AccountStatus[] = [];
  /** The account found by its email address. */
  found: AccountStatus | undefined;

  constructor(
    private readonly client:
      | Pick<
          KernelClient,
          'suspendedAccounts' | 'accountStatus' | 'suspendAccount' | 'reinstateAccount'
        >
      | undefined,
    private readonly events: SuspensionEvents,
  ) {}

  async load(): Promise<void> {
    if (!this.client) {
      return;
    }
    try {
      this.suspended = await this.client.suspendedAccounts();
    } catch (error) {
      this.events.announce(
        t('The suspended accounts cannot be read: {reason}', { reason: reason(error) }),
        true,
      );
    }
    this.events.changed();
  }

  /** Finds an account by its email address; answers whether it was found. */
  async find(email: string): Promise<boolean> {
    if (!this.client) {
      return false;
    }
    const address = email.trim();
    if (!address) {
      this.events.announce(t('Write the email address of the account.'), true);
      return false;
    }
    try {
      this.found = await this.client.accountStatus(address);
      this.events.announce('', false);
      return true;
    } catch (error) {
      this.found = undefined;
      this.events.announce(
        error instanceof KernelError && error.status === 404
          ? t('No account has the email address {address}.', { address })
          : t('The account cannot be read: {reason}', { reason: reason(error) }),
        true,
      );
      return false;
    } finally {
      this.events.changed();
    }
  }

  /** Suspends an account with a reason; answers whether it was suspended. */
  async suspend(account: AccountStatus, why: string): Promise<boolean> {
    if (!this.client) {
      return false;
    }
    const text = why.trim();
    if (!text) {
      this.events.announce(t('Write the reason for the suspension.'), true);
      return false;
    }
    if (text.length > MAX_REASON) {
      this.events.announce(
        t('The reason is longer than {max} characters.', { max: String(MAX_REASON) }),
        true,
      );
      return false;
    }
    try {
      const status = await this.client.suspendAccount(account.username, text);
      this.update(status);
      this.events.announce(
        t('{name} is suspended: their sessions ended.', { name: accountName(status) }),
        false,
      );
      return true;
    } catch (error) {
      this.events.announce(
        t('The account cannot be suspended: {reason}', { reason: reason(error) }),
        true,
      );
      return false;
    } finally {
      this.events.changed();
    }
  }

  /** Lets a suspended account sign in again; answers whether it was reinstated. */
  async reinstate(account: AccountStatus): Promise<boolean> {
    if (!this.client) {
      return false;
    }
    try {
      const status = await this.client.reinstateAccount(account.username);
      this.update(status);
      this.events.announce(
        t('{name} is reinstated and can sign in again.', { name: accountName(status) }),
        false,
      );
      return true;
    } catch (error) {
      this.events.announce(
        t('The account cannot be reinstated: {reason}', { reason: reason(error) }),
        true,
      );
      return false;
    } finally {
      this.events.changed();
    }
  }

  private update(status: AccountStatus): void {
    if (this.found?.username === status.username) {
      this.found = status;
    }
    const others = this.suspended.filter((account) => account.username !== status.username);
    this.suspended = status.suspended ? [status, ...others] : others;
  }
}
