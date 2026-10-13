// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KernelClient, type Secret, type SecretDraft } from '../src/api.js';
import { setLanguage } from '../src/i18n.js';
import {
  SECRET_KINDS,
  SecretList,
  audience,
  checkForm,
  describeChange,
  draftOf,
  emptyForm,
  formFor,
  installationSecrets,
  kindLabel,
  organizationSecrets,
} from '../src/secrets.js';

const VALUE = 'sk-acme-0123456789-abcdefghij';

const PROVIDER: Secret = {
  name: 'model-provider',
  kind: 'token',
  description: 'The model provider',
  extension: 'org.example.reports',
  hint: '••••ghij',
  createdAt: '2026-10-13T08:00:00Z',
  updatedAt: '2026-10-13T09:30:00Z',
  updatedBy: 'boss@example.org',
};
const DATABASE: Secret = {
  ...PROVIDER,
  name: 'database',
  kind: 'password',
  extension: null,
  hint: '••••',
};

function events() {
  return { changed: vi.fn(), announce: vi.fn<(message: string, failed: boolean) => void>() };
}

function client(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    secrets: vi.fn(() => Promise.resolve([PROVIDER])),
    storeSecret: vi.fn((_slug: string, draft: SecretDraft) =>
      Promise.resolve({ ...DATABASE, name: draft.name ?? '', kind: draft.kind }),
    ),
    replaceSecret: vi.fn((_slug: string, name: string, draft: SecretDraft) =>
      Promise.resolve({ ...PROVIDER, name, kind: draft.kind }),
    ),
    deleteSecret: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

describe('the credentials of the organization (MK-062)', () => {
  afterEach(() => {
    setLanguage('en');
  });

  it('names the kinds, who may use a credential and when it changed', () => {
    expect(SECRET_KINDS.map(kindLabel)).toEqual(['Token', 'Key', 'Password', 'Other']);
    expect(audience(PROVIDER)).toBe('org.example.reports');
    expect(audience(DATABASE)).toBe('Any extension');
    expect(describeChange(PROVIDER)).toMatch(/ by boss@example\.org$/);
    setLanguage('it');
    expect(kindLabel('key')).toBe('Chiave');
    expect(audience(DATABASE)).toBe('Qualsiasi estensione');
  });

  it('checks the form before sending it', () => {
    const form = { ...emptyForm(), name: 'Model Provider' };
    expect(checkForm(form, false)).toEqual([
      'The name has lowercase letters, digits, dots, dashes and underscores, such as model-provider.',
      'Write the value.',
    ]);
    expect(
      checkForm(
        {
          ...form,
          name: 'model-provider',
          value: 'x'.repeat(16_385),
          description: 'd'.repeat(501),
          extension: 'not an extension',
        },
        false,
      ),
    ).toEqual([
      'The value is too long.',
      'The description is too long.',
      'The extension is its identifier, such as org.example.reports.',
    ]);
    // A replacement keeps its name and may keep its value.
    expect(checkForm(formFor(PROVIDER), true)).toEqual([]);
  });

  it('sends the value only when one is typed, and never reads it back', () => {
    const replacing = formFor(PROVIDER);
    expect(replacing.value).toBe('');
    expect(draftOf(replacing, true)).toEqual({
      kind: 'token',
      description: 'The model provider',
      extension: 'org.example.reports',
    });
    expect(
      draftOf(
        { name: ' database ', kind: 'password', value: VALUE, description: '', extension: ' ' },
        false,
      ),
    ).toEqual({
      name: 'database',
      kind: 'password',
      value: VALUE,
      description: '',
      extension: null,
    });
  });

  it('reads, stores, replaces and deletes credentials, forgetting the value', async () => {
    const kernel = client();
    const told = events();
    const list = new SecretList(organizationSecrets(kernel, 'acme'), told);

    await list.load();
    expect(kernel.secrets).toHaveBeenCalledWith('acme');
    expect(list.secrets).toEqual([PROVIDER]);

    const form = {
      name: 'database',
      kind: 'password' as const,
      value: VALUE,
      description: '',
      extension: '',
    };
    expect(await list.save(form, false)).toBe(true);
    expect(form.value).toBe('');
    expect(kernel.storeSecret).toHaveBeenCalledWith('acme', {
      name: 'database',
      kind: 'password',
      value: VALUE,
      description: '',
      extension: null,
    });
    expect(list.secrets?.map((secret) => secret.name)).toEqual(['database', 'model-provider']);
    expect(told.announce).toHaveBeenLastCalledWith('Credential database stored.', false);

    expect(await list.save({ ...formFor(PROVIDER), kind: 'key' }, true)).toBe(true);
    expect(kernel.replaceSecret).toHaveBeenCalledWith('acme', 'model-provider', {
      kind: 'key',
      description: 'The model provider',
      extension: 'org.example.reports',
    });
    expect(told.announce).toHaveBeenLastCalledWith('Credential model-provider replaced.', false);

    await list.remove(PROVIDER);
    expect(kernel.deleteSecret).toHaveBeenCalledWith('acme', 'model-provider');
    expect(list.secrets?.map((secret) => secret.name)).toEqual(['database']);
    expect(told.announce).toHaveBeenLastCalledWith('Credential model-provider deleted.', false);
    expect(told.announce.mock.calls.flat().join(' ')).not.toContain(VALUE);
  });

  it('tells what went wrong, without the value', async () => {
    const kernel = client({
      secrets: vi
        .fn<() => Promise<Secret[]>>()
        .mockRejectedValueOnce(new Error('The store of credentials is disabled'))
        .mockResolvedValue([PROVIDER]),
      storeSecret: vi.fn(() =>
        Promise.reject(new Error('A credential named database already exists')),
      ),
      deleteSecret: vi.fn(() => Promise.reject(new Error('No credential named model-provider'))),
    });
    const told = events();
    const list = new SecretList(organizationSecrets(kernel, 'acme'), told);

    await list.load();
    expect(told.announce).toHaveBeenLastCalledWith(
      'The credentials cannot be read: The store of credentials is disabled',
      true,
    );
    expect(list.secrets).toBeUndefined();

    const invalid = { ...emptyForm(), value: VALUE };
    expect(await list.save(invalid, false)).toBe(false);
    expect(kernel.storeSecret).not.toHaveBeenCalled();

    const form = { ...emptyForm(), name: 'database', value: VALUE };
    expect(await list.save(form, false)).toBe(false);
    expect(form.value).toBe('');
    expect(told.announce).toHaveBeenLastCalledWith(
      'Not saved: A credential named database already exists',
      true,
    );

    await list.remove(PROVIDER);
    expect(told.announce).toHaveBeenCalledWith(
      'The credential was not deleted: No credential named model-provider',
      true,
    );
    expect(list.secrets).toEqual([PROVIDER]);
    expect(told.announce.mock.calls.flat().join(' ')).not.toContain(VALUE);
  });

  it('does nothing without a client or an organization', async () => {
    const told = events();
    const list = new SecretList(organizationSecrets(undefined, undefined), told);
    await list.load();
    expect(await list.save({ ...emptyForm(), name: 'a', value: VALUE }, false)).toBe(false);
    await list.remove(PROVIDER);
    expect(told.changed).not.toHaveBeenCalled();
    expect(told.announce).not.toHaveBeenCalled();
  });

  it('calls the endpoints of the credentials of the organization', async () => {
    const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(
        new Response(JSON.stringify(PROVIDER), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    const kernel = new KernelClient(fetchMock, undefined);

    await kernel.secrets('acme');
    await kernel.storeSecret('acme', { name: 'database', kind: 'password', value: VALUE });
    await kernel.replaceSecret('acme', 'model provider', { kind: 'token' });
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await kernel.deleteSecret('acme', 'database');

    const calls = fetchMock.mock.calls.map(([path, init]) => `${init?.method ?? ''} ${path}`);
    expect(calls).toEqual([
      'GET /api/v1/organizations/acme/secrets',
      'POST /api/v1/organizations/acme/secrets',
      'PUT /api/v1/organizations/acme/secrets/model%20provider',
      'DELETE /api/v1/organizations/acme/secrets/database',
    ]);
    expect(JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string)).toEqual({
      name: 'database',
      kind: 'password',
      value: VALUE,
    });
  });
});

describe('the credentials of the installation (MK-127)', () => {
  function platform() {
    return {
      installationSecrets: vi.fn(() => Promise.resolve([PROVIDER])),
      storeInstallationSecret: vi.fn((draft: SecretDraft) =>
        Promise.resolve({ ...DATABASE, name: draft.name ?? '', kind: draft.kind }),
      ),
      replaceInstallationSecret: vi.fn((name: string, draft: SecretDraft) =>
        Promise.resolve({ ...PROVIDER, name, kind: draft.kind }),
      ),
      deleteInstallationSecret: vi.fn(() => Promise.resolve()),
    };
  }

  it('reads, stores, replaces and deletes them through the store of the installation', async () => {
    const kernel = platform();
    const told = events();
    const list = new SecretList(installationSecrets(kernel), told);

    await list.load();
    expect(kernel.installationSecrets).toHaveBeenCalledWith();
    expect(list.secrets).toEqual([PROVIDER]);

    const form = { ...emptyForm(), name: 'mail-relay', kind: 'password' as const, value: VALUE };
    expect(await list.save(form, false)).toBe(true);
    expect(form.value).toBe('');
    expect(kernel.storeInstallationSecret).toHaveBeenCalledWith({
      name: 'mail-relay',
      kind: 'password',
      value: VALUE,
      description: '',
      extension: null,
    });

    expect(await list.save({ ...formFor(PROVIDER), kind: 'key' }, true)).toBe(true);
    expect(kernel.replaceInstallationSecret).toHaveBeenCalledWith('model-provider', {
      kind: 'key',
      description: 'The model provider',
      extension: 'org.example.reports',
    });

    await list.remove(PROVIDER);
    expect(kernel.deleteInstallationSecret).toHaveBeenCalledWith('model-provider');
    expect(list.secrets?.map((secret) => secret.name)).toEqual(['mail-relay']);
    expect(told.announce.mock.calls.flat().join(' ')).not.toContain(VALUE);
  });

  it('has no store without a client', () => {
    expect(installationSecrets(undefined)).toBeUndefined();
  });

  it('calls the endpoints of the platform', async () => {
    const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(
        new Response(JSON.stringify(PROVIDER), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    const kernel = new KernelClient(fetchMock, undefined);

    await kernel.installationSecrets();
    await kernel.storeInstallationSecret({ name: 'mail-relay', kind: 'password', value: VALUE });
    await kernel.replaceInstallationSecret('mail relay', { kind: 'token' });
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await kernel.deleteInstallationSecret('mail-relay');

    const calls = fetchMock.mock.calls.map(([path, init]) => `${init?.method ?? ''} ${path}`);
    expect(calls).toEqual([
      'GET /api/v1/platform/credentials',
      'POST /api/v1/platform/credentials',
      'PUT /api/v1/platform/credentials/mail%20relay',
      'DELETE /api/v1/platform/credentials/mail-relay',
    ]);
  });
});
