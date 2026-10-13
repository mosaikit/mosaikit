// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import type { KernelClient, ServiceGrants, ServiceIdentity, ServiceKey } from './api.js';
import { t } from './i18n.js';
import { when } from './sessions.js';

/** The names written in a field, separated by commas, spaces or new lines, without repeats. */
export function names(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[\s,]+/)
        .map((name) => name.trim())
        .filter((name) => name.length > 0),
    ),
  ];
}

/** The second line of a key: its prefix, when it was created and last used. */
export function describeServiceKey(key: ServiceKey): string {
  return t('{prefix}… · created {created} · last used {used}', {
    prefix: key.prefix,
    created: when(key.createdAt),
    used: key.lastUsedAt ? when(key.lastUsedAt) : t('never'),
  });
}

/** What an identity may call, in one line. */
export function describeGrants(identity: ServiceGrants): string {
  const parts = [
    identity.apis.length > 0
      ? t('APIs: {apis}', { apis: identity.apis.join(', ') })
      : t('No API of extensions'),
  ];
  if (identity.endpoints.length > 0) {
    parts.push(t('Kernel: {endpoints}', { endpoints: identity.endpoints.join(', ') }));
  }
  if (identity.organizations.length > 0) {
    parts.push(
      t('Organizations: {organizations}', {
        organizations: identity.organizations.join(', '),
      }),
    );
  }
  return parts.join(' · ');
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** What the list of identities tells the page around it. */
export interface ServiceIdentityEvents {
  /** The list changed: render it again. */
  changed(): void;
  /** A message for the status region of the page. */
  announce(message: string): void;
}

/** What a platform administrator fills in to create an identity or change what it may call. */
export interface ServiceIdentityForm {
  readonly name: string;
  readonly description: string;
  /** The names of the APIs, as written. */
  readonly apis: string;
  readonly endpoints: readonly string[];
  /** The slugs of the organizations, as written. */
  readonly organizations: string;
}

/** A secret just created, until the administrator has copied it. */
export interface CreatedSecret {
  readonly identity: string;
  readonly prefix: string;
  readonly secret: string;
}

type Client = Pick<
  KernelClient,
  | 'serviceIdentities'
  | 'createServiceIdentity'
  | 'grantServiceIdentity'
  | 'createServiceKey'
  | 'revokeServiceKey'
>;

/**
 * The service identities of the installation for platform administrators (MK-124), without the
 * view: reads them, creates one and keeps the secret of its key until it was copied, changes what
 * one may call, rotates and revokes keys, and says what happened.
 */
export class ServiceIdentityList {
  identities: readonly ServiceIdentity[] | undefined;
  /** The endpoints of the kernel that can be given. */
  endpoints: readonly string[] = [];
  maxKeys = 2;
  /** The secret just created, until it is dismissed. */
  created: CreatedSecret | undefined;
  busy = false;

  constructor(
    private readonly client: Client | undefined,
    private readonly events: ServiceIdentityEvents,
  ) {}

  async load(): Promise<void> {
    try {
      const found = await this.client?.serviceIdentities();
      if (found) {
        this.identities = found.identities;
        this.endpoints = found.endpoints;
        this.maxKeys = found.maxKeys;
      }
    } catch (error) {
      this.events.announce(
        t('The service identities cannot be read: {reason}', { reason: reason(error) }),
      );
    }
    this.events.changed();
  }

  /** Creates an identity; true when it was created, the secret of its key then in {@link created}. */
  async create(form: ServiceIdentityForm): Promise<boolean> {
    const name = form.name.trim();
    if (!name) {
      this.events.announce(t('Name the service identity after the service that uses it.'));
      return false;
    }
    return this.run(
      async () => {
        const identity = await this.client?.createServiceIdentity({ name, ...grants(form) });
        if (!identity) {
          return false;
        }
        const key = identity.keys[0];
        if (key?.secret) {
          this.created = { identity: identity.name, prefix: key.prefix, secret: key.secret };
        }
        this.identities = [...(this.identities ?? []), withoutSecrets(identity)].sort((a, b) =>
          a.name.localeCompare(b.name),
        );
        this.events.announce(
          t('Service identity created: {name}. Copy its key now, it will not be shown again.', {
            name,
          }),
        );
        return true;
      },
      (error) => t('The service identity was not created: {reason}', { reason: reason(error) }),
    );
  }

  /** Changes what an identity may call. */
  async grant(identity: ServiceIdentity, form: ServiceIdentityForm): Promise<boolean> {
    return this.run(
      async () => {
        const changed = await this.client?.grantServiceIdentity(identity.id, grants(form));
        if (!changed) {
          return false;
        }
        this.replace(changed);
        this.events.announce(t('Saved: {name}', { name: identity.name }));
        return true;
      },
      (error) => t('Not saved: {reason}', { reason: reason(error) }),
    );
  }

  /** Creates a new key for an identity, to rotate the old one. */
  async rotate(identity: ServiceIdentity): Promise<boolean> {
    return this.run(
      async () => {
        const key = await this.client?.createServiceKey(identity.id);
        if (!key?.secret) {
          return false;
        }
        this.created = { identity: identity.name, prefix: key.prefix, secret: key.secret };
        this.replace({ ...identity, keys: [withoutSecret(key), ...identity.keys] });
        this.events.announce(
          t('New key for {name}. Copy it now, put it in the service, then revoke the old key.', {
            name: identity.name,
          }),
        );
        return true;
      },
      (error) => t('The key was not created: {reason}', { reason: reason(error) }),
    );
  }

  /** Revokes a key of an identity: its next call is refused. */
  async revoke(identity: ServiceIdentity, key: ServiceKey): Promise<void> {
    try {
      await this.client?.revokeServiceKey(identity.id, key.id);
    } catch (error) {
      this.events.announce(t('The key was not revoked: {reason}', { reason: reason(error) }));
      await this.load();
      return;
    }
    this.replace({ ...identity, keys: identity.keys.filter((other) => other.id !== key.id) });
    if (this.created?.prefix === key.prefix) {
      this.created = undefined;
    }
    this.events.announce(t('Key revoked: {name}', { name: `${identity.name} (${key.prefix}…)` }));
    this.events.changed();
  }

  /** Whether an identity may get one more key. */
  canRotate(identity: ServiceIdentity): boolean {
    return identity.keys.length < this.maxKeys;
  }

  /** Copies the secret just created. */
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

  /** Forgets the secret just created: it is never shown again. */
  dismiss(): void {
    this.created = undefined;
    this.events.changed();
  }

  private replace(identity: ServiceIdentity): void {
    this.identities = this.identities?.map((other) =>
      other.id === identity.id ? withoutSecrets(identity) : other,
    );
  }

  private async run(
    action: () => Promise<boolean>,
    failure: (error: unknown) => string,
  ): Promise<boolean> {
    this.busy = true;
    this.events.changed();
    try {
      return await action();
    } catch (error) {
      this.events.announce(failure(error));
      return false;
    } finally {
      this.busy = false;
      this.events.changed();
    }
  }
}

function grants(form: ServiceIdentityForm): ServiceGrants {
  return {
    description: form.description.trim(),
    apis: names(form.apis),
    endpoints: [...form.endpoints],
    organizations: names(form.organizations),
  };
}

/** A key as the list shows it: the secret stays only in the panel of the key just created. */
function withoutSecret(key: ServiceKey): ServiceKey {
  return { id: key.id, prefix: key.prefix, createdAt: key.createdAt, lastUsedAt: key.lastUsedAt };
}

function withoutSecrets(identity: ServiceIdentity): ServiceIdentity {
  return { ...identity, keys: identity.keys.map(withoutSecret) };
}
