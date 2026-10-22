// Notifications of whoever signed in, from the kernel (`/api/me/notifications`), with the number of the
// unread ones kept live by the stream of the person (`/api/me/stream`, server-sent events): the bell and
// the menu of the person update as soon as something arrives, in every open tab.

import { useEffect } from 'react'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { api, appUrl } from '../api.ts'
import type { Session } from '../types.ts'
import { useAction } from './core.ts'
import { t } from './i18n.ts'

export type NoteKind = 'invitation' | 'share' | 'link' | 'plugin' | 'system'

export interface Note {
  id: string
  kind: NoteKind
  title: string
  body: string
  link: string
  source: string
  tenant_slug: string | null
  tenant_name: string | null
  resource_id: string | null
  data: Record<string, unknown>
  read: boolean
  created_at: string
}

export interface NotePage {
  items: Note[]
  unread: number
  next: string | null
}

export interface NoteFilter {
  unread?: boolean
  kind?: string
  days?: number
  q?: string
  before?: string
  limit?: number
}

export const KINDS: NoteKind[] = ['invitation', 'share', 'link', 'plugin', 'system']

export function kindLabel(k: NoteKind): string {
  return {
    invitation: t('Invitations'),
    share: t('Shared with you'),
    link: t('Public links'),
    plugin: t('From the apps'),
    system: t('Platform'),
  }[k]
}

function query(f: NoteFilter): string {
  const q = new URLSearchParams()
  if (f.unread) q.set('unread', 'true')
  if (f.kind) q.set('kind', f.kind)
  if (f.days) q.set('days', String(f.days))
  if (f.q?.trim()) q.set('q', f.q.trim())
  if (f.before) q.set('before', f.before)
  if (f.limit) q.set('limit', String(f.limit))
  const s = q.toString()
  return `/api/me/notifications${s ? '?' + s : ''}`
}

export function useNoteList(f: NoteFilter) {
  return useQuery({ queryKey: ['notes', 'list', f], queryFn: () => api<NotePage>('GET', query(f)) })
}

export function useUnread() {
  return useQuery({ queryKey: ['notes', 'count'], queryFn: () => api<{ unread: number }>('GET', '/api/me/notifications/count').then((r) => r.unread) })
}

function refresh(qc: QueryClient, unread?: number) {
  if (unread !== undefined) qc.setQueryData(['notes', 'count'], unread)
  void qc.invalidateQueries({ queryKey: ['notes', 'list'] })
}

/** The live stream of the person: mounted once by the shell. */
export function useLiveNotes(session: Session) {
  const qc = useQueryClient()
  const user = session.user.user_id
  useEffect(() => {
    if (typeof EventSource === 'undefined') return
    const es = new EventSource(appUrl('/api/me/stream'))
    es.onmessage = (ev) => {
      try {
        const m = JSON.parse(ev.data as string) as { event: string; unread: number }
        refresh(qc, m.unread)
        // an invitation arrives with its buttons: the list of the open ones changes too
        if (m.event === 'notification') void qc.invalidateQueries({ queryKey: ['my-invitations'] })
      } catch {
        /* not an event of ours */
      }
    }
    // the browser reconnects by itself; on the way back the first event brings the count again
    return () => es.close()
  }, [qc, user])
}

export function useNoteActions() {
  const qc = useQueryClient()
  const after = (r: unknown) => refresh(qc, (r as { unread?: number } | null)?.unread)
  const mark = useAction(({ ids, read }: { ids: string[]; read: boolean }) => api('POST', '/api/me/notifications/read', { ids, read }).then(after))
  const markAll = useAction(() => api('POST', '/api/me/notifications/read-all').then(after))
  const remove = useAction((ids: string[]) => api('POST', '/api/me/notifications/delete', { ids }).then(after), { ok: (ids) => t('{n} deleted', { n: String(ids.length) }) })
  const answer = useAction(({ id, accept }: { id: string; accept: boolean }) => api('POST', `/api/me/invitations/${id}/${accept ? 'accept' : 'decline'}`).then(() => refresh(qc)), {
    ok: ({ accept }) => (accept ? t('Invitation accepted: the tenant is in the switcher at the top') : t('Invitation declined')),
    invalidate: [['my-invitations'], ['session']],
  })
  return { mark, markAll, remove, answer }
}

/** The title in the language of the person, from the code of the kernel; otherwise the text as sent. */
export function noteTitle(n: Note): string {
  const d = n.data as Record<string, string>
  switch (d.code) {
    case 'invitation.received':
      return t('{by} invited you to {tenant}', { by: d.by, tenant: d.tenant })
    case 'invitation.accepted':
      return t('{person} accepted the invitation to {tenant}', { person: d.person, tenant: d.tenant })
    case 'invitation.declined':
      return t('{person} declined the invitation to {tenant}', { person: d.person, tenant: d.tenant })
    case 'share.received':
      return d.item ? t('{by} shared «{item}» with you', { by: d.by, item: d.item }) : t('{by} shared an item with you', { by: d.by })
    case 'link.created':
      return t('{by} created a public link to «{item}»', { by: d.by, item: d.item })
    case 'access.requested':
      return d.level === 'write' ? t('{by} asks to edit «{item}»', { by: d.by, item: d.item }) : t('{by} asks to see «{item}»', { by: d.by, item: d.item })
    case 'access.forwarded':
      return t('{by} leaves to you the request of {who}', { by: d.by, who: d.who })
    case 'access.approved':
      return t('{by} gave you access to «{item}»', { by: d.by, item: d.item })
    case 'access.refused':
      return t('{by} refused your request for «{item}»', { by: d.by, item: d.item })
    case 'plugin.available':
      return t('{plugin} is available to the tenant', { plugin: d.plugin })
    case 'plugin.unavailable':
      return t('{plugin} is no longer available to the tenant', { plugin: d.plugin })
    case 'quota.alert': {
      const q = ({ storage: t('Storage'), people: t('People'), items: t('Items') } as Record<string, string>)[d.metric] ?? d.metric
      if (d.level === '100') return t('{quota} of {tenant}: the quota is used up, additions stop', { quota: q, tenant: d.tenant })
      if (d.level === 'forecast') return t('{quota} of {tenant}: at this pace the quota is used up in about {n} days', { quota: q, tenant: d.tenant, n: String(d.days ?? '') })
      return t('{quota} of {tenant}: {p}% of the quota', { quota: q, tenant: d.tenant, p: String(d.percent) })
    }
    case 'tenant.trial_ending':
      return t('The trial of {tenant} ends on {date}', { tenant: d.tenant, date: d.until })
    case 'tenant.trial_ended':
      return t('The trial of {tenant} ended: the tenant is suspended', { tenant: d.tenant })
    case 'backup.failed':
      return t('The backup failed')
    case 'alert.raised':
      return t('Alert: {detail}', { detail: d.detail })
    default:
      return n.title
  }
}

export function noteBody(n: Note): string {
  const d = n.data as Record<string, string>
  switch (d.code) {
    case 'invitation.received':
      return t('You can work in {tenant} as {role}: accept or decline.', { tenant: d.tenant, role: d.role === 'tenant_manager' ? 'Tenant Manager' : t('User') })
    case 'share.received':
      return t('In {tenant}.', { tenant: d.tenant })
    case 'link.created':
      return t('Whoever has the link can open the item without signing in.')
    case 'invitation.accepted':
    case 'invitation.declined':
    case 'access.approved':
    case 'access.refused':
      return ''
    case 'access.forwarded':
      return t('Approve or refuse in Access requests.')
    case 'plugin.available':
      return t('Turn it on in Plugins to give it to the people of the tenant.')
    case 'plugin.unavailable':
      return t('The Administrator took it back: the people of the tenant no longer see it.')
    case 'tenant.trial_ending':
      return t('At the end the tenant is suspended; the data stay')
    case 'tenant.trial_ended':
      return t('Reactivate it or extend the trial from its page.')
    case 'alert.raised':
      return t('See Monitoring for the state of the platform.')
    default:
      return n.body
  }
}

/** The invitation to answer, if the notification is about one still open. */
export function pendingInvitation(n: Note): string | null {
  const d = n.data as Record<string, string>
  return d.code === 'invitation.received' && !n.read && typeof d.invitation_id === 'string' ? d.invitation_id : null
}
