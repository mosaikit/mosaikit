// Many people at once, as in the mockup (members/people, dlg-invite): import from a CSV file with a
// preview of the rows and their problems before anything is created, and invitations of several people of
// other tenants at once. The server answers row by row; the report shows what was done and what not.

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { api, ApiError, errText } from '../api.ts'
import type { Profile } from '../types.ts'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { parseCsv, type ImportRow } from './csv.ts'
import { t } from './i18n.ts'
import { ListTable } from './ListTable.tsx'

const enc = encodeURIComponent

interface Outcome {
  row: number
  who: string
  ok: boolean
  code: string | null
  message: string
  link: string | null
  emailed: boolean
}

function Report({ rows }: { rows: Outcome[] }) {
  const ok = rows.filter((r) => r.ok).length
  return (
    <div className="grid gap-2">
      <p role="status" className="text-sm">
        {t('{ok} done, {ko} not done', { ok, ko: rows.length - ok })}
      </p>
      <ListTable
        fit="inline"
        rows={rows}
        rowKey={(r) => r.row}
        label={t('Result of every row')}
        searchLabel={t('Filter the list')}
        columns={[
          { key: 'row', title: t('Row'), width: '4rem', sort: (r) => r.row, cell: (r) => <span className="tabular-nums">{r.row}</span> },
          { key: 'who', title: t('Person'), width: 'minmax(8rem,1fr)', sort: (r) => r.who, cell: (r) => <span className="font-mono text-xs">{r.who}</span> },
          {
            key: 'result',
            title: t('Result'),
            width: 'minmax(12rem,2fr)',
            sort: (r) => (r.ok ? 0 : 1),
            text: (r) => (r.ok ? '' : errText(new ApiError(r.message, 400, r.code ?? undefined))),
            cell: (r) => (
              <span className={r.ok ? 'text-ok' : 'text-destructive'}>
                {r.ok ? (r.link ? (r.emailed ? t('Created: the link to choose a password was emailed') : t('Created: give the person the link to choose a password')) : t('Done')) : errText(new ApiError(r.message, 400, r.code ?? undefined))}
                {r.ok && r.link && !r.emailed && <span className="block break-all font-mono text-[11px] text-muted-foreground">{r.link}</span>}
              </span>
            ),
          },
        ]}
      />
    </div>
  )
}

/** Import from CSV: choose the file, look at the rows, create the people. */
export function ImportDialog({ slug, open, onOpenChange }: { slug: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient()
  const [rows, setRows] = useState<ImportRow[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<Outcome[] | null>(null)
  const [error, setError] = useState('')
  const close = (o: boolean) => {
    if (!o) {
      setRows(null)
      setReport(null)
      setError('')
    }
    onOpenChange(o)
  }
  const good = (rows ?? []).filter((r) => !r.problem)
  async function send() {
    setBusy(true)
    setError('')
    try {
      const body = { rows: good.map((r) => ({ username: r.username, display_name: r.display_name, email: r.email || null, role: r.role, profile: r.profile, groups: r.groups })) }
      setReport(await api<Outcome[]>('POST', `/api/t/${enc(slug)}/manage/people/import`, body))
      void qc.invalidateQueries({ queryKey: ['members', slug] })
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('Import from CSV')}</DialogTitle>
          <DialogDescription>{t('One person per row, with a header: username, name, email (required), role, profile, groups (separated by «|»). Each person gets a link to choose a password.')}</DialogDescription>
        </DialogHeader>
        {report ? (
          <Report rows={report} />
        ) : (
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="csv-file">{t('CSV file')}</Label>
              <Input id="csv-file" type="file" accept=".csv,text/csv" onChange={(e) => void e.target.files?.[0]?.text().then((x) => setRows(parseCsv(x)))} />
            </div>
            {rows && (
              <ListTable
                fit="inline"
                rows={rows}
                rowKey={(r) => rows.indexOf(r)}
                label={t('Rows of the file')}
                searchLabel={t('Filter the list')}
                columns={[
                  { key: 'username', title: t('Username'), sort: (r) => r.username, cell: (r) => <span className="font-mono text-xs">{r.username}</span> },
                  { key: 'name', title: t('Name'), sort: (r) => r.display_name, cell: (r) => r.display_name },
                  { key: 'role', title: t('Role'), sort: (r) => r.role, text: (r) => (r.role === 'tenant_manager' ? t('Tenant Manager') : t('User')), cell: (r) => (r.role === 'tenant_manager' ? t('Tenant Manager') : t('User')) },
                  { key: 'groups', title: t('Groups'), sort: (r) => r.groups.join(', '), cell: (r) => <span className="text-xs">{r.groups.join(', ')}</span> },
                  { key: 'check', title: t('Check'), sort: (r) => r.problem ?? '', text: (r) => r.problem ?? t('OK'), cell: (r) => <span className={r.problem ? 'text-destructive' : 'text-ok'}>{r.problem ?? t('OK')}</span> },
                ]}
              />
            )}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
        )}
        <DialogFooter>
          {report ? (
            <Button onClick={() => close(false)}>{t('Close')}</Button>
          ) : (
            <Button disabled={busy || !good.length} onClick={() => void send()}>
              {busy && <Loader2 className="animate-spin" />}
              {t('Create {n} people', { n: good.length })}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Invite several people of other tenants at once: one `username@tenant` per line. */
export function InviteManyDialog({ slug, profiles, open, onOpenChange }: { slug: string; profiles: Profile[]; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient()
  const [text, setText] = useState('')
  const [role, setRole] = useState<'user' | 'tenant_manager'>('user')
  const [profile, setProfile] = useState('')
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<Outcome[] | null>(null)
  const [error, setError] = useState('')
  const people = text.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean)
  const close = (o: boolean) => {
    if (!o) {
      setText('')
      setReport(null)
      setError('')
    }
    onOpenChange(o)
  }
  async function send() {
    setBusy(true)
    setError('')
    try {
      setReport(await api<Outcome[]>('POST', `/api/t/${enc(slug)}/manage/invitations/many`, { people, role, profile: profile || null }))
      void qc.invalidateQueries({ queryKey: ['invites', slug] })
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('Invite several people')}</DialogTitle>
          <DialogDescription>{t('People of other tenants, one per line as username@tenant. They join as guests.')}</DialogDescription>
        </DialogHeader>
        {report ? (
          <Report rows={report} />
        ) : (
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="inv-many">{t('People')}</Label>
              <Textarea id="inv-many" rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder="anna@regione-lazio" />
            </div>
            <div className="grid gap-1.5 sm:grid-cols-2 sm:gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="inv-role">{t('Role')}</Label>
                <select id="inv-role" className="h-9 rounded-md border bg-background px-2 text-sm" value={role} onChange={(e) => setRole(e.target.value as 'user' | 'tenant_manager')}>
                  <option value="user">{t('User')}</option>
                  <option value="tenant_manager">{t('Tenant Manager')}</option>
                </select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="inv-profile">{t('Permission profile')}</Label>
                <select id="inv-profile" className="h-9 rounded-md border bg-background px-2 text-sm" value={profile} onChange={(e) => setProfile(e.target.value)}>
                  <option value="">{t('Default profile')}</option>
                  {profiles
                    .filter((p) => !p.is_default)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </div>
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
        )}
        <DialogFooter>
          {report ? (
            <Button onClick={() => close(false)}>{t('Close')}</Button>
          ) : (
            <Button disabled={busy || !people.length} onClick={() => void send()}>
              {busy && <Loader2 className="animate-spin" />}
              {t('Send {n} invitations', { n: people.length })}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
