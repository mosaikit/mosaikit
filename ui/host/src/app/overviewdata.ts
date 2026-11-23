// Small helpers of the overviews that are not components.

import { t } from './i18n.ts'

/** Good morning, afternoon or evening, by the hour of the person. */
export function greeting(): string {
  const h = new Date().getHours()
  return h < 12 ? t('Good morning') : h < 18 ? t('Good afternoon') : t('Good evening')
}

/** A day as `YYYY-MM-DD` in the local time. */
export const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** The last seven days, oldest first, of a list of timestamps: how many fall on each day. */
export function perDay(stamps: string[], now: Date, n = 7): number[] {
  const keys = Array.from({ length: n }, (_, i) => dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - (n - 1 - i))))
  return keys.map((k) => stamps.filter((s) => dayKey(new Date(s)) === k).length)
}
