// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import type { FrontendExtension } from '@mosaikit/sdk';
import { describe, expect, it } from 'vitest';
import {
  CONSOLE_PANEL_POINT,
  addressOf,
  consoleMetrics,
  consolePanels,
  describeEvent,
} from '../src/admin-console.js';
import { bytes, count, duration, matchesText } from '../src/admin-view.js';
import type { ConsoleOverview, SecurityEvent } from '../src/api.js';

const OVERVIEW: ConsoleOverview = {
  organizations: { total: 5, active: 4, suspended: 1 },
  people: { total: 40, suspended: 2 },
  extensions: { active: 3, list: [{ id: 'org.example.notes', version: '1.2.0' }] },
  system: {
    version: '0.9.0',
    startedAt: '2026-10-15T08:00:00Z',
    uptimeSeconds: 3 * 86_400 + 4 * 3_600,
    heapUsedBytes: 512 * 1024 * 1024,
    heapMaxBytes: 2 * 1024 * 1024 * 1024,
    processors: 8,
    threads: 60,
  },
  security: { since: '2026-10-14T08:00:00Z', failedSignIns: 7, events: [] },
};

const FAILED: SecurityEvent = {
  occurredAt: '2026-10-15T08:00:00Z',
  actor: 'pat@example.org',
  action: 'account.sign-in.failed',
  subject: 'pat@example.org',
  outcome: 'DENIED',
  detail: '{"address":"192.0.2.10"}',
};

const extension = (
  contributions: { id: string; attributes: Record<string, unknown> }[],
  id = 'org.example.backups',
): FrontendExtension => ({
  id,
  version: '1.0.0',
  entry: '/index.js',
  isolation: 'module',
  contributions: contributions.map((contribution) => ({
    point: CONSOLE_PANEL_POINT,
    ...contribution,
  })),
});

describe('the console of the platform administrators (MK-072)', () => {
  it('shows organizations, people, extensions, failed sign-ins and the system on top', () => {
    const metrics = consoleMetrics(OVERVIEW);

    expect(metrics.map((metric) => metric.label)).toEqual([
      'Organizations',
      'People',
      'Active extensions',
      'Failed sign-ins',
      'Memory',
      'Running for',
    ]);
    expect(metrics[0]).toMatchObject({ value: '4', note: 'active, 1 suspended', tone: 'warn' });
    expect(metrics[1]).toMatchObject({ value: '40', note: '2 suspended' });
    expect(metrics[2]).toMatchObject({ value: '3' });
    expect(metrics[3]).toMatchObject({ value: '7', tone: 'warn' });
    expect(metrics[4]).toMatchObject({ value: '512 MB', note: 'of 2 GB' });
    expect(metrics[4]?.tone).toBeUndefined();
    expect(metrics[5]).toMatchObject({ value: '3 d 4 h', note: 'version 0.9.0, 8 processors' });
  });

  it('marks a calm installation as such, and a heap almost full as a problem', () => {
    const calm = consoleMetrics({
      ...OVERVIEW,
      organizations: { total: 2, active: 2, suspended: 0 },
      security: { ...OVERVIEW.security, failedSignIns: 0 },
      system: { ...OVERVIEW.system, heapUsedBytes: 95, heapMaxBytes: 100 },
    });

    expect(calm[0]?.tone).toBeUndefined();
    expect(calm[3]?.tone).toBe('ok');
    expect(calm[4]?.tone).toBe('problem');
  });

  it('says what a security event was and where it came from', () => {
    expect(describeEvent(FAILED)).toBe('Sign-in refused for pat@example.org');
    expect(addressOf(FAILED)).toBe('192.0.2.10');
    const refused: SecurityEvent = {
      ...FAILED,
      action: 'service.call.refused',
      subject: null,
      actor: 'reports',
      detail: 'not json',
    };
    expect(describeEvent(refused)).toBe('service.call.refused refused for reports');
    expect(describeEvent({ ...refused, outcome: 'FAILED' })).toBe(
      'service.call.refused failed for reports',
    );
    expect(addressOf(refused)).toBeUndefined();
    expect(addressOf({ ...FAILED, detail: null })).toBeUndefined();
    expect(addressOf({ ...FAILED, detail: '{"address":3}' })).toBeUndefined();
  });

  it('takes the panels of extensions from console.panel, in their order, for whom may see them', () => {
    const panels = consolePanels(
      [
        extension([
          {
            id: 'backups',
            attributes: {
              title: 'Backups',
              element: 'backups-panel',
              description: 'The last backups',
              order: 20,
              i18n: { it: { title: 'Backup' } },
            },
          },
          { id: 'broken', attributes: { title: 'Broken', element: 'NotAnElement' } },
          {
            id: 'secret',
            attributes: { title: 'Secret', element: 'secret-panel', permission: 'see' },
          },
        ]),
        extension([{ id: 'usage', attributes: { element: 'usage-panel' } }], 'org.example.usage'),
      ],
      new Set(['org.example.usage:other']),
      'it',
    );

    expect(panels).toEqual([
      {
        extensionId: 'org.example.backups',
        id: 'backups',
        title: 'Backup',
        description: 'The last backups',
        element: 'backups-panel',
      },
      { extensionId: 'org.example.usage', id: 'usage', title: 'usage', element: 'usage-panel' },
    ]);
    // Without the permissions of the person known yet, the shell shows them all.
    expect(
      consolePanels(
        [
          extension([
            {
              id: 'secret',
              attributes: { title: 'S', element: 'secret-panel', permission: 'see' },
            },
          ]),
        ],
        undefined,
        'en',
      ),
    ).toHaveLength(1);
  });
});

describe('the figures of the administration pages (MK-072)', () => {
  it('finds a text in any field, whatever the case', () => {
    expect(matchesText('', 'anything')).toBe(true);
    expect(matchesText('  acme ', 'Green', 'ACME Europe')).toBe(true);
    expect(matchesText('acme', 'Green', null, undefined)).toBe(false);
  });

  it('writes sizes, durations and counts', () => {
    expect(bytes(0)).toBe('0 B');
    expect(bytes(-5)).toBe('0 B');
    expect(bytes(1536)).toBe('1.5 KB');
    expect(bytes(15 * 1024 * 1024)).toBe('15 MB');
    expect(bytes(3 * 1024 ** 5)).toBe('3072 TB');
    expect(duration(40)).toBe('40 s');
    expect(duration(-1)).toBe('0 s');
    expect(duration(5 * 60)).toBe('5 min');
    expect(duration(5 * 3_600 + 12 * 60)).toBe('5 h 12 min');
    expect(duration(86_400)).toBe('1 d 0 h');
    expect(count(12)).toBe('12');
  });
});
