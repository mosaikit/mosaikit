// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import type { KernelClient, PersonState, PlatformPerson } from './api.js';
import { type Metric, count } from './admin-view.js';
import { t } from './i18n.js';

/** How many people a page of the console lists. */
export const PAGE_SIZE = 50;

/** What the people tell the page around them. */
export interface PeopleEvents {
  changed(): void;
  announce(message: string, failed: boolean): void;
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The organizations of a person, as the table shows them. */
export function organizationsOf(person: PlatformPerson): string {
  return person.organizations
    .map((organization) =>
      organization.roles.includes('organization-admin')
        ? t('{name} (administrator)', { name: organization.name })
        : organization.name,
    )
    .join(', ');
}

/**
 * The people of the installation for the console of the platform administrators (MK-072), without
 * the view: a page of them found by a text and a state, and how many there are in all.
 */
export class PeopleDirectory {
  search = '';
  state: PersonState = 'all';
  offset = 0;
  /** The people of the page. */
  people: readonly PlatformPerson[] | undefined;
  /** How many people match the search and the state. */
  matching = 0;
  /** How many people the installation has, and how many are suspended. */
  totals: { readonly people: number; readonly suspended: number } | undefined;

  constructor(
    private readonly client: Pick<KernelClient, 'people'> | undefined,
    private readonly events: PeopleEvents,
  ) {}

  /** Reads the page of the current search, state and offset, and the totals. */
  async load(): Promise<void> {
    if (!this.client) {
      return;
    }
    try {
      const [page, everybody, suspended] = await Promise.all([
        this.client.people({
          search: this.search,
          state: this.state,
          offset: this.offset,
          limit: PAGE_SIZE,
        }),
        this.client.people({ limit: 1 }),
        this.client.people({ state: 'suspended', limit: 1 }),
      ]);
      this.people = page.people;
      this.matching = page.total;
      this.totals = { people: everybody.total, suspended: suspended.total };
    } catch (error) {
      this.events.announce(
        t('The people cannot be read: {reason}', { reason: reason(error) }),
        true,
      );
    }
    this.events.changed();
  }

  /** Looks for other people: back to the first page. */
  async filter(search: string, state: PersonState): Promise<void> {
    this.search = search;
    this.state = state;
    this.offset = 0;
    await this.load();
  }

  /** Whether there are people after this page. */
  get hasNext(): boolean {
    return this.offset + PAGE_SIZE < this.matching;
  }

  /** Whether there are people before this page. */
  get hasPrevious(): boolean {
    return this.offset > 0;
  }

  /** Moves to the next page, or the previous one with a negative step. */
  async page(step: 1 | -1): Promise<void> {
    this.offset = Math.max(0, this.offset + step * PAGE_SIZE);
    await this.load();
  }

  /** The metrics on top of the page of people. */
  metrics(): Metric[] {
    if (!this.totals) {
      return [];
    }
    const { people, suspended } = this.totals;
    return [
      { label: t('People'), value: count(people) },
      { label: t('Active'), value: count(people - suspended), tone: 'ok' },
      {
        label: t('Suspended'),
        value: count(suspended),
        note: t('They sign in by no means.'),
        ...(suspended > 0 ? { tone: 'warn' as const } : {}),
      },
      {
        label: t('Found'),
        value: count(this.matching),
        note: t('With the filters above the table.'),
      },
    ];
  }
}
