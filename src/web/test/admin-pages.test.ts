// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';
import {
  appMetrics,
  extensionMetrics,
  filterApps,
  filterMembers,
  filterOffers,
  filterOrigins,
  filterProfiles,
  filterQuotas,
  filterSecrets,
  filterServices,
  filterSettings,
  filterTeams,
  originMetrics,
  permissionMetrics,
  platformSettings,
  quotaMetrics,
  secretMetrics,
  serviceMetrics,
  settingMetrics,
} from '../src/admin-pages.js';
import type {
  Catalog,
  ContentSecurityPolicy,
  DeclaredPermission,
  Offer,
  OrganizationApp,
  OrganizationMember,
  PermissionProfile,
  Quota,
  Secret,
  ServiceIdentity,
} from '../src/api.js';
import type { Metric } from '../src/admin-view.js';

const pairs = (metrics: readonly Metric[]): [string, string][] =>
  metrics.map((metric) => [metric.label, metric.value]);

const OFFER: Offer = {
  source: 'https://catalog.example.org/index.json',
  id: 'org.example.notes',
  version: '1.2.0',
  name: 'Notes',
  size: 2048,
  publisherKey: 'acme',
  state: 'available',
};

describe('the administration pages on one model (MK-072)', () => {
  it('Extensions counts catalogs, offers, installed, updates and restarts, and filters', () => {
    const catalog: Catalog = {
      sources: [
        { uri: 'https://catalog.example.org', status: 'verified', keyId: 'acme' },
        { uri: 'https://other.example.org', status: 'refused', error: 'bad signature' },
      ],
      extensions: [
        OFFER,
        {
          ...OFFER,
          id: 'org.example.tasks',
          name: 'Tasks',
          state: 'update',
          installedVersion: '1.0.0',
        },
        {
          ...OFFER,
          id: 'org.example.green',
          name: 'Green',
          state: 'restart',
          installedVersion: '1.2.0',
        },
      ],
    };
    const metrics = extensionMetrics(catalog);
    expect(pairs(metrics)).toEqual([
      ['Catalogs', '2'],
      ['Offered', '3'],
      ['Installed', '2'],
      ['Updates', '1'],
      ['Waiting for a restart', '1'],
    ]);
    expect(metrics[0]).toMatchObject({ note: '1 refused', tone: 'problem' });
    expect(metrics[3]?.tone).toBe('warn');
    expect(extensionMetrics(undefined)).toEqual([]);
    expect(extensionMetrics({ sources: [], extensions: [] })[0]?.tone).toBeUndefined();

    const offers = catalog.extensions;
    expect(filterOffers(offers, '', 'all')).toHaveLength(3);
    expect(filterOffers(offers, 'TASKS', 'all').map((offer) => offer.name)).toEqual(['Tasks']);
    expect(filterOffers(offers, '', 'installed').map((offer) => offer.name)).toEqual([
      'Tasks',
      'Green',
    ]);
    expect(filterOffers(offers, '', 'available').map((offer) => offer.name)).toEqual(['Notes']);
    expect(filterOffers(offers, '', 'update').map((offer) => offer.name)).toEqual(['Tasks']);
  });

  it('Organization apps counts shown, hidden, pinned and restricted apps, and keeps their place', () => {
    const app: OrganizationApp = {
      extensionId: 'org.example.notes',
      appId: 'notes',
      title: 'Notes',
      enabled: true,
      pinned: false,
    };
    const apps = [
      app,
      { ...app, appId: 'tasks', title: 'Tasks', enabled: false, pinned: true, restricted: true },
    ];
    expect(pairs(appMetrics(apps))).toEqual([
      ['Apps', '2'],
      ['Shown', '1'],
      ['Hidden', '1'],
      ['Pinned', '1'],
      ['For who holds its permission', '1'],
    ]);
    expect(filterApps(apps, 'task')).toEqual([{ app: apps[1], index: 1 }]);
    expect(filterApps(apps, '')).toHaveLength(2);
  });

  it('Credentials counts them by audience, and filters by name, description and extension', () => {
    const secret: Secret = {
      name: 'model-provider',
      kind: 'token',
      description: 'The model of the assistant',
      extension: null,
      hint: '••••abcd',
      createdAt: '2026-10-01T08:00:00Z',
      updatedAt: '2026-10-01T08:00:00Z',
      updatedBy: 'admin',
    };
    const secrets = [
      secret,
      { ...secret, name: 'mail', description: '', extension: 'org.example.mail' },
    ];
    expect(pairs(secretMetrics(secrets))).toEqual([
      ['Credentials', '2'],
      ['For one extension', '1'],
      ['For any extension', '1'],
    ]);
    expect(secretMetrics(undefined)).toEqual([]);
    expect(filterSecrets(secrets, 'assistant').map((found) => found.name)).toEqual([
      'model-provider',
    ]);
    expect(filterSecrets(secrets, 'example.mail').map((found) => found.name)).toEqual(['mail']);
  });

  it('Quotas counts the measures near and at their limit', () => {
    const quota: Quota = {
      measure: 'storage',
      label: 'Storage',
      unit: 'bytes',
      kind: 'gauge',
      extension: null,
      limit: 100,
      source: 'organization',
      installationLimit: null,
      period: null,
      used: 50,
    };
    const quotas = [
      quota,
      {
        ...quota,
        measure: 'org.example.notes/calls',
        label: 'Calls',
        used: 85,
        extension: 'org.example.notes',
      },
      { ...quota, measure: 'mail', label: 'Mail', used: 120 },
      { ...quota, measure: 'free', label: 'Free', limit: null },
    ];
    const metrics = quotaMetrics(quotas);
    expect(pairs(metrics)).toEqual([
      ['Measures', '4'],
      ['With a limit', '3'],
      ['Near the limit', '1'],
      ['At the limit', '1'],
    ]);
    expect(metrics[3]?.tone).toBe('problem');
    expect(quotaMetrics([quota])[3]?.tone).toBeUndefined();
    expect(quotaMetrics(undefined)).toEqual([]);
    expect(filterQuotas(quotas, 'notes').map((found) => found.label)).toEqual(['Calls']);
  });

  it('External origins says whether the policy is sent, and filters by source', () => {
    const policy: ContentSecurityPolicy = {
      enabled: true,
      policy: "default-src 'self'",
      origins: [
        {
          origin: 'https://tiles.example.org',
          source: 'CONFIGURATION',
          addedAt: null,
          addedBy: null,
        },
        {
          origin: 'https://data.example.org',
          source: 'ADMINISTRATION',
          addedAt: '2026-10-01T08:00:00Z',
          addedBy: 'admin',
        },
      ],
    };
    expect(pairs(originMetrics(policy))).toEqual([
      ['Policy', 'Sent'],
      ['Origins', '2'],
      ['From the configuration', '1'],
      ['Added here', '1'],
    ]);
    expect(originMetrics({ ...policy, enabled: false })[0]).toMatchObject({
      value: 'Not sent',
      tone: 'warn',
    });
    expect(originMetrics(undefined)).toEqual([]);
    expect(filterOrigins(policy.origins, '', 'ADMINISTRATION')).toHaveLength(1);
    expect(filterOrigins(policy.origins, 'tiles', 'all')).toHaveLength(1);
    expect(filterOrigins(policy.origins, 'admin', 'all')).toHaveLength(1);
  });

  it('Service identities counts keys, and those without one or with every key', () => {
    const identity: ServiceIdentity = {
      id: '1',
      name: 'gateway',
      description: 'In front of the map server',
      apis: ['maps'],
      endpoints: ['check-key'],
      organizations: ['acme'],
      createdAt: '2026-10-01T08:00:00Z',
      createdBy: 'admin',
      keys: [{ id: 'k1', prefix: 'mks_abc', createdAt: '2026-10-01T08:00:00Z', lastUsedAt: null }],
    };
    const identities = [
      identity,
      { ...identity, id: '2', name: 'reports', apis: [], keys: [] },
      {
        ...identity,
        id: '3',
        name: 'rotating',
        keys: [
          ...identity.keys,
          { ...identity.keys[0], id: 'k2', prefix: 'mks_def' } as ServiceIdentity['keys'][number],
        ],
      },
    ];
    expect(pairs(serviceMetrics(identities, 2))).toEqual([
      ['Service identities', '3'],
      ['Live keys', '3'],
      ['Without a key', '1'],
      ['With two keys', '1'],
    ]);
    expect(serviceMetrics(undefined, 2)).toEqual([]);
    expect(filterServices(identities, 'MAPS').map((found) => found.name)).toEqual([
      'gateway',
      'rotating',
    ]);
    expect(filterServices(identities, 'acme')).toHaveLength(3);
  });

  it('Permissions counts permissions, profiles, people and teams, and filters each tab', () => {
    const declared = [
      { id: 'a:export', off: false },
      { id: 'b:read', off: true },
    ] as unknown as DeclaredPermission[];
    const profiles: PermissionProfile[] = [
      {
        id: 'p1',
        name: 'Editors',
        description: 'They write',
        defaultForRole: null,
        permissions: [],
      },
      {
        id: 'p2',
        name: 'Readers',
        description: '',
        defaultForRole: 'organization-user',
        permissions: [],
      },
    ];
    const members: OrganizationMember[] = [
      {
        accountId: '1',
        username: 'robin@example.org',
        displayName: 'Robin Green',
        roles: ['organization-user'],
      },
    ];
    const teams = [
      { id: 't1', name: 'Field team' },
      { id: 't2', name: 'Office' },
    ];
    const metrics = permissionMetrics(declared, profiles, members, teams);
    expect(pairs(metrics)).toEqual([
      ['Permissions', '2'],
      ['Profiles', '2'],
      ['People', '1'],
      ['Teams', '2'],
    ]);
    expect(metrics[0]?.note).toBe('1 of extensions turned off');
    expect(filterProfiles(profiles, 'write').map((found) => found.name)).toEqual(['Editors']);
    expect(filterMembers(members, 'green')).toHaveLength(1);
    expect(filterMembers(members, 'nobody')).toHaveLength(0);
    expect(filterTeams(teams, 'field').map((found) => found.name)).toEqual(['Field team']);
  });

  it('Platform settings lists the settings as rows, counts them and filters them', () => {
    const on = platformSettings({ registration: true });
    expect(on).toHaveLength(1);
    expect(on[0]).toMatchObject({ id: 'registration', on: true });
    expect(pairs(settingMetrics(on))).toEqual([
      ['Settings', '1'],
      ['On', '1'],
      ['Off', '0'],
    ]);
    expect(pairs(settingMetrics(platformSettings({ registration: false })))[2]).toEqual([
      'Off',
      '1',
    ]);
    expect(platformSettings(undefined)).toEqual([]);
    expect(settingMetrics([])).toEqual([]);
    expect(filterSettings(on, 'account')).toHaveLength(1);
    expect(filterSettings(on, 'tiles')).toHaveLength(0);
  });
});
