// The levels of access to an item, named the same way everywhere (Share dialog, access requests,
// permissions of a person, guides): View, Edit, Manage.

import { t } from './i18n.ts'

export type Level = 'read' | 'write' | 'manage'

/** The name of a level (`none` for no access). */
export function levelName(l: string): string {
  return { none: t('level.none'), read: t('level.view'), write: t('level.edit'), manage: t('level.manage') }[l] ?? l
}

/** What a level allows, in a few words. */
export function levelHint(l: string): string {
  return { read: t('sees the content'), write: t('edits the content'), manage: t('shares, moves, deletes') }[l] ?? ''
}
