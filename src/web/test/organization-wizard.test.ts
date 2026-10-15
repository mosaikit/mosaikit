// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it, vi } from 'vitest';
import { KernelError, type OrganizationSummary, type PasswordLink } from '../src/api.js';
import {
  EMPTY_DRAFT,
  type OrganizationDraft,
  STEPS,
  createOrganization,
  domainsOf,
  problems,
  request,
  slugFrom,
  usesRealm,
} from '../src/organization-wizard.js';

const PASSWORD_DRAFT: OrganizationDraft = {
  ...EMPTY_DRAFT,
  name: 'Acme Europe',
  slug: 'acme-europe',
  administratorEmail: 'robin@example.org',
  administratorFirstName: 'Robin',
  administratorLastName: 'Green',
};

const REALM_DRAFT: OrganizationDraft = {
  ...PASSWORD_DRAFT,
  signIn: 'realm',
  emailDomains: 'Example.org, acme.example.org\nexample.org',
};

const ACME: OrganizationSummary = {
  id: '00000000-0000-0000-0000-000000000001',
  slug: 'acme-europe',
  name: 'Acme Europe',
  createdAt: '2026-10-15T08:00:00Z',
  identityRealm: null,
  emailDomains: [],
  signIn: 'password',
};

const LINK: PasswordLink = {
  member: {
    accountId: '00000000-0000-0000-0000-000000000009',
    username: 'robin@example.org',
    displayName: 'Robin Green',
    roles: ['organization-admin', 'organization-user'],
  },
  mailed: false,
  link: 'https://example.org/?password-link=abc',
  expiresAt: '2026-10-22T08:00:00Z',
};

function kernel(overrides: Record<string, unknown> = {}) {
  return {
    createOrganization: vi.fn(() => Promise.resolve(ACME)),
    createAccount: vi.fn(() => Promise.resolve(LINK)),
    invite: vi.fn(() => Promise.resolve(LINK.member)),
    ...overrides,
  };
}

describe('the guided creation of an organization (MK-072)', () => {
  it('goes through the organization, its sign-in, its administrator and a review', () => {
    expect(STEPS).toEqual(['organization', 'sign-in', 'administrator', 'review']);
  });

  it('makes the address name from the name', () => {
    expect(slugFrom('  Città di Prova! ')).toBe('citta-di-prova');
    expect(slugFrom('Acme -- Europe')).toBe('acme-europe');
    expect(slugFrom('x'.repeat(70) + ' y')).toHaveLength(63);
    expect(slugFrom('a'.repeat(62) + '-b')).toBe('a'.repeat(62));
  });

  it('says what is missing in each step', () => {
    expect(problems(EMPTY_DRAFT, 'organization')).toEqual([
      'Write the name of the organization.',
      'The address name has 2 to 63 lowercase letters, digits and inner hyphens, such as acme-europe.',
    ]);
    expect(problems({ ...PASSWORD_DRAFT, name: 'n'.repeat(121) }, 'organization')).toEqual([
      'The name is longer than 120 characters.',
    ]);
    expect(problems({ ...PASSWORD_DRAFT, slug: 'Acme' }, 'organization')).toHaveLength(1);
    expect(problems(PASSWORD_DRAFT, 'organization')).toEqual([]);
    // A password needs no domain.
    expect(problems(PASSWORD_DRAFT, 'sign-in')).toEqual([]);
    expect(problems({ ...REALM_DRAFT, emailDomains: ' ' }, 'sign-in')).toEqual([
      'Write at least one email domain of the organization, such as example.org.',
    ]);
    expect(
      problems({ ...REALM_DRAFT, emailDomains: 'example.org, not a domain' }, 'sign-in'),
    ).toEqual(['These are not domain names: not, a, domain']);
    const many = Array.from({ length: 21 }, (_, index) => `d${String(index)}.example.org`).join(
      ',',
    );
    expect(problems({ ...REALM_DRAFT, emailDomains: many }, 'sign-in')).toEqual([
      'At most 20 email domains.',
    ]);
    expect(problems(REALM_DRAFT, 'sign-in')).toEqual([]);
    expect(problems(EMPTY_DRAFT, 'administrator')).toEqual([
      'Write the email address of the administrator.',
      'Write the first and the last name of the administrator.',
    ]);
    expect(problems(PASSWORD_DRAFT, 'administrator')).toEqual([]);
    expect(problems(EMPTY_DRAFT, 'review')).toHaveLength(4);
    expect(problems(REALM_DRAFT, 'review')).toEqual([]);
  });

  it('asks the kernel for a realm only for a sign-in through it', () => {
    expect(usesRealm(PASSWORD_DRAFT)).toBe(false);
    expect(usesRealm({ ...PASSWORD_DRAFT, signIn: 'password-or-realm' })).toBe(true);
    expect(domainsOf(REALM_DRAFT)).toEqual(['example.org', 'acme.example.org']);
    expect(request(PASSWORD_DRAFT)).toEqual({
      slug: 'acme-europe',
      name: 'Acme Europe',
      selfRegistration: false,
      signIn: 'password',
    });
    expect(request(REALM_DRAFT)).toEqual({
      slug: 'acme-europe',
      name: 'Acme Europe',
      selfRegistration: false,
      signIn: 'realm',
      federation: {
        emailDomains: ['example.org', 'acme.example.org'],
        administrator: { email: 'robin@example.org', firstName: 'Robin', lastName: 'Green' },
      },
    });
  });

  it('creates an organization with a password and its administrator with a link', async () => {
    const client = kernel();
    const created = await createOrganization(client, PASSWORD_DRAFT);

    expect(created).toEqual({
      organization: ACME,
      access: { kind: 'link', mailed: false, link: LINK.link },
    });
    expect(client.createAccount).toHaveBeenCalledWith('acme-europe', {
      email: 'robin@example.org',
      displayName: 'Robin Green',
      roles: ['organization-admin', 'organization-user'],
    });
    expect(client.invite).not.toHaveBeenCalled();
  });

  it('makes a person with an account already its administrator', async () => {
    const client = kernel({
      createAccount: vi.fn(() =>
        Promise.reject(
          new KernelError(409, 'Conflict', 'An account with this email already exists'),
        ),
      ),
    });
    const created = await createOrganization(client, PASSWORD_DRAFT);

    expect(created.access).toEqual({ kind: 'member' });
    expect(client.invite).toHaveBeenCalledWith('acme-europe', 'robin@example.org', {
      roles: ['organization-admin', 'organization-user'],
      displayName: 'Robin Green',
    });
  });

  it('says when the organization was created but its administrator could not be added', async () => {
    const refused = await createOrganization(
      kernel({ createAccount: vi.fn(() => Promise.reject(new Error('Mail server down'))) }),
      PASSWORD_DRAFT,
    );
    expect(refused.access).toEqual({ kind: 'failed', reason: 'Mail server down' });

    const notInvited = await createOrganization(
      kernel({
        createAccount: vi.fn(() => Promise.reject(new KernelError(409, 'Conflict', 'exists'))),
        invite: vi.fn(() => Promise.reject(new Error('No'))),
      }),
      PASSWORD_DRAFT,
    );
    expect(notInvited.access).toEqual({ kind: 'failed', reason: 'No' });
  });

  it('creates an organization with a realm and its administrator in it, with a temporary password', async () => {
    const client = kernel({
      createOrganization: vi.fn(() =>
        Promise.resolve({
          ...ACME,
          signIn: 'realm',
          initialAdministrator: { username: 'robin@example.org', temporaryPassword: 'Temp-123' },
        }),
      ),
    });
    const created = await createOrganization(client, REALM_DRAFT);

    expect(created.access).toEqual({
      kind: 'temporary-password',
      username: 'robin@example.org',
      password: 'Temp-123',
    });
    expect(client.createAccount).not.toHaveBeenCalled();
    // A realm that had the person already gives no password.
    expect((await createOrganization(kernel(), REALM_DRAFT)).access).toEqual({ kind: 'member' });
  });

  it('lets the error of the kernel through when the organization cannot be created', async () => {
    await expect(
      createOrganization(
        kernel({
          createOrganization: vi.fn(() =>
            Promise.reject(new KernelError(409, 'Conflict', 'Taken')),
          ),
        }),
        PASSWORD_DRAFT,
      ),
    ).rejects.toThrow('Taken');
  });
});
