// STEP 5 - the rules of the UI that do not need a screen, kept apart so that they are tested without one.

export interface TaskValues {
  done?: unknown
  due?: unknown
}

/** `YYYY-MM-DD` of a date, in the local time zone (the format of the fields of kind `date`). */
export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const isDone = (v: TaskValues): boolean => v.done === true

/** Open and past its due date. */
export function isOverdue(v: TaskValues, today = isoDay(new Date())): boolean {
  return !isDone(v) && typeof v.due === 'string' && v.due !== '' && v.due < today
}

/** The pages of the navigation (`[[nav]]` of the manifest): which tasks each one shows. */
export function pageFilter(at: string | undefined): (v: TaskValues) => boolean {
  if (at === 'done') return isDone
  if (at === 'all') return () => true
  return (v) => !isDone(v)
}
