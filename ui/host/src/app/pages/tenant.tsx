// Pagine di un tenant: Home o panoramica, app (nell'iframe) e, per il Tenant Manager, la gestione del
// tenant: Persone, Plugin, Condivisioni, Consumi e Impostazioni del tenant (docs/refactoring-ui.md §2).

import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Gauge, Grid2x2, KeyRound, Mail, MoreHorizontal, Palette, Plus, Puzzle, Share2, ShieldCheck, Trash2, UserRound, Users } from 'lucide-react'
import { api, appUrl, fmtBytes, fmtDate } from '../../api.ts'
import PluginFrame from '../../components/PluginFrame.tsx'
import { UiContext, useUi, type Ui } from '../../ui-context.ts'
import ShareDialog from '../ShareDialog.tsx'
import type { Group, Invitation, LinkInfo, Member, Overview, ResourceRow, Session, TenantContext, TenantKpi, TenantSettings } from '../../types.ts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { initials, useAction, useApi, useConfirm, useTenantCtx } from '../core.ts'
import { t, useLang } from '../i18n.ts'
import { Empty, ErrorBox, FormDialog, Kpi, Loading, Locked, PageHeader, Pills, PluginKpis, SaveBar, Sections, StatusBadge } from '../kit.tsx'
import { go, to } from '../router.ts'
import { effectiveMode, useTheme } from '../theme.ts'
import AppIcon from '../AppIcon.tsx'
import { TenantTheme } from '../ThemeSettings.tsx'

const enc = encodeURIComponent
const ROLE: Record<string, string> = { tenant_manager: 'Tenant Manager', user: 'User' }

/* ── Panoramica ──────────────────────────────────────────────────────── */

export function TenantHome({ session, slug }: { session: Session; slug: string }) {
  const ctx = useTenantCtx(slug)
  const o = useApi<Overview>(['overview', slug], `/api/t/${enc(slug)}/overview`)
  if (ctx.isLoading || o.isLoading) return <Loading />
  if (ctx.error) return <ErrorBox error={ctx.error} />
  const c = ctx.data!
  const d = o.data
  const mine = d?.me.resources.reduce((s, r) => s + r.count, 0) ?? 0
  return (
    <>
      <PageHeader
        title={c.tenant.role === 'tenant_manager' ? t('Panoramica del tenant') : t('Home')}
        sub={`${t('Ciao')} ${session.user.display_name || session.user.username} · ${ROLE[c.tenant.role]} in ${c.tenant.name}`}
      />
      <div className="grid gap-6 p-6 max-[620px]:p-4">
        {d && (
          <section className="grid gap-3">
            <h2 className="text-sm font-semibold">{t('Il tuo spazio')}</h2>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3">
              <Kpi label={t('Risorse tue')} value={mine} hint={fmtBytes(d.me.resources.reduce((s, r) => s + r.bytes, 0))} />
              <Kpi label={t('Condivisi da me')} value={d.me.shared_by_me} />
              <Kpi label={t('Condivisi con me')} value={d.me.shared_with_me} />
              <Kpi label={t('Miei link pubblici attivi')} value={d.me.public_links} hint={t('{n} visite', { n: d.me.link_views })} />
            </div>
          </section>
        )}
        {d?.tenant && (
          <section className="grid gap-3">
            <h2 className="text-sm font-semibold">Il tenant {c.tenant.name}</h2>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3">
              <Kpi label={t('Membri')} value={d.tenant.members} hint={`${d.tenant.guests} ospiti`} onClick={() => go(to.tenant(slug, 'manage'))} />
              <Kpi label={t('Utenti attivi (30 gg)')} value={d.tenant.active_users_30d} />
              <Kpi label={t('Risorse')} value={d.tenant.resources.reduce((s, r) => s + r.count, 0)} />
              <Kpi label={t('Condivisioni')} value={d.tenant.shares} hint={`${d.tenant.public_links} link pubblici`} onClick={() => go(to.tenant(slug, 'shares'))} />
            </div>
          </section>
        )}
        <section className="grid gap-3">
          <h2 className="text-sm font-semibold">{t('App')}</h2>
          {c.plugins.length === 0 ? (
            <Empty icon={<Grid2x2 />} title={t('Nessuna app attiva')}>
              {t('Un Administrator le installa e le attiva.')}
            </Empty>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
              {c.plugins.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => go(to.plugin(slug, p.id))}
                  className="flex flex-col gap-1.5 rounded-xl border bg-card p-4 text-left hover:border-primary/50 hover:bg-accent/40"
                >
                  <AppIcon id={p.id} className="size-[22px] fill-current text-primary [fill-opacity:0.12]" />
                  <b className="text-base font-semibold">{p.label}</b>
                  <span className="line-clamp-2 text-xs text-muted-foreground">{p.description}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  )
}

/* ── Plugin ──────────────────────────────────────────────────────────── */

/** In sviluppo il server avvisa quando un plugin cambia: l'iframe si ricarica (hot reload). */
function useDevReload(session: Session, slug: string): Record<string, number> {
  const qc = useQueryClient()
  const [reloads, setReloads] = useState<Record<string, number>>({})
  useEffect(() => {
    if (!session.dev) return
    const es = new EventSource(appUrl('/api/dev/events'))
    es.onmessage = (m) => {
      try {
        const ev = JSON.parse(m.data) as { type: string; id: string; what?: string; error?: string }
        if (ev.type === 'plugin_changed') {
          setReloads((r) => ({ ...r, [ev.id]: (r[ev.id] ?? 0) + 1 }))
          if (ev.what === 'schema') void qc.invalidateQueries({ queryKey: ['ctx', slug] })
          toast(`${ev.id}: ${ev.what === 'ui' ? t('interfaccia aggiornata') : ev.what === 'logic' ? t('logica aggiornata') : t('schema aggiornato')}`)
        } else if (ev.type === 'plugin_error') toast.error(`${ev.id}: ${ev.error}`)
      } catch {
        /* evento non valido */
      }
    }
    return () => es.close()
  }, [session.dev, slug, qc])
  return reloads
}

export function PluginPage({ session, slug, id }: { session: Session; slug: string; id: string }) {
  const ctx = useTenantCtx(slug)
  // lingua, tema e modo della shell: arrivano al plugin all'avvio e a ogni cambio
  const lang = useLang()
  const th = useTheme()
  const ui = { lang, preset: th.preset, mode: effectiveMode(th), preference: th.mode }
  const base = useUi()
  const reloads = useDevReload(session, slug)
  const [share, setShare] = useState<{ id: string; done: () => void } | null>(null)
  // la condivisione chiesta dal plugin apre la finestra dell'host, che conosce il tenant
  const services = useMemo<Ui>(() => ({ ...base, share: (rid) => new Promise<void>((done) => setShare({ id: rid, done })) }), [base])
  if (ctx.isLoading) return <Loading />
  if (ctx.error) return <ErrorBox error={ctx.error} />
  const c: TenantContext = ctx.data!
  const p = c.plugins.find((x) => x.id === id)
  if (!p) return <Empty title={t('App non attiva in questo tenant')} />
  return (
    <UiContext.Provider value={services}>
      <div className="relative flex-1 [&_.frame-msg]:absolute [&_.frame-msg]:inset-0 [&_.frame-msg]:flex [&_.frame-msg]:items-center [&_.frame-msg]:justify-center [&_.frame-msg]:text-sm [&_.frame-msg]:text-muted-foreground [&_.frame-wrap]:absolute [&_.frame-wrap]:inset-0 [&_iframe]:size-full [&_iframe]:border-0">
        <PluginFrame key={p.id + slug} plugin={p} session={session} ctx={c} reloadKey={reloads[p.id] ?? 0} ui={ui} />
      </div>
      <ShareDialog
        ctx={c}
        resourceId={share?.id ?? null}
        onClose={() => {
          share?.done()
          setShare(null)
        }}
      />
    </UiContext.Provider>
  )
}

/* ── Persone ─────────────────────────────────────────────────────────── */

export function Manage({ slug, section }: { slug: string; section?: string }) {
  const base = `/api/t/${enc(slug)}/manage`
  const members = useApi<Member[]>(['members', slug], `${base}/members`)
  const groups = useApi<Group[]>(['groups', slug], `${base}/groups`)
  const invites = useApi<Invitation[]>(['invites', slug], `${base}/invitations`)
  // In attesa: gli inviti (le richieste di accesso arriveranno con il kernel); i profili di permesso non
  // ci sono ancora
  const cur = ['people', 'groups', 'pending'].includes(section ?? '') ? section! : 'people'
  const sections = [
    { id: 'people', label: t('Persone'), icon: <Users />, count: members.data?.length },
    { id: 'groups', label: t('Gruppi'), icon: <Grid2x2 />, count: groups.data?.length },
    { id: 'pending', label: t('In attesa'), icon: <Mail />, count: invites.data?.filter((i) => i.status === 'pending').length },
  ]
  const [dlg, setDlg] = useState<null | 'member' | 'group' | 'invite'>(null)
  const inval = [['members', slug], ['groups', slug], ['invites', slug], ['overview', slug]]
  const create = useAction((v: Record<string, string>) => api('POST', `${base}/members`, v), { ok: (v) => t('Utente {username} creato', { username: v.username }), invalidate: inval })
  const newGroup = useAction((v: Record<string, string>) => api('POST', `${base}/groups`, v), { ok: (v) => t('Gruppo {name} creato', { name: v.name }), invalidate: inval })
  const invite = useAction((v: Record<string, string>) => api('POST', `${base}/invitations`, v), { ok: t('Invito inviato'), invalidate: inval })
  const action =
    cur === 'people' ? (
      <Button onClick={() => setDlg('member')}>
        <Plus />
        {t('Nuovo utente')}
      </Button>
    ) : cur === 'groups' ? (
      <Button onClick={() => setDlg('group')}>
        <Plus />
        {t('Nuovo gruppo')}
      </Button>
    ) : (
      <Button onClick={() => setDlg('invite')}>
        <Plus />
        {t('Invita')}
      </Button>
    )
  return (
    <>
      <PageHeader
        title={t('Gestisci')}
        crumbs={[{ label: t('Gestione del tenant') }]}
        sub={{ people: `${members.data?.length ?? '…'} persone`, groups: `${groups.data?.length ?? '…'} gruppi`, pending: `${sections[2].count ?? '…'} inviti in attesa` }[cur]}
        actions={action}
      />
      <Sections sections={sections} current={cur} href={(id) => to.tenant(slug, 'manage', id)}>
        {cur === 'people' && <People slug={slug} q={members} />}
        {cur === 'groups' && <Groups slug={slug} q={groups} members={members.data ?? []} />}
        {cur === 'pending' && <Invites slug={slug} q={invites} />}
      </Sections>
      <FormDialog
        open={dlg === 'member'}
        onOpenChange={(o) => !o && setDlg(null)}
        title={t('Nuovo utente')}
        description={t('Un account locale di questo tenant.')}
        fields={[
          { name: 'username', label: t('Username'), required: true },
          { name: 'display_name', label: t('Nome visualizzato') },
          { name: 'password', label: t('Password iniziale'), type: 'password', required: true, hint: t('Almeno 10 caratteri') },
          { name: 'role', label: t('Ruolo'), options: [['user', 'User'], ['tenant_manager', 'Tenant Manager']] },
        ]}
        submit={t('Crea utente')}
        onSubmit={(v) => create.mutateAsync(v)}
      />
      <FormDialog
        open={dlg === 'group'}
        onOpenChange={(o) => !o && setDlg(null)}
        title={t('Nuovo gruppo')}
        fields={[{ name: 'name', label: t('Nome'), required: true }]}
        submit={t('Crea gruppo')}
        onSubmit={(v) => newGroup.mutateAsync(v)}
      />
      <FormDialog
        open={dlg === 'invite'}
        onOpenChange={(o) => !o && setDlg(null)}
        title={t('Invita una persona di un altro tenant')}
        description={t('Entra come ospite: accede dal suo tenant e qui riceve ruolo e gruppi.')}
        fields={[
          { name: 'tenant', label: t('Tenant di appartenenza'), required: true },
          { name: 'username', label: t('Username'), required: true },
          { name: 'role', label: t('Ruolo'), options: [['user', 'User'], ['tenant_manager', 'Tenant Manager']] },
        ]}
        submit={t('Invia l’invito')}
        onSubmit={(v) => invite.mutateAsync(v)}
      />
    </>
  )
}

type Q<T> = { data?: T; isLoading: boolean; error: unknown }

function People({ slug, q }: { slug: string; q: Q<Member[]> }) {
  const base = `/api/t/${enc(slug)}/manage/members`
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [pwFor, setPwFor] = useState<Member | null>(null)
  const inval = [['members', slug], ['overview', slug]]
  const setRole = useAction(({ ids, role }: { ids: string[]; role: string }) => Promise.all(ids.map((id) => api('PUT', `${base}/${id}/role`, { role }))), {
    ok: ({ ids }) => (ids.length === 1 ? t('Ruolo aggiornato') : t('Ruolo aggiornato per {n} persone', { n: ids.length })),
    invalidate: inval,
  })
  const [removing, setRemoving] = useState<Member | null>(null)
  const remove = useAction(({ id, newOwner }: { id: string; newOwner?: string }) => api('DELETE', `${base}/${id}${newOwner ? `?new_owner=${newOwner}` : ''}`), {
    ok: t('Persona rimossa dal tenant'),
    invalidate: [...inval, ['m-resources', slug]],
  })
  const resetPw = useAction(({ id, password }: { id: string; password: string }) => api('POST', `${base}/${id}/password`, { password }), { ok: t('Password reimpostata') })
  const rows = useMemo(() => {
    const s = search.trim().toLowerCase()
    return (q.data ?? []).filter((m) => !s || `${m.username} ${m.display_name} ${m.home_tenant}`.toLowerCase().includes(s))
  }, [q.data, search])
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />
  const ids = [...sel].filter((id) => rows.some((r) => r.user_id === id))
  const all = rows.length > 0 && ids.length === rows.length
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Input type="search" placeholder={t('Cerca per nome o username')} aria-label={t('Cerca per nome o username')} className="w-72 max-w-full" value={search} onChange={(e) => setSearch(e.target.value)} />
        {ids.length > 0 && (
          // la barra delle azioni compare solo con una selezione
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-primary/10 py-1 pr-1 pl-3" role="group" aria-label={t('Azioni sulla selezione')}>
            <span className="text-sm font-medium tabular-nums">{ids.length === 1 ? '1 selezionata' : `${ids.length} selezionate`}</span>
            <Button variant="outline" size="sm" onClick={() => setRole.mutate({ ids, role: 'tenant_manager' })}>
              <ShieldCheck />
              {t('Rendi Tenant Manager')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setRole.mutate({ ids, role: 'user' })}>
              <UserRound />
              {t('Rendi User')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSel(new Set())}>
              {t('Deseleziona')}
            </Button>
          </div>
        )}
      </div>
      <div className="overflow-hidden rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  aria-label={t('Seleziona tutto')}
                  checked={all ? true : ids.length ? 'indeterminate' : false}
                  onCheckedChange={(v) => setSel(v ? new Set(rows.map((r) => r.user_id)) : new Set())}
                />
              </TableHead>
              <TableHead>{t('Nome')}</TableHead>
              <TableHead>{t('Ruolo')}</TableHead>
              <TableHead>{t('Stato')}</TableHead>
              <TableHead className="text-right">{t('Risorse')}</TableHead>
              <TableHead>{t('Nel tenant dal')}</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((m) => (
              <TableRow key={m.user_id} data-state={sel.has(m.user_id) ? 'selected' : undefined}>
                <TableCell>
                  <Checkbox
                    aria-label={`Seleziona ${m.username}`}
                    checked={sel.has(m.user_id)}
                    onCheckedChange={(v) => {
                      const n = new Set(sel)
                      if (v) n.add(m.user_id)
                      else n.delete(m.user_id)
                      setSel(n)
                    }}
                  />
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2.5">
                    <span className="flex size-8 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">{initials(m.display_name || m.username)}</span>
                    <div>
                      <div className="font-medium">
                        {m.display_name || m.username}
                        {m.is_guest && (
                          <Badge variant="secondary" className="ml-2 font-normal">
                            ospite · {m.home_tenant}
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {m.username}@{m.home_tenant}
                      </div>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant={m.role === 'tenant_manager' ? 'default' : 'secondary'} className="font-normal">
                    {ROLE[m.role]}
                  </Badge>
                </TableCell>
                <TableCell>
                  <StatusBadge status={m.status} />
                </TableCell>
                <TableCell className="text-right tabular-nums">{m.owned_resources}</TableCell>
                <TableCell className="text-muted-foreground">{fmtDate(m.joined_at)}</TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label={t('Azioni per {username}', { username: m.username })}>
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => setRole.mutate({ ids: [m.user_id], role: m.role === 'user' ? 'tenant_manager' : 'user' })}>
                        <ShieldCheck />
                        {m.role === 'user' ? t('Rendi Tenant Manager') : t('Rendi User')}
                      </DropdownMenuItem>
                      {!m.is_guest && (
                        <DropdownMenuItem onSelect={() => setPwFor(m)}>
                          <KeyRound />
                          {t('Reimposta la password')}
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => setRemoving(m)}
                      >
                        <Trash2 />
                        {t('Rimuovi dal tenant')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {rows.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">{t('Nessuna persona trovata.')}</p>}
      </div>
      <FormDialog
        open={!!pwFor}
        onOpenChange={(o) => !o && setPwFor(null)}
        title={t('Nuova password per {username}', { username: pwFor?.username ?? '' })}
        description={t('Le sue sessioni aperte vengono chiuse.')}
        fields={[{ name: 'password', label: t('Nuova password'), type: 'password', required: true, hint: t('Almeno 10 caratteri') }]}
        submit={t('Reimposta')}
        onSubmit={(v) => resetPw.mutateAsync({ id: pwFor!.user_id, password: v.password })}
      />
      <RemoveDialog
        member={removing}
        members={q.data ?? []}
        busy={remove.isPending}
        onClose={() => setRemoving(null)}
        onConfirm={(newOwner) => remove.mutate({ id: removing!.user_id, newOwner }, { onSuccess: () => setRemoving(null) })}
      />
    </div>
  )
}

/** Rimozione dal tenant (mockup: dlg-remove-person): chi riceve gli elementi della persona e cosa
 *  succede al suo account. */
function RemoveDialog({ member, members, busy, onConfirm, onClose }: { member: Member | null; members: Member[]; busy: boolean; onConfirm: (newOwner?: string) => void; onClose: () => void }) {
  const [owner, setOwner] = useState('')
  useEffect(() => setOwner(''), [member])
  const owns = (member?.owned_resources ?? 0) > 0
  return (
    <Dialog open={!!member} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('Rimuovi dal tenant')}</DialogTitle>
          <DialogDescription>{member && (member.display_name || member.username)}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 text-sm">
          <p>{member?.is_guest ? t('È ospite: perde l’accesso a questo tenant, il suo account resta nel tenant di appartenenza.') : t('È il suo tenant di appartenenza: l’account viene disabilitato.')}</p>
          {owns && (
            <div className="grid gap-1.5">
              <Label htmlFor="rm-owner">{t('Chi riceve i suoi {count} elementi', { count: member!.owned_resources })}</Label>
              <Select value={owner} onValueChange={setOwner}>
                <SelectTrigger id="rm-owner" className="w-full">
                  <SelectValue placeholder={t('Scegli la persona…')} />
                </SelectTrigger>
                <SelectContent>
                  {members
                    .filter((x) => x.user_id !== member!.user_id && x.status === 'active')
                    .map((x) => (
                      <SelectItem key={x.user_id} value={x.user_id}>
                        {x.display_name || x.username}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              {t('Annulla')}
            </Button>
            <Button variant="destructive" disabled={busy || (owns && !owner)} onClick={() => onConfirm(owner || undefined)}>
              {t('Rimuovi')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Groups({ slug, q, members }: { slug: string; q: Q<Group[]>; members: Member[] }) {
  const base = `/api/t/${enc(slug)}/manage/groups`
  const confirm = useConfirm()
  const inval = [['groups', slug]]
  const del = useAction((id: string) => api('DELETE', `${base}/${id}`), { ok: t('Gruppo eliminato'), invalidate: inval })
  const addMember = useAction(({ g, u }: { g: string; u: string }) => api('PUT', `${base}/${g}/members/${u}`), { ok: t('Aggiunto al gruppo'), invalidate: inval })
  const rmMember = useAction(({ g, u }: { g: string; u: string }) => api('DELETE', `${base}/${g}/members/${u}`), { invalidate: inval })
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />
  if (!q.data?.length)
    return (
      <Empty icon={<Grid2x2 />} title={t('Nessun gruppo')}>
        {t('I gruppi servono a condividere con più persone insieme.')}
      </Empty>
    )
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {q.data.map((g) => {
        const others = members.filter((m) => !g.members.some((x) => x.user_id === m.user_id))
        return (
          <Card key={g.id}>
            <CardHeader className="flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base">{g.name}</CardTitle>
                <CardDescription>{g.members.length} membri</CardDescription>
              </div>
              <div className="flex gap-1">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" disabled={!others.length}>
                      <Plus />
                      {t('Aggiungi')}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="max-h-72 overflow-auto">
                    {others.map((m) => (
                      <DropdownMenuItem key={m.user_id} onSelect={() => addMember.mutate({ g: g.id, u: m.user_id })}>
                        {m.display_name || m.username}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('Elimina il gruppo {name}', { name: g.name })}
                  onClick={async () => (await confirm(t('Eliminare il gruppo {name}? Le condivisioni con il gruppo vengono revocate.', { name: g.name }), true)) && del.mutate(g.id)}
                >
                  <Trash2 />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-1.5">
              {g.members.length === 0 && <span className="text-sm text-muted-foreground">{t('Nessun membro.')}</span>}
              {g.members.map((m) => (
                <Badge key={m.user_id} variant="secondary" className="gap-1 font-normal">
                  {m.display_name || m.username}
                  <button type="button" aria-label={t('Togli {username} dal gruppo', { username: m.username })} className="ml-0.5 opacity-60 hover:opacity-100" onClick={() => rmMember.mutate({ g: g.id, u: m.user_id })}>
                    ×
                  </button>
                </Badge>
              ))}
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

function Invites({ slug, q }: { slug: string; q: Q<Invitation[]> }) {
  const revoke = useAction((id: string) => api('DELETE', `/api/t/${enc(slug)}/manage/invitations/${id}`), { ok: t('Invito revocato'), invalidate: [['invites', slug]] })
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />
  if (!q.data?.length)
    return (
      <Empty icon={<Mail />} title={t('Niente in attesa')}>
        {t('Gli inviti alle persone di altri tenant restano qui finché non rispondono.')}
      </Empty>
    )
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('Persona')}</TableHead>
            <TableHead>{t('Ruolo')}</TableHead>
            <TableHead>{t('Stato')}</TableHead>
            <TableHead>{t('Scade')}</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {q.data.map((i) => (
            <TableRow key={i.id}>
              <TableCell className="font-medium">{i.user}</TableCell>
              <TableCell>{ROLE[i.role]}</TableCell>
              <TableCell>
                <StatusBadge status={i.status} />
              </TableCell>
              <TableCell className="text-muted-foreground">{fmtDate(i.expires_at)}</TableCell>
              <TableCell className="text-right">
                {i.status === 'pending' && (
                  <Button variant="ghost" size="sm" onClick={() => revoke.mutate(i.id)}>
                    {t('Revoca')}
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

/* ── Plugin del tenant ───────────────────────────────────────────────── */

/** I plugin del tenant: li rende disponibili l'Administrator, il Tenant Manager li vede con il loro tipo.
 *  Attivarli per il tenant e deciderne i permessi arrivera' con il kernel (docs/refactoring-ui.md §3). */
export function TenantPlugins({ slug }: { slug: string }) {
  const ctx = useTenantCtx(slug)
  if (ctx.isLoading) return <Loading />
  if (ctx.error) return <ErrorBox error={ctx.error} />
  const plugins = ctx.data!.plugins
  return (
    <>
      <PageHeader title={t('Plugin')} crumbs={[{ label: t('Gestione del tenant') }]} sub={t('{n} disponibili in {name}', { n: plugins.length, name: ctx.data!.tenant.name })} />
      <div className="grid gap-3 p-6 max-[620px]:p-4">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Li installa e li rende disponibili l’Administrator. Le <b>app</b> hanno pagine proprie e compaiono nella sidebar; i <b>servizi</b> lavorano dietro le quinte.
        </p>
        {plugins.length === 0 ? (
          <Empty icon={<Puzzle />} title={t('Nessun plugin disponibile')} />
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('Plugin')}</TableHead>
                  <TableHead>{t('Tipo')}</TableHead>
                  <TableHead>{t('Versione')}</TableHead>
                  <TableHead>{t('Stato')}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {plugins.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <span className="flex items-center gap-2.5">
                        <AppIcon id={p.id} className="size-5 text-primary" />
                        <span>
                          <b className="block font-medium">{p.label}</b>
                          <span className="line-clamp-1 text-xs text-muted-foreground">{p.description}</span>
                        </span>
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="font-normal">
                        {p.has_ui ? 'App' : 'Servizio'}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{p.version}</TableCell>
                    <TableCell>
                      <StatusBadge status="active" />
                    </TableCell>
                    <TableCell className="text-right">
                      {p.has_ui && (
                        <Button variant="ghost" size="sm" onClick={() => go(to.plugin(slug, p.id))}>
                          {t('Apri')}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </>
  )
}

/* ── Condivisioni ────────────────────────────────────────────────────── */

/** Gli elementi del tenant condivisi con altri o con un link pubblico; i link si revocano da qui. */
export function Shares({ slug }: { slug: string }) {
  const ctx = useTenantCtx(slug)
  const members = useApi<Member[]>(['members', slug], `/api/t/${enc(slug)}/manage/members`)
  const [show, setShow] = useState('all')
  const [filter, setFilter] = useState({ owner: '', plugin: '', q: '' })
  const qs = new URLSearchParams(Object.entries(filter).filter(([, v]) => v)).toString()
  const q = useApi<ResourceRow[]>(['m-resources', slug, qs], `/api/t/${enc(slug)}/manage/resources${qs ? '?' + qs : ''}`)
  const [links, setLinks] = useState<ResourceRow | null>(null)
  const [sharing, setSharing] = useState<string | null>(null)
  const [reassign, setReassign] = useState(false)
  const all = q.data ?? []
  const shared = all.filter((r) => r.shares > 0 || r.public_links > 0)
  const rows = show === 'items' ? all : show === 'public' ? shared.filter((r) => r.public_links > 0) : shared
  const plugins = ctx.data?.plugins ?? []
  const label = (id: string) => plugins.find((p) => p.id === id)?.label ?? id
  const seeTitles = ctx.data?.tenant.settings.managers_see_titles
  return (
    <>
      <PageHeader
        title={t('Condivisioni')}
        crumbs={[{ label: t('Gestione del tenant') }]}
        sub={t('Elementi condivisi con altre persone, con gruppi o con un link pubblico')}
        more={
          <DropdownMenuItem onSelect={() => setReassign(true)}>
            <Users />
            {t('Riassegna gli elementi di una persona')}
          </DropdownMenuItem>
        }
      />
      <div className="grid gap-3 p-6 max-[620px]:p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Pills
            items={[
              { id: 'all', label: t('Condivisi'), count: shared.length },
              { id: 'public', label: t('Pubblici'), count: shared.filter((r) => r.public_links > 0).length },
              { id: 'items', label: t('Tutti gli elementi'), count: all.length },
            ]}
            value={show}
            onChange={setShow}
          />
          <Select value={filter.owner || 'all'} onValueChange={(v) => setFilter({ ...filter, owner: v === 'all' ? '' : v })}>
            <SelectTrigger size="sm" className="w-48" aria-label={t('Proprietario')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('Tutti i proprietari')}</SelectItem>
              {(members.data ?? []).map((m) => (
                <SelectItem key={m.user_id} value={m.user_id}>
                  {m.display_name || m.username}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filter.plugin || 'all'} onValueChange={(v) => setFilter({ ...filter, plugin: v === 'all' ? '' : v })}>
            <SelectTrigger size="sm" className="w-40" aria-label={t('App')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('Tutte le app')}</SelectItem>
              {plugins.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {seeTitles && (
            <Input type="search" className="h-8 w-56" placeholder={t('Cerca nel titolo')} aria-label={t('Cerca nel titolo')} value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} />
          )}
        </div>
        {q.isLoading ? (
          <Loading />
        ) : q.error ? (
          <ErrorBox error={q.error} />
        ) : rows.length === 0 ? (
          <Empty icon={<Share2 />} title={show === 'public' ? t('Nessun link pubblico attivo') : show === 'items' ? t('Nessun elemento') : t('Nessuna condivisione')} />
        ) : (
          <div className="overflow-x-auto rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('Elemento')}</TableHead>
                  <TableHead>{t('Proprietario')}</TableHead>
                  <TableHead className="text-right">{t('Dimensione')}</TableHead>
                  <TableHead className="text-right">{t('Condivisioni')}</TableHead>
                  <TableHead className="text-right">{t('Link pubblici')}</TableHead>
                  <TableHead>{t('Modificato')}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <b className="block font-medium">{r.title || <span className="font-normal text-muted-foreground italic">{t('titolo nascosto')}</span>}</b>
                      <span className="text-xs text-muted-foreground">
                        {label(r.plugin_id)} · {r.kind}
                      </span>
                    </TableCell>
                    <TableCell>
                      {r.owner_name}
                      {!r.owner_active && (
                        <Badge variant="secondary" className="ml-2 font-normal">
                          {t('uscito')}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmtBytes(r.size_bytes)}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.shares}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.public_links > 0 ? (
                        <Badge variant="secondary" className="bg-warn/10 font-normal text-warn">
                          {r.public_links}
                        </Badge>
                      ) : (
                        0
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{fmtDate(r.updated_at)}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {r.public_links > 0 && (
                        <Button variant="ghost" size="sm" onClick={() => setLinks(r)}>
                          {t('Link pubblici')}
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => setSharing(r.id)}>
                        {t('Condividi')}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {all.length > 0 && !all.some((r) => r.title) && <p className="text-xs text-muted-foreground">{t('I titoli sono nascosti dalle regole del tenant (Impostazioni del tenant › Condivisione).')}</p>}
      </div>
      <LinksDialog slug={slug} row={links} onClose={() => setLinks(null)} />
      {ctx.data && <ShareDialog ctx={ctx.data} resourceId={sharing} onClose={() => setSharing(null)} />}
      <ReassignDialog slug={slug} open={reassign} members={members.data ?? []} onClose={() => setReassign(false)} />
    </>
  )
}

/** Tutti gli elementi di una persona passano a un'altra (per esempio prima che esca dal tenant). */
function ReassignDialog({ slug, open, members, onClose }: { slug: string; open: boolean; members: Member[]; onClose: () => void }) {
  const [from, setFrom] = useState('')
  const [dest, setDest] = useState('')
  const run = useAction(() => api<{ reassigned: number }>('POST', `/api/t/${enc(slug)}/manage/resources/reassign`, { from, to: dest }), {
    invalidate: [['m-resources', slug], ['members', slug]],
  })
  const owners = members.filter((m) => m.owned_resources > 0)
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('Riassegna gli elementi di una persona')}</DialogTitle>
          <DialogDescription>{t('Tutti i suoi elementi passano alla persona scelta, con le condivisioni.')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="ra-from">{t('Da')}</Label>
            <Select value={from} onValueChange={setFrom}>
              <SelectTrigger id="ra-from" className="w-full">
                <SelectValue placeholder={t('Scegli la persona…')} />
              </SelectTrigger>
              <SelectContent>
                {owners.map((m) => (
                  <SelectItem key={m.user_id} value={m.user_id}>
                    {m.display_name || m.username} · {t('{count} elementi', { count: m.owned_resources })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ra-to">{t('A')}</Label>
            <Select value={dest} onValueChange={setDest}>
              <SelectTrigger id="ra-to" className="w-full">
                <SelectValue placeholder={t('Scegli la persona…')} />
              </SelectTrigger>
              <SelectContent>
                {members
                  .filter((m) => m.status === 'active' && m.user_id !== from)
                  .map((m) => (
                    <SelectItem key={m.user_id} value={m.user_id}>
                      {m.display_name || m.username}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              {t('Annulla')}
            </Button>
            <Button
              disabled={!from || !dest || from === dest || run.isPending}
              onClick={() =>
                run.mutate(undefined, {
                  onSuccess: (r) => {
                    toast.success(t('{count} elementi riassegnati', { count: (r as { reassigned: number }).reassigned }))
                    setFrom('')
                    setDest('')
                    onClose()
                  },
                })
              }
            >
              {t('Riassegna')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function LinksDialog({ slug, row, onClose }: { slug: string; row: ResourceRow | null; onClose: () => void }) {
  const q = useApi<LinkInfo[]>(['links', row?.id], row ? `/api/t/${enc(slug)}/resources/${row.id}/links` : null)
  const revoke = useAction((id: string) => api('DELETE', `/api/t/${enc(slug)}/links/${id}`), {
    ok: t('Link revocato'),
    invalidate: [['links', row?.id], ['m-resources', slug], ['overview', slug]],
  })
  const active = (q.data ?? []).filter((l) => l.active)
  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('Link pubblici')}</DialogTitle>
          <DialogDescription>{row?.title || row?.kind}</DialogDescription>
        </DialogHeader>
        {q.isLoading ? (
          <Loading />
        ) : q.error ? (
          <ErrorBox error={q.error} />
        ) : (
          <ul className="grid gap-2">
            {active.map((l) => (
              <li key={l.id} className="flex items-center gap-3 rounded-lg border p-3 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block">
                    {t('Creato il {date}', { date: fmtDate(l.created_at) })}
                    {l.created_by ? ` ${t('da {name}', { name: l.created_by })}` : ''}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {l.expires_at ? t('Scade il {date}', { date: fmtDate(l.expires_at) }) : t('Senza scadenza')} · {t('{n} visite', { n: l.view_count })}
                    {l.has_password ? ` · ${t('con password')}` : ''}
                  </span>
                </span>
                <Button variant="outline" size="sm" onClick={() => revoke.mutate(l.id)}>
                  {t('Revoca')}
                </Button>
              </li>
            ))}
            {active.length === 0 && <li className="text-sm text-muted-foreground">{t('Nessun link attivo.')}</li>}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}

/* ── Consumi ─────────────────────────────────────────────────────────── */

/** I consumi del tenant. Le quote le decide l'Administrator: quando il kernel le avra', qui si vedranno
 *  in sola lettura accanto ai consumi (docs/refactoring-ui.md §6). */
export function Usage({ slug }: { slug: string }) {
  const q = useApi<TenantKpi>(['m-kpi', slug], `/api/t/${enc(slug)}/manage/kpi`)
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />
  const k = q.data!.core
  const bytes = k.resources.reduce((s, r) => s + r.bytes, 0)
  const max = Math.max(1, ...k.activity.map((d) => d.events))
  return (
    <>
      <PageHeader title={t('Consumi')} crumbs={[{ label: t('Gestione del tenant') }]} sub={t('Spazio, elementi e attività del tenant')} />
      <div className="grid gap-6 p-6 max-[620px]:p-4">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3">
          <Kpi label={t('Spazio usato')} value={fmtBytes(bytes)} hint={t('Quota: non ancora nel kernel')} />
          <Kpi label={t('Elementi')} value={k.resources.reduce((s, r) => s + r.count, 0)} />
          <Kpi label={t('Persone')} value={k.members} hint={t('{guests} ospiti · {groups} gruppi', { guests: k.guests, groups: k.groups })} />
          <Kpi label={t('Attive negli ultimi 30 giorni')} value={k.active_users_30d} />
          <Kpi label={t('Condivisioni')} value={k.shares} hint={t('{n} link pubblici attivi · {v} visite', { n: k.public_links, v: k.link_views })} onClick={() => go(to.tenant(slug, 'shares'))} />
        </div>
        <section className="grid gap-3">
          <h2 className="text-sm font-semibold">{t('Attività degli ultimi giorni')}</h2>
          {k.activity.length === 0 ? (
            <Empty icon={<Gauge />} title={t('Nessuna attività')} />
          ) : (
            <div className="flex h-36 items-end gap-1 rounded-xl border bg-card p-4" role="img" aria-label={t('Eventi al giorno')}>
              {k.activity.map((d) => (
                <span key={d.day} title={t('{day}: {events} eventi, {users} persone', { day: d.day, events: d.events, users: d.users })} className="min-w-1 flex-1 rounded-t bg-primary/70" style={{ height: `${Math.max(4, (d.events / max) * 100)}%` }} />
              ))}
            </div>
          )}
        </section>
        <section className="grid gap-3">
          <h2 className="text-sm font-semibold">{t('Per app')}</h2>
          {k.resources.length === 0 ? (
            <Empty icon={<Gauge />} title={t('Nessun elemento')} />
          ) : (
            <div className="overflow-hidden rounded-xl border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('App')}</TableHead>
                    <TableHead>{t('Tipo')}</TableHead>
                    <TableHead className="text-right">{t('Elementi')}</TableHead>
                    <TableHead className="text-right">{t('Spazio')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {k.resources.map((r) => (
                    <TableRow key={r.plugin_id + r.kind}>
                      <TableCell className="font-medium">{r.plugin}</TableCell>
                      <TableCell className="text-muted-foreground">{r.kind}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.count}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtBytes(r.bytes)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
        <PluginKpis items={q.data!.plugins} />
      </div>
    </>
  )
}

/* ── Impostazioni del tenant ─────────────────────────────────────────── */

export function TenantSettingsPage({ slug, section }: { slug: string; section?: string }) {
  const ctx = useTenantCtx(slug)
  if (ctx.isLoading) return <Loading />
  if (ctx.data?.tenant.role !== 'tenant_manager') return <Empty title={t('Riservate ai Tenant Manager')} />
  const sections = [
    { id: 'sharing', label: t('Condivisione'), icon: <Share2 />, group: t('Tenant') },
    { id: 'sign-in', label: t('Accesso'), icon: <KeyRound /> },
    { id: 'theme', label: t('Tema'), icon: <Palette />, group: t('Identità e aspetto') },
  ]
  const cur = sections.some((s) => s.id === section) ? section! : 'sharing'
  return (
    <>
      <PageHeader title={t('Impostazioni del tenant')} sub={t('Valgono per tutte le persone di {name}', { name: ctx.data.tenant.name })} />
      <Sections sections={sections} current={cur} href={(id) => to.tenant(slug, 'settings', id)}>
        {cur === 'sharing' && <Policy slug={slug} />}
        {cur === 'theme' && <TenantTheme slug={slug} />}
        {cur === 'sign-in' && (
          <Card className="max-w-2xl">
            <CardHeader>
              <CardTitle>{t('Accesso')}</CardTitle>
              <CardDescription>{t('Lo decide l’Administrator per il tenant.')}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <Locked label={t('Modo di autenticazione')} value="Account locali del tenant" hint={t('Oppure un provider di identità (OIDC), mai entrambi.')} />
              <Locked label={t('Regole della password')} value="Almeno 10 caratteri, non tutti uguali" hint={t('Il tenant potrà renderle più severe, non più deboli.')} />
            </CardContent>
          </Card>
        )}
      </Sections>
    </>
  )
}

function Policy({ slug }: { slug: string }) {
  const path = `/api/t/${enc(slug)}/manage/settings`
  const q = useApi<TenantSettings>(['settings', slug], path)
  const [v, setV] = useState<TenantSettings | null>(null)
  const save = useAction((s: TenantSettings) => api('PUT', path, s), { ok: t('Impostazioni salvate'), invalidate: [['settings', slug], ['ctx', slug]] })
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />
  const s = v ?? q.data!
  const dirty = !!v && JSON.stringify(v) !== JSON.stringify(q.data)
  return (
    <div className="max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>{t('Condivisione')}</CardTitle>
          <CardDescription>{t('Link pubblici e cosa vedono i Tenant Manager.')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <label className="flex items-center justify-between gap-4">
            <span>
              <b className="block text-sm">{t('Link pubblici')}</b>
              <span className="text-xs text-muted-foreground">{t('Chi ha il permesso di gestione può creare link in sola lettura')}</span>
            </span>
            <Switch checked={s.public_links_enabled} onCheckedChange={(x) => setV({ ...s, public_links_enabled: x })} />
          </label>
          <div className="grid gap-1.5">
            <Label htmlFor="maxd">{t('Durata massima dei link, in giorni (0 = nessun limite)')}</Label>
            <Input id="maxd" type="number" min={0} className="w-32" value={s.public_link_max_days} onChange={(e) => setV({ ...s, public_link_max_days: Math.max(0, +e.target.value) })} />
          </div>
          <label className="flex items-center justify-between gap-4">
            <span>
              <b className="block text-sm">{t('I Tenant Manager vedono i titoli degli elementi')}</b>
              <span className="text-xs text-muted-foreground">{t('Altrimenti solo conteggi e dimensioni')}</span>
            </span>
            <Switch checked={s.managers_see_titles} onCheckedChange={(x) => setV({ ...s, managers_see_titles: x })} />
          </label>
        </CardContent>
      </Card>
      <SaveBar dirty={dirty} busy={save.isPending} onSave={() => v && save.mutate(v, { onSuccess: () => setV(null) })} onCancel={() => setV(null)} />
    </div>
  )
}
