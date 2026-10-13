// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import type { AccessKey, KernelClient } from './api.js';
import { t } from './i18n.js';
import { when } from './sessions.js';

/** The expiries offered when a key is created, in days; the longest of the installation is added. */
export const EXPIRIES: readonly number[] = [7, 30, 90];

const DAY = 24 * 60 * 60 * 1000;

/** The expiries a person can choose, in days: those shorter than the maximum, then the maximum. */
export function expiryChoices(maxDays: number): number[] {
  return [...EXPIRIES.filter((days) => days < maxDays), maxDays];
}

/** The moment a key created now for some days expires, as the kernel reads it. */
export function expiryAfter(days: number, now: Date = new Date()): string {
  return new Date(now.getTime() + days * DAY).toISOString();
}

/** What a key may do. */
export function describeAccess(key: Pick<AccessKey, 'write'>): string {
  return key.write ? t('Reads and writes') : t('Read only');
}

/** The second line of a key: its prefix, when it was created and last used, and its expiry. */
export function describeKey(key: AccessKey): string {
  const used = key.lastUsedAt ? when(key.lastUsedAt) : t('never');
  const expiry = key.expired
    ? t('expired {date}', { date: when(key.expiresAt) })
    : t('expires {date}', { date: when(key.expiresAt) });
  return t('{prefix}… · created {created} · last used {used} · {expiry}', {
    prefix: key.prefix,
    created: when(key.createdAt),
    used,
    expiry,
  });
}

/** A key as the list shows it: the secret stays only in the panel of the key just created. */
function withoutSecret(key: AccessKey): AccessKey {
  return Object.fromEntries(
    Object.entries(key).filter(([name]) => name !== 'secret'),
  ) as unknown as AccessKey;
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** What the list of keys tells the page around it. */
export interface AccessKeyListEvents {
  /** The list changed: render it again. */
  changed(): void;
  /** A message for the status region of the page. */
  announce(message: string): void;
}

/** What a person fills in to create a key. */
export interface AccessKeyForm {
  readonly name: string;
  readonly organization: string;
  /** Days until the key expires. */
  readonly days: number;
  readonly write: boolean;
}

/**
 * The access keys of the signed-in person in their settings (MK-060), without the view: reads them,
 * creates one and keeps its secret until the person has copied it, revokes one, and says what
 * happened.
 */
export class AccessKeyList {
  keys: readonly AccessKey[] | undefined;
  maxValidityDays = 365;
  /** The key just created, with its secret, until the person dismisses it. */
  created: AccessKey | undefined;
  busy = false;

  constructor(
    private readonly client:
      Pick<KernelClient, 'accessKeys' | 'createAccessKey' | 'revokeAccessKey'> | undefined,
    private readonly events: AccessKeyListEvents,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async load(): Promise<void> {
    try {
      const found = await this.client?.accessKeys();
      if (found) {
        this.keys = found.keys;
        this.maxValidityDays = found.maxValidityDays;
      }
    } catch (error) {
      this.events.announce(
        t('The access keys cannot be read: {reason}', { reason: reason(error) }),
      );
    }
    this.events.changed();
  }

  /** Creates a key; true when it was created, its secret then in {@link created}. */
  async create(form: AccessKeyForm): Promise<boolean> {
    const name = form.name.trim();
    if (!name) {
      this.events.announce(t('Name the key, so that you recognize it later.'));
      return false;
    }
    this.busy = true;
    this.events.changed();
    try {
      const days = Math.min(form.days, this.maxValidityDays);
      const key = await this.client?.createAccessKey({
        name,
        organization: form.organization,
        write: form.write,
        // The longest is left to the kernel, so that it is never past its maximum by a few seconds.
        ...(days < this.maxValidityDays ? { expiresAt: expiryAfter(days, this.now()) } : {}),
      });
      if (!key) {
        return false;
      }
      this.created = key;
      this.keys = [withoutSecret(key), ...(this.keys ?? [])];
      this.events.announce(
        t('Key created: {name}. Copy it now, it will not be shown again.', { name }),
      );
      return true;
    } catch (error) {
      this.events.announce(t('The key was not created: {reason}', { reason: reason(error) }));
      return false;
    } finally {
      this.busy = false;
      this.events.changed();
    }
  }

  /** Copies the secret of the key just created. */
  async copy(clipboard: Pick<Clipboard, 'writeText'> | undefined): Promise<void> {
    const secret = this.created?.secret;
    if (!secret) {
      return;
    }
    try {
      if (!clipboard) {
        throw new Error(t('no clipboard'));
      }
      await clipboard.writeText(secret);
      this.events.announce(t('Key copied.'));
    } catch (error) {
      this.events.announce(
        t('The key was not copied: {reason}. Select it and copy it.', { reason: reason(error) }),
      );
    }
  }

  /** Forgets the secret of the key just created: it is never shown again. */
  dismiss(): void {
    this.created = undefined;
    this.events.changed();
  }

  /** Revokes a key: the next request with it is refused. */
  async revoke(key: AccessKey): Promise<void> {
    try {
      await this.client?.revokeAccessKey(key.id);
    } catch (error) {
      this.events.announce(t('The key was not revoked: {reason}', { reason: reason(error) }));
      await this.load();
      return;
    }
    this.keys = this.keys?.filter((other) => other.id !== key.id);
    if (this.created?.id === key.id) {
      this.created = undefined;
    }
    this.events.announce(t('Key revoked: {name}', { name: key.name }));
    this.events.changed();
  }
}
