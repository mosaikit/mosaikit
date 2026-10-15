// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it, vi } from 'vitest';
import { type DeletedOrganization, KernelClient, type OrganizationSummary } from '../src/api.js';
import { OrganizationList, confirms } from '../src/organizations.js';

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
