// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import type { AccountSession } from './api.js';
import { t } from './i18n.js';

/** Marks of user agents, the more specific first: Edge also names Chrome, Chrome names Safari. */
const BROWSERS: readonly (readonly [string, string])[] = [
  ['Edg/', 'Edge'],
  ['OPR/', 'Opera'],
  ['Firefox/', 'Firefox'],
  ['Chrome/', 'Chrome'],
  ['Safari/', 'Safari'],
];
const SYSTEMS: readonly (readonly [string, string])[] = [
  ['Windows', 'Windows'],
  ['Android', 'Android'],
  ['iPhone', 'iPhone'],
  ['iPad', 'iPad'],
  ['Mac OS', 'macOS'],
  ['Linux', 'Linux'],
];

function first(agent: string, marks: readonly (readonly [string, string])[]): string {
  return marks.find(([mark]) => agent.includes(mark))?.[1] ?? '';
}

/** A short name of the browser and system of a session (MK-125), from its user agent. */
export function describeDevice(session: Pick<AccountSession, 'userAgent'>): string {
  const agent = session.userAgent ?? '';
  const browser = first(agent, BROWSERS);
  const system = first(agent, SYSTEMS);
  if (browser && system) {
    return t('{browser} on {system}', { browser, system });
  }
  return browser || system || (agent ? agent.slice(0, 60) : t('Unknown device'));
}
