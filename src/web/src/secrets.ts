// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import type { KernelClient, Secret, SecretDraft, SecretKind } from './api.js';
import { t } from './i18n.js';
import { when } from './sessions.js';

/** The kinds of credential, in the order of the form. */
export const SECRET_KINDS: readonly SecretKind[] = ['token', 'key', 'password', 'other'];

/** What the kernel accepts as the name of a credential. */
export const SECRET_NAME = /^[a-z0-9][a-z0-9._-]{0,99}$/;

/** What the kernel accepts as the identifier of an extension. */
const EXTENSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/;

const MAX_VALUE = 16_384;
const MAX_DESCRIPTION = 500;

/** The name of a kind in the language of the shell. */
export function kindLabel(kind: SecretKind): string {
  switch (kind) {
    case 'password':
      return t('Password');
    case 'token':
      return t('Token');
    case 'key':
      return t('Key');
    default:
      return t('Other');
  }
}

/** Who may use a credential: its extension, or any. */
export function audience(secret: Pick<Secret, 'extension'>): string {
  return secret.extension ?? t('Any extension');
}

/** When and by whom a credential was last changed. */
export function describeChange(secret: Pick<Secret, 'updatedAt' | 'updatedBy'>): string {
  return t('{when} by {person}', { when: when(secret.updatedAt), person: secret.updatedBy });
}

/** What the form of a credential holds while people type. */
export interface SecretForm {
  name: string;
  kind: SecretKind;
  value: string;
  description: string;
  extension: string;
}

export function emptyForm(): SecretForm {
  return { name: '', kind: 'token', value: '', description: '', extension: '' };
}

/** The form to replace a credential: everything but the value, which is never read back. */
export function formFor(secret: Secret): SecretForm {
  return {
    name: secret.name,
    kind: secret.kind,
    value: '',
    description: secret.description,
    extension: secret.extension ?? '',
  };
}

/** What is wrong with a form, in the language of the shell; empty when it can be sent. */
export function checkForm(form: SecretForm, replacing: boolean): string[] {
  const problems: string[] = [];
  if (!replacing && !SECRET_NAME.test(form.name.trim())) {
    problems.push(
      t(
        'The name has lowercase letters, digits, dots, dashes and underscores, such as model-provider.',
      ),
    );
  }
  if (!replacing && form.value.length === 0) {
    problems.push(t('Write the value.'));
  }
  if (form.value.length > MAX_VALUE) {
    problems.push(t('The value is too long.'));
  }
  if (form.description.trim().length > MAX_DESCRIPTION) {
    problems.push(t('The description is too long.'));
  }
  const extension = form.extension.trim();
  if (extension && !EXTENSION.test(extension)) {
    problems.push(t('The extension is its identifier, such as org.example.reports.'));
  }
  return problems;
}

/** The request for the kernel; a replacement without a value keeps the value. */
export function draftOf(form: SecretForm, replacing: boolean): SecretDraft {
  const extension = form.extension.trim();
  return {
    ...(replacing ? {} : { name: form.name.trim() }),
    kind: form.kind,
    ...(form.value ? { value: form.value } : {}),
    description: form.description.trim(),
    extension: extension || null,
  };
}

/** What the list of credentials tells the page around it. */
export interface SecretListEvents {
  /** The list changed: render it again. */
  changed(): void;
  /** A message for the status region of the page, and whether something failed. */
  announce(message: string, failed: boolean): void;
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Where credentials are kept: an organization (MK-062) or the installation (MK-127). */
export interface SecretStore {
  list(): Promise<Secret[]>;
  store(draft: SecretDraft): Promise<Secret>;
  replace(name: string, draft: SecretDraft): Promise<Secret>;
  remove(name: string): Promise<void>;
}

/** The credentials of an organization, for its administrators; none without a client or organization. */
export function organizationSecrets(
  client:
    Pick<KernelClient, 'secrets' | 'storeSecret' | 'replaceSecret' | 'deleteSecret'> | undefined,
  organization: string | undefined,
): SecretStore | undefined {
  if (!client || !organization) {
    return undefined;
  }
  return {
    list: () => client.secrets(organization),
    store: (draft) => client.storeSecret(organization, draft),
    replace: (name, draft) => client.replaceSecret(organization, name, draft),
    remove: (name) => client.deleteSecret(organization, name),
  };
}

/** The credentials of the installation, for platform administrators (MK-127). */
export function installationSecrets(
  client:
    | Pick<
        KernelClient,
        | 'installationSecrets'
        | 'storeInstallationSecret'
        | 'replaceInstallationSecret'
        | 'deleteInstallationSecret'
      >
    | undefined,
): SecretStore | undefined {
  if (!client) {
    return undefined;
  }
  return {
    list: () => client.installationSecrets(),
    store: (draft) => client.storeInstallationSecret(draft),
    replace: (name, draft) => client.replaceInstallationSecret(name, draft),
    remove: (name) => client.deleteInstallationSecret(name),
  };
}

/**
 * The credentials of an organization for its administrators (MK-062), or of the installation for
 * platform administrators (MK-127), without the view: reads them, stores, replaces and deletes one,
 * and says what happened. Values only go to the kernel; nothing here keeps one after it is sent.
 */
export class SecretList {
  secrets: readonly Secret[] | undefined;

  constructor(
    private readonly store: SecretStore | undefined,
    private readonly events: SecretListEvents,
  ) {}

  async load(): Promise<void> {
    if (!this.store) {
      return;
    }
    try {
      this.secrets = await this.store.list();
    } catch (error) {
      this.events.announce(
        t('The credentials cannot be read: {reason}', { reason: reason(error) }),
        true,
      );
    }
    this.events.changed();
  }

  /**
   * Stores a new credential, or replaces the one being edited; the value of the form is emptied
   * whatever happens. Answers whether it was saved.
   */
  async save(form: SecretForm, replacing: boolean): Promise<boolean> {
    if (!this.store) {
      return false;
    }
    const problems = checkForm(form, replacing);
    if (problems.length > 0) {
      this.events.announce(problems.join(' '), true);
      return false;
    }
    const draft = draftOf(form, replacing);
    form.value = '';
    try {
      const saved = replacing
        ? await this.store.replace(form.name, draft)
        : await this.store.store(draft);
      const others = (this.secrets ?? []).filter((secret) => secret.name !== saved.name);
      this.secrets = [...others, saved].sort((a, b) => a.name.localeCompare(b.name));
      this.events.announce(
        replacing
          ? t('Credential {name} replaced.', { name: saved.name })
          : t('Credential {name} stored.', { name: saved.name }),
        false,
      );
      this.events.changed();
      return true;
    } catch (error) {
      this.events.announce(t('Not saved: {reason}', { reason: reason(error) }), true);
      return false;
    }
  }

  async remove(secret: Secret): Promise<void> {
    if (!this.store) {
      return;
    }
    try {
      await this.store.remove(secret.name);
    } catch (error) {
      this.events.announce(
        t('The credential was not deleted: {reason}', { reason: reason(error) }),
        true,
      );
      await this.load();
      return;
    }
    this.secrets = this.secrets?.filter((other) => other.name !== secret.name);
    this.events.announce(t('Credential {name} deleted.', { name: secret.name }), false);
    this.events.changed();
  }
}
