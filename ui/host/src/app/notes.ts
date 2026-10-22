// Le notifiche di chi e' entrato: oggi gli inviti in altri tenant (`/api/me/invitations`), con lo stato
// «letta» tenuto nel browser finche' il kernel non avra' l'API delle notifiche.

import { useSyncExternalStore } from 'react'
import type { Invitation, Session } from '../types.ts'
import { useApi } from './core.ts'
import { t } from './i18n.ts'

export interface Note {
  id: string
  title: string
  body: string
  when: string
  read: boolean
  invitation?: Invitation
}

// Lette o no: per ora nel browser (prototipo), finche' il kernel non ha lo stato delle notifiche.
const READ = 'msk_read_notes'
function readSet(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(READ) ?? '[]') as string[])
  } catch {
    return new Set()
  }
}
let read = readSet()
const listeners = new Set<() => void>()
function markRead(ids: string[]) {
  read = new Set([...read, ...ids])
  try {
    localStorage.setItem(READ, JSON.stringify([...read].slice(-500)))
  } catch {
    /* storage non disponibile */
  }
  listeners.forEach((l) => l())
}
function useRead(): Set<string> {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => read,
  )
}

export function useNotes(session: Session) {
  const q = useApi<Invitation[]>(['my-invitations'], session.user.is_system_admin ? null : '/api/me/invitations')
  const seen = useRead()
  const notes: Note[] = (q.data ?? []).map((i) => ({
    id: `inv:${i.id}`,
    title: t('Invito in {tenant}', { tenant: i.tenant_name }),
    body: t('{who} ti invita come {role}', { who: i.invited_by ?? t('Un Tenant Manager'), role: i.role === 'tenant_manager' ? 'Tenant Manager' : 'User' }),
    when: i.created_at,
    read: seen.has(`inv:${i.id}`),
    invitation: i,
  }))
  return { notes, unread: notes.filter((n) => !n.read).length, isLoading: q.isLoading, markAll: () => markRead(notes.map((n) => n.id)), mark: (id: string) => markRead([id]) }
}
