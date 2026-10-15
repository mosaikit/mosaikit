// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it, vi } from 'vitest';
import { type DeletedOrganization, KernelClient, type OrganizationSummary } from '../src/api.js';
import {
  MAX_SUSPENSION_REASON,
  OrganizationList,
  confirms,
  filterOrganizations,
  organizationMetrics,
  signInLabel,
} from '../src/organizations.js';

const ACME: OrganizationSummary = {
  id: '00000000-0000-0000-0000-000000000001',
  slug: 'acme',
  name: 'Acme',
  createdAt: '2026-10-01T08:00:00Z',
  identityRealm: null,
  emailDomains: [],
};
const GREEN: OrganizationSummary = {
  ...ACME,
  id: '00000000-0000-0000-0000-000000000002',
  slug: 'green',
  name: 'Green',
};
const DELETED: DeletedOrganization = {
  id: ACME.id,
  slug: 'acme',
  name: 'Acme',
  deletedAt: '2026-10-15T08:00:00Z',
  removableFrom: '2026-11-14T08:00:00Z',
  members: 3,
};

function events() {
  return { changed: vi.fn(), announce: vi.fn<(message: string, failed: boolean) => void>() };
}

function client(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    organizations: vi.fn(() => Promise.resolve([ACME, GREEN])),
    deleteOrganization: vi.fn(() => Promise.resolve(DELETED)),
    suspendOrganization: vi.fn(() => Promise.resolve({ ...ACME, suspended: true })),
    reactivateOrganization: vi.fn(() => Promise.resolve(ACME)),
    ...overrides,
  };
}

describe('the deletion of an organization (MK-130)', () => {
  it('is confirmed only by the slug of the organization', () => {
    expect(confirms(ACME, 'acme')).toBe(true);
    expect(confirms(ACME, '  acme ')).toBe(true);
    expect(confirms(ACME, 'Acme')).toBe(false);
    expect(confirms(ACME, 'green')).toBe(false);
    expect(confirms(ACME, '')).toBe(false);
  });

  it('reads the organizations and deletes one once its slug is written', async () => {
    const kernel = client();
    const told = events();
    const list = new OrganizationList(kernel, told, (iso) => iso);

    await list.load();
    expect(list.organizations).toEqual([ACME, GREEN]);

    kernel.organizations.mockResolvedValueOnce([GREEN]);
    expect(await list.remove(ACME, ' acme')).toBe(true);
    expect(kernel.deleteOrganization).toHaveBeenCalledWith('acme', 'acme');
    expect(list.organizations).toEqual([GREEN]);
    expect(told.announce).toHaveBeenLastCalledWith(
      'Acme deleted: 3 people lost access. Its data are removed from 2026-11-14T08:00:00Z.',
      false,
    );
  });

  it('deletes nothing without the slug, and says why', async () => {
    const kernel = client();
    const told = events();
    const list = new OrganizationList(kernel, told, (iso) => iso);

    expect(await list.remove(ACME, 'green')).toBe(false);
    expect(kernel.deleteOrganization).not.toHaveBeenCalled();
    expect(told.announce).toHaveBeenLastCalledWith(
      'Write acme to confirm: nothing was deleted.',
      true,
    );
  });

  it('says what the kernel refused', async () => {
    const kernel = client({
      organizations: vi.fn(() => Promise.reject(new Error('Forbidden'))),
      deleteOrganization: vi.fn(() => Promise.reject(new Error('No organization'))),
    });
    const told = events();
    const list = new OrganizationList(kernel, told, (iso) => iso);

    await list.load();
    expect(told.announce).toHaveBeenLastCalledWith(
      'The organizations cannot be read: Forbidden',
      true,
    );
    expect(told.changed).toHaveBeenCalled();
    expect(await list.remove(ACME, 'acme')).toBe(false);
    expect(told.announce).toHaveBeenLastCalledWith('Not deleted: No organization', true);
  });

  it('does nothing without a kernel', async () => {
    const told = events();
    const list = new OrganizationList(undefined, told, (iso) => iso);
    await list.load();
    expect(await list.remove(ACME, 'acme')).toBe(false);
    expect(told.announce).not.toHaveBeenCalled();
  });

  it('asks the kernel with the confirmation', async () => {
    const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(
        new Response(JSON.stringify([ACME]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    const kernel = new KernelClient(fetchMock, undefined);

    expect(await kernel.organizations()).toEqual([ACME]);
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(DELETED), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    expect(await kernel.deleteOrganization('acme', 'acme')).toEqual(DELETED);

    const calls = fetchMock.mock.calls.map(([path, init]) => `${init?.method ?? ''} ${path}`);
    expect(calls).toEqual([
      'GET /api/v1/organizations',
      'DELETE /api/v1/organizations/acme?confirmation=acme',
    ]);
  });
});

const SUSPENDED: OrganizationSummary = {
  ...GREEN,
  signIn: 'realm',
  identityRealm: 'green',
  emailDomains: ['green.example.org'],
  suspended: true,
  suspension: { at: '2026-10-15T09:00:00Z', by: 'admin', reason: 'Unpaid' },
};

describe('the organizations on the model of the administration pages (MK-072)', () => {
  it('filters by a text in the name, the slug or the domains, and by state', () => {
    const all = [ACME, SUSPENDED];
    expect(filterOrganizations(all, '', 'all')).toEqual(all);
    expect(filterOrganizations(all, 'GREEN.EXAMPLE', 'all')).toEqual([SUSPENDED]);
    expect(filterOrganizations(all, 'acm', 'all')).toEqual([ACME]);
    expect(filterOrganizations(all, '', 'suspended')).toEqual([SUSPENDED]);
    expect(filterOrganizations(all, '', 'active')).toEqual([ACME]);
    expect(filterOrganizations(all, 'acme', 'suspended')).toEqual([]);
  });

  it('counts them on top', () => {
    const metrics = organizationMetrics([ACME, SUSPENDED]);
    expect(metrics.map((metric) => [metric.label, metric.value])).toEqual([
      ['Organizations', '2'],
      ['Active', '1'],
      ['Suspended', '1'],
      ['With an identity provider', '1'],
    ]);
    expect(metrics[2]?.tone).toBe('warn');
    expect(organizationMetrics([ACME])[2]?.tone).toBeUndefined();
  });

  it('names how their members sign in', () => {
    expect(signInLabel(undefined)).toBe('Password');
    expect(signInLabel('password')).toBe('Password');
    expect(signInLabel('realm')).toBe('Through its identity provider');
    expect(signInLabel('password-or-realm')).toBe('Password or identity provider');
  });

  it('suspends one with a reason and reactivates it', async () => {
    const kernel = client({
      suspendOrganization: vi.fn(() => Promise.resolve({ ...ACME, suspended: true })),
      reactivateOrganization: vi.fn(() => Promise.resolve(ACME)),
    });
    const told = events();
    const list = new OrganizationList(kernel, told, (iso) => iso);
    await list.load();

    expect(await list.suspend(ACME, '  ')).toBe(false);
    expect(told.announce).toHaveBeenLastCalledWith('Write the reason for the suspension.', true);
    expect(await list.suspend(ACME, 'x'.repeat(MAX_SUSPENSION_REASON + 1))).toBe(false);
    expect(told.announce).toHaveBeenLastCalledWith(
      'The reason is longer than 500 characters.',
      true,
    );
    expect(kernel.suspendOrganization).not.toHaveBeenCalled();

    expect(await list.suspend(ACME, ' Unpaid ')).toBe(true);
    expect(kernel.suspendOrganization).toHaveBeenCalledWith('acme', 'Unpaid');
    expect(list.organizations?.[0]?.suspended).toBe(true);
    expect(told.announce).toHaveBeenLastCalledWith(
      'Acme is suspended: its members cannot sign in to it, and their sessions in it ended.',
      false,
    );

    expect(await list.reactivate(ACME)).toBe(true);
    expect(kernel.reactivateOrganization).toHaveBeenCalledWith('acme');
    expect(list.organizations?.[0]?.suspended).toBeUndefined();
    expect(told.announce).toHaveBeenLastCalledWith(
      'Acme is active again: its members sign in.',
      false,
    );
  });

  it('says what the kernel refused when suspending or reactivating', async () => {
    const kernel = client({
      suspendOrganization: vi.fn(() => Promise.reject(new Error('Gone'))),
      reactivateOrganization: vi.fn(() => Promise.reject(new Error('Gone'))),
    });
    const told = events();
    const list = new OrganizationList(kernel, told, (iso) => iso);

    expect(await list.suspend(ACME, 'why')).toBe(false);
    expect(told.announce).toHaveBeenLastCalledWith(
      'The organization cannot be suspended: Gone',
      true,
    );
    expect(await list.reactivate(ACME)).toBe(false);
    expect(told.announce).toHaveBeenLastCalledWith(
      'The organization cannot be reactivated: Gone',
      true,
    );
    const idle = new OrganizationList(undefined, told, (iso) => iso);
    expect(await idle.suspend(ACME, 'why')).toBe(false);
    expect(await idle.reactivate(ACME)).toBe(false);
  });

  it('adds one just created in the order of names', async () => {
    const told = events();
    const list = new OrganizationList(
      client({ organizations: vi.fn(() => Promise.resolve([GREEN])) }),
      told,
      (iso) => iso,
    );
    list.added(ACME);
    expect(list.organizations).toEqual([ACME]);
    await list.load();
    list.added(ACME);
    expect(list.organizations?.map((organization) => organization.slug)).toEqual(['acme', 'green']);
  });

  it('asks the kernel to suspend, reactivate and create', async () => {
    const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(
        new Response(JSON.stringify(ACME), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    const kernel = new KernelClient(fetchMock, undefined);

    await kernel.suspendOrganization('acme', 'Unpaid');
    await kernel.reactivateOrganization('acme');
    await kernel.createOrganization({
      slug: 'acme',
      name: 'Acme',
      selfRegistration: false,
      signIn: 'password',
    });

    const calls = fetchMock.mock.calls.map(([path, init]) =>
      `${init?.method ?? ''} ${path} ${typeof init?.body === 'string' ? init.body : ''}`.trim(),
    );
    expect(calls).toEqual([
      'PUT /api/v1/organizations/acme/suspension {"reason":"Unpaid"}',
      'DELETE /api/v1/organizations/acme/suspension',
      'POST /api/v1/organizations {"slug":"acme","name":"Acme","selfRegistration":false,"signIn":"password"}',
    ]);
  });
});
