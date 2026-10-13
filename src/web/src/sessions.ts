// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import type { AccountSession, KernelClient } from './api.js';
import { language, t } from './i18n.js';

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

/** The second line of a session: when it was opened and last used, from where, and how. */
export function describeUse(session: AccountSession): string {
  const used = t('Signed in {created} · last used {seen}', {
    created: when(session.createdAt),
    seen: when(session.lastSeenAt),
  });
  const address = session.address ? ` · ${session.address}` : '';
  const realm = session.kind === 'realm' ? ` · ${t('through your organization')}` : '';
  return used + address + realm;
}

/** A date and time in the language of the shell; the value as it is when it is not one. */
export function when(instant: string): string {
  const date = new Date(instant);
  return Number.isNaN(date.getTime())
    ? instant
    : date.toLocaleString(language(), { dateStyle: 'medium', timeStyle: 'short' });
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** What the list of sessions tells the page around it. */
export interface SessionListEvents {
  /** The list changed: render it again. */
  changed(): void;
  /** A message for the status region of the page. */
  announce(message: string): void;
  /** The person ended the session of this browser. */
  signedOut(): void;
}

/**
 * The live sessions of the signed-in person in their settings (MK-125), without the view: reads
 * them, ends one, and says what happened.
 */
export class SessionList {
  sessions: readonly AccountSession[] | undefined;

  constructor(
    private readonly client: Pick<KernelClient, 'sessions' | 'endSession'> | undefined,
    private readonly events: SessionListEvents,
  ) {}

  async load(): Promise<void> {
    try {
      this.sessions = await this.client?.sessions();
    } catch (error) {
      this.events.announce(t('The sessions cannot be read: {reason}', { reason: reason(error) }));
    }
    this.events.changed();
  }

  /** Ends a session; ending the one of this browser signs it out. */
  async end(session: AccountSession): Promise<void> {
    try {
      await this.client?.endSession(session.id);
    } catch (error) {
      this.events.announce(t('The session was not ended: {reason}', { reason: reason(error) }));
      await this.load();
      return;
    }
    if (session.current) {
      this.events.signedOut();
      return;
    }
    this.sessions = this.sessions?.filter((other) => other.id !== session.id);
    this.events.announce(t('Session ended: {device}', { device: describeDevice(session) }));
    this.events.changed();
  }
}
