// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import type { KernelClient, Quota, QuotaSource, QuotaUsage, QuotaUsageRow } from './api.js';
import { t } from './i18n.js';

const BYTE_UNITS = ['KB', 'MB', 'GB', 'TB', 'PB'] as const;

/** An amount in the unit of its measure: bytes in KB, MB, GB of 1024, as the settings read `10G`. */
export function formatAmount(amount: number, unit: string): string {
  if (unit !== 'bytes') {
    return `${String(amount)} ${unit}`.trim();
  }
  if (Math.abs(amount) < 1024) {
    return t('{count} bytes', { count: String(amount) });
  }
  let value = amount;
  let index = -1;
  while (Math.abs(value) >= 1024 && index < BYTE_UNITS.length - 1) {
    value /= 1024;
    index++;
  }
  const number = value.toFixed(1).replace(/\.0$/, '');
  return `${number} ${BYTE_UNITS[index] ?? 'PB'}`;
}

/** The limit of a measure as people read it, per month for a counter. */
export function limitLabel(quota: Pick<Quota, 'limit' | 'unit' | 'kind'>): string {
  if (quota.limit === null) {
    return t('No limit');
  }
  const amount = formatAmount(quota.limit, quota.unit);
  return quota.kind === 'counter' ? t('{amount} a month', { amount }) : amount;
}

/** Where a limit comes from. */
export function sourceLabel(source: QuotaSource): string {
  switch (source) {
    case 'organization':
      return t('Set for this organization');
    case 'installation':
      return t('Default of the platform');
    default:
      return t('No limit');
  }
}

/** The share of the limit used, from 0 to 100, or `undefined` without a limit. */
export function share(quota: Pick<Quota, 'limit' | 'used'>): number | undefined {
  if (quota.limit === null) {
    return undefined;
  }
  if (quota.limit === 0) {
    return quota.used > 0 ? 100 : 0;
  }
  return Math.min(100, Math.round((quota.used / quota.limit) * 100));
}

/** The person of a row of consumption, or who it stands for when there is none. */
export function personLabel(row: Pick<QuotaUsageRow, 'person'>): string {
  if (!row.person) {
    return t('Nobody in particular');
  }
  return row.person.name ?? row.person.email ?? t('A person who left');
}

/** The period of a row: the month of a counter, or now for a gauge. */
export function periodLabel(period: string | null): string {
  return period ?? t('Now');
}

/**
 * Reads a limit typed by a platform administrator: empty for none, a whole number, or for bytes a
 * size such as `500M` or `10G`. `undefined` when it is not one.
 */
export function parseLimit(text: string, unit: string): number | null | undefined {
  const value = text.trim();
  if (value === '') {
    return null;
  }
  const match = /^(\d+)\s*([KMGT]?)B?$/i.exec(value);
  if (!match) {
    return undefined;
  }
  const suffix = (match[2] ?? '').toUpperCase();
  if (suffix && unit !== 'bytes') {
    return undefined;
  }
  const power = suffix ? 'KMGT'.indexOf(suffix) + 1 : 0;
  const limit = Number(match[1]) * 1024 ** power;
  return Number.isSafeInteger(limit) ? limit : undefined;
}

/** What the page of quotas tells the page around it. */
export interface QuotaBoardEvents {
  /** The data changed: render again. */
  changed(): void;
  /** A message for the status region of the page, and whether something failed. */
  announce(message: string, failed: boolean): void;
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The quotas of an organization for its administrators (MK-076), without the view: the measures
 * with their limits, the consumption of a month by person, and for platform administrators the
 * limits of the organization.
 */
export class QuotaBoard {
  quotas: readonly Quota[] | undefined;
  usage: QuotaUsage | undefined;

  constructor(
    private readonly client:
      Pick<KernelClient, 'quotas' | 'quotaUsage' | 'setQuota' | 'removeQuota'> | undefined,
    private readonly organization: string | undefined,
    private readonly events: QuotaBoardEvents,
  ) {}

  /** Reads the measures and the consumption of a month, this month when none is given. */
  async load(period?: string): Promise<void> {
    if (!this.client || !this.organization) {
      return;
    }
    try {
      const [quotas, usage] = await Promise.all([
        this.client.quotas(this.organization),
        this.client.quotaUsage(this.organization, period),
      ]);
      this.quotas = quotas;
      this.usage = usage;
    } catch (error) {
      this.events.announce(
        t('The quotas cannot be read: {reason}', { reason: reason(error) }),
        true,
      );
    }
    this.events.changed();
  }

  /** The measure of an identifier, for the label and unit of a row. */
  measure(id: string): Quota | undefined {
    return this.quotas?.find((quota) => quota.measure === id);
  }

  /** The rows of consumption of a measure, largest first, as the kernel sends them. */
  rowsOf(measure: string): QuotaUsageRow[] {
    return (this.usage?.rows ?? []).filter((row) => row.measure === measure);
  }

  /** The months to choose from: those with consumption, and the one shown. */
  periods(): string[] {
    const periods = new Set(this.usage?.periods ?? []);
    if (this.usage) {
      periods.add(this.usage.period);
    }
    return [...periods].sort().reverse();
  }

  /**
   * Sets the limit of a measure from what a platform administrator typed: empty for none. Answers
   * whether it was saved.
   */
  async setLimit(quota: Quota, text: string): Promise<boolean> {
    if (!this.client || !this.organization) {
      return false;
    }
    const limit = parseLimit(text, quota.unit);
    if (limit === undefined) {
      this.events.announce(
        quota.unit === 'bytes'
          ? t('Write a number of bytes, or a size such as 500M or 10G; empty for no limit.')
          : t('Write a whole number; empty for no limit.'),
        true,
      );
      return false;
    }
    try {
      this.replace(await this.client.setQuota(this.organization, quota.measure, limit));
      this.events.announce(
        t('Limit of {measure} set: {limit}.', {
          measure: quota.label,
          limit: limitLabel({ ...quota, limit }),
        }),
        false,
      );
      return true;
    } catch (error) {
      this.events.announce(t('Not saved: {reason}', { reason: reason(error) }), true);
      return false;
    }
  }

  /** Goes back to the default of the platform for a measure. */
  async removeLimit(quota: Quota): Promise<void> {
    if (!this.client || !this.organization) {
      return;
    }
    try {
      const updated = await this.client.removeQuota(this.organization, quota.measure);
      this.replace(updated);
      this.events.announce(
        t('Limit of {measure}: {limit}, the default of the platform.', {
          measure: quota.label,
          limit: limitLabel(updated),
        }),
        false,
      );
    } catch (error) {
      this.events.announce(t('Not saved: {reason}', { reason: reason(error) }), true);
    }
  }

  private replace(updated: Quota): void {
    this.quotas = this.quotas?.map((quota) =>
      quota.measure === updated.measure ? updated : quota,
    );
    this.events.changed();
  }
}
