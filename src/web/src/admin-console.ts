// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import {
  contributionsTo,
  stringAttribute,
  textAttribute,
  type FrontendExtension,
} from '@mosaikit/sdk';
import type { ConsoleOverview, SecurityEvent } from './api.js';
import { type Metric, bytes, count, duration } from './admin-view.js';
import { t } from './i18n.js';
import { allows, requiredPermission } from './permissions.js';

/** The typed point through which extensions add panels to the console (MK-072, MK-134). */
export const CONSOLE_PANEL_POINT = 'console.panel';

/** A panel that an extension adds to the console. */
export interface ConsolePanel {
  readonly extensionId: string;
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  /** Custom element that renders the panel. */
  readonly element: string;
}

const CUSTOM_ELEMENT = /^[a-z][a-z0-9]*(-[a-z0-9]+)+$/;
const DEFAULT_ORDER = 100;

/**
 * The panels that active extensions add to the console with `console.panel`, in the order of their
 * `order` (100 by default) and then as the extensions come, without those whose element is not a
 * custom element name or that need a permission the person lacks. The kernel gives the shell only
 * the contributions that match the schema of the point.
 */
export function consolePanels(
  extensions: readonly FrontendExtension[],
  held: ReadonlySet<string> | undefined,
  language: string,
): ConsolePanel[] {
  const panels: { panel: ConsolePanel; order: number }[] = [];
  for (const contribution of contributionsTo(extensions, CONSOLE_PANEL_POINT)) {
    const element = stringAttribute(contribution, 'element');
    if (!element || !CUSTOM_ELEMENT.test(element)) {
      continue;
    }
    if (!allows(held, requiredPermission(contribution))) {
      continue;
    }
    const description = textAttribute(contribution, 'description', language);
    const order = contribution.attributes.order;
    panels.push({
      panel: {
        extensionId: contribution.extensionId,
        id: contribution.id,
        title: textAttribute(contribution, 'title', language) ?? contribution.id,
        ...(description ? { description } : {}),
        element,
      },
      order: typeof order === 'number' && Number.isFinite(order) ? order : DEFAULT_ORDER,
    });
  }
  return panels.sort((a, b) => a.order - b.order).map(({ panel }) => panel);
}

/** The metrics on top of the console. */
export function consoleMetrics(overview: ConsoleOverview): Metric[] {
  const { organizations, people, extensions, system, security } = overview;
  return [
    {
      label: t('Organizations'),
      value: count(organizations.active),
      note: t('active, {suspended} suspended', { suspended: count(organizations.suspended) }),
      ...(organizations.suspended > 0 ? { tone: 'warn' as const } : {}),
    },
    {
      label: t('People'),
      value: count(people.total),
      note: t('{suspended} suspended', { suspended: count(people.suspended) }),
    },
    {
      label: t('Active extensions'),
      value: count(extensions.active),
    },
    {
      label: t('Failed sign-ins'),
      value: count(security.failedSignIns),
      note: t('in the last 24 hours'),
      tone: security.failedSignIns > 0 ? 'warn' : 'ok',
    },
    {
      label: t('Memory'),
      value: bytes(system.heapUsedBytes),
      note: t('of {max}', { max: bytes(system.heapMaxBytes) }),
      ...(system.heapMaxBytes > 0 && system.heapUsedBytes / system.heapMaxBytes > 0.9
        ? { tone: 'problem' as const }
        : {}),
    },
    {
      label: t('Running for'),
      value: duration(system.uptimeSeconds),
      note: t('version {version}, {processors} processors', {
        version: system.version,
        processors: String(system.processors),
      }),
    },
  ];
}

/** What a security event was, in words. */
export function describeEvent(event: SecurityEvent): string {
  switch (event.action) {
    case 'account.sign-in.failed':
      return t('Sign-in refused for {name}', { name: event.subject ?? event.actor });
    default:
      return t('{action} {outcome} for {name}', {
        action: event.action,
        outcome: event.outcome === 'DENIED' ? t('refused') : t('failed'),
        name: event.subject ?? event.actor,
      });
  }
}

/** Where a security event came from, when the audit log knows it. */
export function addressOf(event: SecurityEvent): string | undefined {
  if (!event.detail) {
    return undefined;
  }
  try {
    const detail = JSON.parse(event.detail) as { address?: unknown };
    return typeof detail.address === 'string' ? detail.address : undefined;
  } catch {
    return undefined;
  }
}
