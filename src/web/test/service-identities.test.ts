// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  KernelClient,
  type NewServiceIdentity,
  type ServiceGrants,
  type ServiceIdentities,
  type ServiceIdentity,
  type ServiceKey,
} from '../src/api.js';
import { setLanguage } from '../src/i18n.js';
import {
  ServiceIdentityList,
  describeGrants,
  describeServiceKey,
  names,
  type ServiceIdentityForm,
} from '../src/service-identities.js';

const KEY: ServiceKey = {
  id: 'k-1',
  prefix: 'mks_AbCdEfGh',
  createdAt: '2026-10-13T08:00:00Z',
  lastUsedAt: null,
};
const GATEWAY: ServiceIdentity = {
  id: 's-gateway',
  name: 'gateway',
  description: 'In front of the map server',
  apis: ['catalog'],
  endpoints: ['check-session'],
  organizations: [],
  createdAt: '2026-10-13T08:00:00Z',
  createdBy: 'admin',
  keys: [KEY],
};
const FORM: ServiceIdentityForm = {
  name: ' map-server ',
  description: ' Maps keys to people ',
  apis: 'catalog, layers catalog',
  endpoints: ['check-key'],
  organizations: 'acme,\ngreen',
};

function events() {
  return { changed: vi.fn(), announce: vi.fn<(message: string) => void>() };
}

function client(
  found: ServiceIdentities = {
    identities: [GATEWAY],
    endpoints: ['check-key', 'check-session'],
    maxKeys: 2,
  },
) {
  return {
    serviceIdentities: vi.fn<() => Promise<ServiceIdentities>>(() => Promise.resolve(found)),
    createServiceIdentity: vi.fn<(request: NewServiceIdentity) => Promise<ServiceIdentity>>(
      (request) =>
        Promise.resolve({
          ...GATEWAY,
          ...request,
          id: 's-new',
          keys: [{ ...KEY, id: 'k-new', secret: 'mks_AbCdEfGh-rest' }],
        }),
    ),
    grantServiceIdentity: vi.fn<(id: string, grants: ServiceGrants) => Promise<ServiceIdentity>>(
      (id, grants) => Promise.resolve({ ...GATEWAY, ...grants, id }),
    ),
    createServiceKey: vi.fn<(id: string) => Promise<ServiceKey>>(() =>
      Promise.resolve({ ...KEY, id: 'k-2', prefix: 'mks_ZyXwVuTs', secret: 'mks_ZyXwVuTs-rest' }),
    ),
    revokeServiceKey: vi.fn<(id: string, key: string) => Promise<void>>(() => Promise.resolve()),
  };
}

describe('the service identities for platform administrators (MK-124)', () => {
  afterEach(() => {
    setLanguage('en');
  });

  it('reads names separated by commas, spaces or lines, once each', () => {
    expect(names('catalog, layers catalog\n  maps,,')).toEqual(['catalog', 'layers', 'maps']);
    expect(names('  ')).toEqual([]);
  });

  it('says what an identity may call and when its keys were used', () => {
    expect(describeGrants(GATEWAY)).toBe('APIs: catalog · Kernel: check-session');
    expect(describeGrants({ ...GATEWAY, apis: [], endpoints: [], organizations: ['acme'] })).toBe(
      'No API of extensions · Organizations: acme',
    );
    expect(describeServiceKey(KEY)).toMatch(/^mks_AbCdEfGh… · created .+ · last used never$/);
    setLanguage('it');
    expect(describeServiceKey({ ...KEY, lastUsedAt: '2026-10-13T09:00:00Z' })).toMatch(
      /^mks_AbCdEfGh… · creata .+ · ultimo uso .+$/,
    );
  });

  it('loads the identities, or says why it cannot', async () => {
    const seen = events();
    const list = new ServiceIdentityList(client(), seen);
    await list.load();
    expect(list.identities).toEqual([GATEWAY]);
    expect(list.endpoints).toEqual(['check-key', 'check-session']);
    expect(list.maxKeys).toBe(2);
    expect(seen.changed).toHaveBeenCalled();

    const failing = client();
    failing.serviceIdentities.mockRejectedValueOnce(new Error('offline'));
    const other = events();
    await new ServiceIdentityList(failing, other).load();
    expect(other.announce).toHaveBeenCalledWith('The service identities cannot be read: offline');
  });

  it('creates an identity and keeps its secret until it is copied and dismissed', async () => {
    const api = client();
    const seen = events();
    const list = new ServiceIdentityList(api, seen);
    await list.load();

    expect(await list.create({ ...FORM, name: '  ' })).toBe(false);
    expect(seen.announce).toHaveBeenLastCalledWith(
      'Name the service identity after the service that uses it.',
    );

    expect(await list.create(FORM)).toBe(true);
    expect(api.createServiceIdentity).toHaveBeenCalledWith({
      name: 'map-server',
      description: 'Maps keys to people',
      apis: ['catalog', 'layers'],
      endpoints: ['check-key'],
      organizations: ['acme', 'green'],
    });
    expect(list.created).toEqual({
      identity: 'map-server',
      prefix: 'mks_AbCdEfGh',
      secret: 'mks_AbCdEfGh-rest',
    });
    expect(list.identities?.map((identity) => identity.name)).toEqual(['gateway', 'map-server']);
    expect(list.identities?.[1]?.keys[0]).not.toHaveProperty('secret');
    expect(list.busy).toBe(false);

    const clipboard = {
      writeText: vi.fn<(text: string) => Promise<void>>(() => Promise.resolve()),
    };
    await list.copy(clipboard);
    expect(clipboard.writeText).toHaveBeenCalledWith('mks_AbCdEfGh-rest');
    expect(seen.announce).toHaveBeenLastCalledWith('Key copied.');
    await list.copy(undefined);
    expect(seen.announce).toHaveBeenLastCalledWith(
      'The key was not copied: no clipboard. Select it and copy it.',
    );
    list.dismiss();
    expect(list.created).toBeUndefined();
    await list.copy(clipboard);
    expect(clipboard.writeText).toHaveBeenCalledTimes(1);
  });

  it('says why an identity was not created', async () => {
    const api = client();
    api.createServiceIdentity.mockRejectedValueOnce(
      new Error('A service identity is already called gateway.'),
    );
    const seen = events();
    const list = new ServiceIdentityList(api, seen);
    expect(await list.create(FORM)).toBe(false);
    expect(seen.announce).toHaveBeenLastCalledWith(
      'The service identity was not created: A service identity is already called gateway.',
    );
    expect(await new ServiceIdentityList(undefined, events()).create(FORM)).toBe(false);
  });

  it('changes what an identity may call', async () => {
    const api = client();
    const seen = events();
    const list = new ServiceIdentityList(api, seen);
    await list.load();
    expect(await list.grant(GATEWAY, { ...FORM, apis: 'orders' })).toBe(true);
    expect(api.grantServiceIdentity).toHaveBeenCalledWith('s-gateway', {
      description: 'Maps keys to people',
      apis: ['orders'],
      endpoints: ['check-key'],
      organizations: ['acme', 'green'],
    });
    expect(list.identities?.[0]?.apis).toEqual(['orders']);
    expect(seen.announce).toHaveBeenLastCalledWith('Saved: gateway');

    api.grantServiceIdentity.mockRejectedValueOnce(new Error('bad api'));
    expect(await list.grant(GATEWAY, FORM)).toBe(false);
    expect(seen.announce).toHaveBeenLastCalledWith('Not saved: bad api');
    expect(await new ServiceIdentityList(undefined, events()).grant(GATEWAY, FORM)).toBe(false);
  });

  it('rotates a key with two live keys at most, and revokes the old one', async () => {
    const api = client();
    const seen = events();
    const list = new ServiceIdentityList(api, seen);
    await list.load();
    expect(list.canRotate(GATEWAY)).toBe(true);

    expect(await list.rotate(GATEWAY)).toBe(true);
    expect(list.created).toEqual({
      identity: 'gateway',
      prefix: 'mks_ZyXwVuTs',
      secret: 'mks_ZyXwVuTs-rest',
    });
    const rotated = list.identities?.[0];
    expect(rotated?.keys.map((key) => key.prefix)).toEqual(['mks_ZyXwVuTs', 'mks_AbCdEfGh']);
    expect(rotated?.keys[0]).not.toHaveProperty('secret');
    expect(rotated && list.canRotate(rotated)).toBe(false);

    if (rotated) {
      await list.revoke(rotated, KEY);
    }
    expect(api.revokeServiceKey).toHaveBeenCalledWith('s-gateway', 'k-1');
    expect(list.identities?.[0]?.keys.map((key) => key.prefix)).toEqual(['mks_ZyXwVuTs']);
    expect(seen.announce).toHaveBeenLastCalledWith('Key revoked: gateway (mks_AbCdEfGh…)');

    // Revoking the key just created forgets its secret.
    const fresh = list.identities?.[0];
    if (fresh?.keys[0]) {
      await list.revoke(fresh, fresh.keys[0]);
    }
    expect(list.created).toBeUndefined();
  });

  it('says why a key was not created or revoked', async () => {
    const api = client();
    api.createServiceKey.mockRejectedValueOnce(new Error('two live keys'));
    api.revokeServiceKey.mockRejectedValueOnce(new Error('gone'));
    const seen = events();
    const list = new ServiceIdentityList(api, seen);
    await list.load();
    expect(await list.rotate(GATEWAY)).toBe(false);
    expect(seen.announce).toHaveBeenLastCalledWith('The key was not created: two live keys');
    await list.revoke(GATEWAY, KEY);
    expect(seen.announce).toHaveBeenCalledWith('The key was not revoked: gone');
    expect(api.serviceIdentities).toHaveBeenCalledTimes(2);
    expect(await new ServiceIdentityList(undefined, events()).rotate(GATEWAY)).toBe(false);
  });
});

describe('the client of the service identities (MK-124)', () => {
  const json = (status: number, body: unknown): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });

  it('calls the endpoints of the platform administrators', async () => {
    const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(
      (_path, init) =>
        Promise.resolve(
          init?.method === 'DELETE' ? new Response(null, { status: 204 }) : json(200, GATEWAY),
        ),
    );
    const api = new KernelClient(fetchMock);
    await api.serviceIdentities();
    await api.createServiceIdentity({
      name: 'gateway',
      description: '',
      apis: [],
      endpoints: [],
      organizations: [],
    });
    await api.grantServiceIdentity('s 1', {
      description: '',
      apis: ['catalog'],
      endpoints: [],
      organizations: [],
    });
    await api.createServiceKey('s 1');
    await api.revokeServiceKey('s 1', 'k/1');
    expect(fetchMock.mock.calls.map(([path, init]) => `${init?.method ?? 'GET'} ${path}`)).toEqual([
      'GET /api/v1/platform/service-identities',
      'POST /api/v1/platform/service-identities',
      'PUT /api/v1/platform/service-identities/s%201',
      'POST /api/v1/platform/service-identities/s%201/keys',
      'DELETE /api/v1/platform/service-identities/s%201/keys/k%2F1',
    ]);
  });

  it('says why a key was not revoked', async () => {
    const api = new KernelClient(() =>
      Promise.resolve(json(404, { title: 'Not Found', detail: 'No live key.' })),
    );
    await expect(api.revokeServiceKey('s-1', 'k-1')).rejects.toThrow('No live key.');
  });
});
