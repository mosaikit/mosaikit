// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { t } from './i18n.js';

/**
 * A metric at the top of an administration page (MK-072): a number with its label and, below it, what
 * it means. The tone colours it: `ok`, `warn` for what needs a look, `problem` for what is wrong.
 */
export interface Metric {
  readonly label: string;
  readonly value: string;
  readonly note?: string;
  readonly tone?: 'ok' | 'warn' | 'problem';
}

/** Whether a text, written in a filter, is found in one of the fields of a row, whatever the case. */
export function matchesText(
  search: string,
  ...fields: readonly (string | null | undefined)[]
): boolean {
  const wanted = search.trim().toLocaleLowerCase();
  if (!wanted) {
    return true;
  }
  return fields.some((field) => field?.toLocaleLowerCase().includes(wanted) === true);
}

/** A count for a metric, grouped by thousands in the language of the page. */
export function count(value: number): string {
  return value.toLocaleString();
}

/** A size in bytes, in the largest unit below it: 512 MB, 1.5 GB. */
export function bytes(value: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = Math.max(0, value);
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit++;
  }
  const shown = unit === 0 || size >= 10 ? Math.round(size) : Math.round(size * 10) / 10;
  return `${String(shown)} ${units[unit] ?? 'B'}`;
}

/** How long something has been running, in its two largest units: 3 d 4 h, 5 h 12 min, 40 s. */
export function duration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  if (days > 0) {
    return t('{days} d {hours} h', { days: String(days), hours: String(hours) });
  }
  if (hours > 0) {
    return t('{hours} h {minutes} min', { hours: String(hours), minutes: String(minutes) });
  }
  if (minutes > 0) {
    return t('{minutes} min', { minutes: String(minutes) });
  }
  return t('{seconds} s', { seconds: String(total) });
}
