// Pagine di un tenant: Home o panoramica, app (nell'iframe) e, per il Tenant Manager, la gestione del
// tenant: Persone, Plugin, Condivisioni, Consumi e Impostazioni del tenant (docs/refactoring-ui.md §2).

import { useMemo, useState } from 'react'
import { Gauge, Grid2x2, KeyRound, Mail, MoreHorizontal, Palette, Plus, Puzzle, Share2, ShieldCheck, Trash2, UserRound, Users } from 'lucide-react'
import { api, fmtBytes, fmtDate } from '../../api.ts'
import PluginFrame from '../../components/PluginFrame.tsx'
import type { Group, Invitation, LinkInfo, Member, Overview, ResourceRow, Session, TenantContext, TenantKpi, TenantSettings } from '../../types.ts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { initials, useAction, useApi, useConfirm, useTenantCtx } from '../core.ts'
import { t, useLang } from '../i18n.ts'
import { Empty, ErrorBox, FormDialog, Kpi, Loading, Locked, PageHeader, Pills, SaveBar, Sections, StatusBadge } from '../kit.tsx'
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
            <h2 className="text-sm font-semibold">Il tuo spazio</h2>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3">
              <Kpi label="Risorse tue" value={mine} hint={fmtBytes(d.me.resources.reduce((s, r) => s + r.bytes, 0))} />
              <Kpi label="Condivisi da me" value={d.me.shared_by_me} />
              <Kpi label="Condivisi con me" value={d.me.shared_with_me} />
              <Kpi label="Miei link pubblici attivi" value={d.me.public_links} hint={`${d.me.link_views} visite`} />
            </div>
          </section>
        )}
        {d?.tenant && (
          <section className="grid gap-3">
            <h2 className="text-sm font-semibold">Il tenant {c.tenant.name}</h2>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3">
              <Kpi label="Membri" value={d.tenant.members} hint={`${d.tenant.guests} ospiti`} onClick={() => go(to.tenant(slug, 'manage'))} />
              <Kpi label="Utenti attivi (30 gg)" value={d.tenant.active_users_30d} />
              <Kpi label="Risorse" value={d.tenant.resources.reduce((s, r) => s + r.count, 0)} />
              <Kpi label="Condivisioni" value={d.tenant.shares} hint={`${d.tenant.public_links} link pubblici`} onClick={() => go(to.tenant(slug, 'shares'))} />
            </div>
          </section>
        )}
        <section className="grid gap-3">
          <h2 className="text-sm font-semibold">App</h2>
          {c.plugins.length === 0 ? (
            <Empty icon={<Grid2x2 />} title="Nessuna app attiva">
              Un Administrator le installa e le attiva.
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

export function PluginPage({ session, slug, id }: { session: Session; slug: string; id: string }) {
  const ctx = useTenantCtx(slug)
  // lingua, tema e modo della shell: arrivano al plugin all'avvio e a ogni cambio
  const lang = useLang()
  const th = useTheme()
  const ui = { lang, preset: th.preset, mode: effectiveMode(th), preference: th.mode }
  if (ctx.isLoading) return <Loading />
  if (ctx.error) return <ErrorBox error={ctx.error} />
  const c: TenantContext = ctx.data!
  const p = c.plugins.find((x) => x.id === id)
  if (!p) return <Empty title="App non attiva in questo tenant" />
  return (
    <div className="relative flex-1 [&_.frame-msg]:absolute [&_.frame-msg]:inset-0 [&_.frame-msg]:flex [&_.frame-msg]:items-center [&_.frame-msg]:justify-center [&_.frame-msg]:text-sm [&_.frame-msg]:text-muted-foreground [&_.frame-wrap]:absolute [&_.frame-wrap]:inset-0 [&_iframe]:size-full [&_iframe]:border-0">
      <PluginFrame key={p.id + slug} plugin={p} session={session} ctx={c} reloadKey={0} ui={ui} />
    </div>
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
    { id: 'people', label: 'Persone', icon: <Users />, count: members.data?.length },
    { id: 'groups', label: 'Gruppi', icon: <Grid2x2 />, count: groups.data?.length },
    { id: 'pending', label: 'In attesa', icon: <Mail />, count: invites.data?.filter((i) => i.status === 'pending').length },
  ]
  const [dlg, setDlg] = useState<null | 'member' | 'group' | 'invite'>(null)
  const inval = [['members', slug], ['groups', slug], ['invites', slug], ['overview', slug]]
  const create = useAction((v: Record<string, string>) => api('POST', `${base}/members`, v), { ok: (v) => `Utente ${v.username} creato`, invalidate: inval })
  const newGroup = useAction((v: Record<string, string>) => api('POST', `${base}/groups`, v), { ok: (v) => `Gruppo ${v.name} creato`, invalidate: inval })
  const invite = useAction((v: Record<string, string>) => api('POST', `${base}/invitations`, v), { ok: 'Invito inviato', invalidate: inval })
  const action =
    cur === 'people' ? (
      <Button onClick={() => setDlg('member')}>
        <Plus />
        Nuovo utente
      </Button>
    ) : cur === 'groups' ? (
      <Button onClick={() => setDlg('group')}>
        <Plus />
        Nuovo gruppo
      </Button>
    ) : (
      <Button onClick={() => setDlg('invite')}>
        <Plus />
        Invita
      </Button>
    )
  return (
    <>
      <PageHeader
        title="Gestisci"
        crumbs={[{ label: 'Gestione del tenant' }]}
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
        title="Nuovo utente"
        description="Un account locale di questo tenant."
        fields={[
          { name: 'username', label: 'Username', required: true },
          { name: 'display_name', label: 'Nome visualizzato' },
          { name: 'password', label: 'Password iniziale', type: 'password', required: true, hint: 'Almeno 10 caratteri' },
          { name: 'role', label: 'Ruolo', options: [['user', 'User'], ['tenant_manager', 'Tenant Manager']] },
        ]}
        submit="Crea utente"
        onSubmit={(v) => create.mutateAsync(v)}
      />
      <FormDialog
        open={dlg === 'group'}
        onOpenChange={(o) => !o && setDlg(null)}
        title="Nuovo gruppo"
        fields={[{ name: 'name', label: 'Nome', required: true }]}
        submit="Crea gruppo"
        onSubmit={(v) => newGroup.mutateAsync(v)}
      />
      <FormDialog
        open={dlg === 'invite'}
        onOpenChange={(o) => !o && setDlg(null)}
        title="Invita una persona di un altro tenant"
        description="Entra come ospite: accede dal suo tenant e qui riceve ruolo e gruppi."
        fields={[
          { name: 'tenant', label: 'Tenant di appartenenza', required: true },
          { name: 'username', label: 'Username', required: true },
          { name: 'role', label: 'Ruolo', options: [['user', 'User'], ['tenant_manager', 'Tenant Manager']] },
        ]}
        submit="Invia l’invito"
        onSubmit={(v) => invite.mutateAsync(v)}
      />
    </>
  )
}

type Q<T> = { data?: T; isLoading: boolean; error: unknown }

function People({ slug, q }: { slug: string; q: Q<Member[]> }) {
  const base = `/api/t/${enc(slug)}/manage/members`
  const confirm = useConfirm()
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [pwFor, setPwFor] = useState<Member | null>(null)
  const inval = [['members', slug], ['overview', slug]]
  const setRole = useAction(({ ids, role }: { ids: string[]; role: string }) => Promise.all(ids.map((id) => api('PUT', `${base}/${id}/role`, { role }))), {
    ok: ({ ids }) => (ids.length === 1 ? 'Ruolo aggiornato' : `Ruolo aggiornato per ${ids.length} persone`),
    invalidate: inval,
  })
  const remove = useAction((id: string) => api('DELETE', `${base}/${id}`), { ok: 'Persona rimossa dal tenant', invalidate: inval })
  const resetPw = useAction(({ id, password }: { id: string; password: string }) => api('POST', `${base}/${id}/password`, { password }), { ok: 'Password reimpostata' })
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
        <Input type="search" placeholder="Cerca per nome o username" aria-label="Cerca per nome o username" className="w-72 max-w-full" value={search} onChange={(e) => setSearch(e.target.value)} />
        {ids.length > 0 && (
          // la barra delle azioni compare solo con una selezione
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-primary/10 py-1 pr-1 pl-3" role="group" aria-label="Azioni sulla selezione">
            <span className="text-sm font-medium tabular-nums">{ids.length === 1 ? '1 selezionata' : `${ids.length} selezionate`}</span>
            <Button variant="outline" size="sm" onClick={() => setRole.mutate({ ids, role: 'tenant_manager' })}>
              <ShieldCheck />
              Rendi Tenant Manager
            </Button>
            <Button variant="outline" size="sm" onClick={() => setRole.mutate({ ids, role: 'user' })}>
              <UserRound />
              Rendi User
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSel(new Set())}>
              Deseleziona
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
                  aria-label="Seleziona tutto"
                  checked={all ? true : ids.length ? 'indeterminate' : false}
                  onCheckedChange={(v) => setSel(v ? new Set(rows.map((r) => r.user_id)) : new Set())}
                />
              </TableHead>
              <TableHead>Nome</TableHead>
              <TableHead>Ruolo</TableHead>
              <TableHead>Stato</TableHead>
              <TableHead className="text-right">Risorse</TableHead>
              <TableHead>Nel tenant dal</TableHead>
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
                      <Button variant="ghost" size="icon" aria-label={`Azioni per ${m.username}`}>
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => setRole.mutate({ ids: [m.user_id], role: m.role === 'user' ? 'tenant_manager' : 'user' })}>
                        <ShieldCheck />
                        {m.role === 'user' ? 'Rendi Tenant Manager' : 'Rendi User'}
                      </DropdownMenuItem>
                      {!m.is_guest && (
                        <DropdownMenuItem onSelect={() => setPwFor(m)}>
                          <KeyRound />
                          Reimposta la password
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={async () => {
                          if (await confirm(`Rimuovere ${m.username} dal tenant?${m.is_guest ? '' : ' È il suo tenant di appartenenza: l’account viene disabilitato.'}`, true)) remove.mutate(m.user_id)
                        }}
                      >
                        <Trash2 />
                        Rimuovi dal tenant
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {rows.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">Nessuna persona trovata.</p>}
      </div>
      <FormDialog
        open={!!pwFor}
        onOpenChange={(o) => !o && setPwFor(null)}
        title={`Nuova password per ${pwFor?.username ?? ''}`}
        description="Le sue sessioni aperte vengono chiuse."
        fields={[{ name: 'password', label: 'Nuova password', type: 'password', required: true, hint: 'Almeno 10 caratteri' }]}
        submit="Reimposta"
        onSubmit={(v) => resetPw.mutateAsync({ id: pwFor!.user_id, password: v.password })}
      />
    </div>
  )
}

function Groups({ slug, q, members }: { slug: string; q: Q<Group[]>; members: Member[] }) {
  const base = `/api/t/${enc(slug)}/manage/groups`
  const confirm = useConfirm()
  const inval = [['groups', slug]]
  const del = useAction((id: string) => api('DELETE', `${base}/${id}`), { ok: 'Gruppo eliminato', invalidate: inval })
  const addMember = useAction(({ g, u }: { g: string; u: string }) => api('PUT', `${base}/${g}/members/${u}`), { ok: 'Aggiunto al gruppo', invalidate: inval })
  const rmMember = useAction(({ g, u }: { g: string; u: string }) => api('DELETE', `${base}/${g}/members/${u}`), { invalidate: inval })
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />
  if (!q.data?.length)
    return (
      <Empty icon={<Grid2x2 />} title="Nessun gruppo">
        I gruppi servono a condividere con più persone insieme.
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
                      Aggiungi
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
                  aria-label={`Elimina il gruppo ${g.name}`}
                  onClick={async () => (await confirm(`Eliminare il gruppo ${g.name}? Le condivisioni con il gruppo vengono revocate.`, true)) && del.mutate(g.id)}
                >
                  <Trash2 />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-1.5">
              {g.members.length === 0 && <span className="text-sm text-muted-foreground">Nessun membro.</span>}
              {g.members.map((m) => (
                <Badge key={m.user_id} variant="secondary" className="gap-1 font-normal">
                  {m.display_name || m.username}
                  <button type="button" aria-label={`Togli ${m.username} dal gruppo`} className="ml-0.5 opacity-60 hover:opacity-100" onClick={() => rmMember.mutate({ g: g.id, u: m.user_id })}>
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
  const revoke = useAction((id: string) => api('DELETE', `/api/t/${enc(slug)}/manage/invitations/${id}`), { ok: 'Invito revocato', invalidate: [['invites', slug]] })
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />
  if (!q.data?.length)
    return (
      <Empty icon={<Mail />} title="Niente in attesa">
        Gli inviti alle persone di altri tenant restano qui finché non rispondono.
      </Empty>
    )
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Persona</TableHead>
            <TableHead>Ruolo</TableHead>
            <TableHead>Stato</TableHead>
            <TableHead>Scade</TableHead>
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
                    Revoca
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
      <PageHeader title="Plugin" crumbs={[{ label: 'Gestione del tenant' }]} sub={`${plugins.length} disponibili in ${ctx.data!.tenant.name}`} />
      <div className="grid gap-3 p-6 max-[620px]:p-4">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Li installa e li rende disponibili l’Administrator. Le <b>app</b> hanno pagine proprie e compaiono nella sidebar; i <b>servizi</b> lavorano dietro le quinte.
        </p>
        {plugins.length === 0 ? (
          <Empty icon={<Puzzle />} title="Nessun plugin disponibile" />
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Plugin</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Versione</TableHead>
                  <TableHead>Stato</TableHead>
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
                          Apri
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
  const q = useApi<ResourceRow[]>(['m-resources', slug], `/api/t/${enc(slug)}/manage/resources`)
  const [show, setShow] = useState('all')
  const [links, setLinks] = useState<ResourceRow | null>(null)
  const shared = (q.data ?? []).filter((r) => r.shares > 0 || r.public_links > 0)
  const rows = shared.filter((r) => show === 'all' || r.public_links > 0)
  return (
    <>
      <PageHeader title="Condivisioni" crumbs={[{ label: 'Gestione del tenant' }]} sub="Elementi condivisi con altre persone, con gruppi o con un link pubblico" />
      <div className="grid gap-3 p-6 max-[620px]:p-4">
        <Pills
          items={[
            { id: 'all', label: 'Tutte', count: shared.length },
            { id: 'public', label: 'Pubbliche', count: shared.filter((r) => r.public_links > 0).length },
          ]}
          value={show}
          onChange={setShow}
        />
        {q.isLoading ? (
          <Loading />
        ) : q.error ? (
          <ErrorBox error={q.error} />
        ) : rows.length === 0 ? (
          <Empty icon={<Share2 />} title={show === 'public' ? 'Nessun link pubblico attivo' : 'Nessuna condivisione'} />
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Elemento</TableHead>
                  <TableHead>Proprietario</TableHead>
                  <TableHead className="text-right">Condivisioni</TableHead>
                  <TableHead className="text-right">Link pubblici</TableHead>
                  <TableHead>Modificato</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <b className="block font-medium">{r.title || <span className="font-normal text-muted-foreground italic">titolo nascosto</span>}</b>
                      <span className="text-xs text-muted-foreground">
                        {r.plugin_id} · {r.kind}
                      </span>
                    </TableCell>
                    <TableCell>{r.owner_name}</TableCell>
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
                    <TableCell className="text-right">
                      {r.public_links > 0 && (
                        <Button variant="ghost" size="sm" onClick={() => setLinks(r)}>
                          Link pubblici
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {(q.data ?? []).length > 0 && !(q.data ?? []).some((r) => r.title) && (
          <p className="text-xs text-muted-foreground">I titoli sono nascosti dalle regole del tenant (Impostazioni del tenant › Condivisione).</p>
        )}
      </div>
      <LinksDialog slug={slug} row={links} onClose={() => setLinks(null)} />
    </>
  )
}

function LinksDialog({ slug, row, onClose }: { slug: string; row: ResourceRow | null; onClose: () => void }) {
  const q = useApi<LinkInfo[]>(['links', row?.id], row ? `/api/t/${enc(slug)}/resources/${row.id}/links` : null)
  const revoke = useAction((id: string) => api('DELETE', `/api/t/${enc(slug)}/links/${id}`), {
    ok: 'Link revocato',
    invalidate: [['links', row?.id], ['m-resources', slug], ['overview', slug]],
  })
  const active = (q.data ?? []).filter((l) => l.active)
  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Link pubblici</DialogTitle>
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
                    Creato il {fmtDate(l.created_at)}
                    {l.created_by ? ` da ${l.created_by}` : ''}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {l.expires_at ? `Scade il ${fmtDate(l.expires_at)}` : 'Senza scadenza'} · {l.view_count} visite{l.has_password ? ' · con password' : ''}
                  </span>
                </span>
                <Button variant="outline" size="sm" onClick={() => revoke.mutate(l.id)}>
                  Revoca
                </Button>
              </li>
            ))}
            {active.length === 0 && <li className="text-sm text-muted-foreground">Nessun link attivo.</li>}
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
      <PageHeader title="Consumi" crumbs={[{ label: 'Gestione del tenant' }]} sub="Spazio, elementi e attività del tenant" />
      <div className="grid gap-6 p-6 max-[620px]:p-4">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3">
          <Kpi label="Spazio usato" value={fmtBytes(bytes)} hint="Quota: non ancora nel kernel" />
          <Kpi label="Elementi" value={k.resources.reduce((s, r) => s + r.count, 0)} />
          <Kpi label="Persone" value={k.members} hint={`${k.guests} ospiti · ${k.groups} gruppi`} />
          <Kpi label="Attive negli ultimi 30 giorni" value={k.active_users_30d} />
        </div>
        <section className="grid gap-3">
          <h2 className="text-sm font-semibold">Attività degli ultimi giorni</h2>
          {k.activity.length === 0 ? (
            <Empty icon={<Gauge />} title="Nessuna attività" />
          ) : (
            <div className="flex h-36 items-end gap-1 rounded-xl border bg-card p-4" role="img" aria-label="Eventi al giorno">
              {k.activity.map((d) => (
                <span key={d.day} title={`${d.day}: ${d.events} eventi, ${d.users} persone`} className="min-w-1 flex-1 rounded-t bg-primary/70" style={{ height: `${Math.max(4, (d.events / max) * 100)}%` }} />
              ))}
            </div>
          )}
        </section>
        <section className="grid gap-3">
          <h2 className="text-sm font-semibold">Per app</h2>
          {k.resources.length === 0 ? (
            <Empty icon={<Gauge />} title="Nessun elemento" />
          ) : (
            <div className="overflow-hidden rounded-xl border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>App</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead className="text-right">Elementi</TableHead>
                    <TableHead className="text-right">Spazio</TableHead>
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
      </div>
    </>
  )
}

/* ── Impostazioni del tenant ─────────────────────────────────────────── */

export function TenantSettingsPage({ slug, section }: { slug: string; section?: string }) {
  const ctx = useTenantCtx(slug)
  if (ctx.isLoading) return <Loading />
  if (ctx.data?.tenant.role !== 'tenant_manager') return <Empty title="Riservate ai Tenant Manager" />
  const sections = [
    { id: 'sharing', label: 'Condivisione', icon: <Share2 />, group: 'Tenant' },
    { id: 'sign-in', label: 'Accesso', icon: <KeyRound /> },
    { id: 'theme', label: 'Tema', icon: <Palette />, group: 'Identità e aspetto' },
  ]
  const cur = sections.some((s) => s.id === section) ? section! : 'sharing'
  return (
    <>
      <PageHeader title="Impostazioni del tenant" sub={`Valgono per tutte le persone di ${ctx.data.tenant.name}`} />
      <Sections sections={sections} current={cur} href={(id) => to.tenant(slug, 'settings', id)}>
        {cur === 'sharing' && <Policy slug={slug} />}
        {cur === 'theme' && <TenantTheme slug={slug} />}
        {cur === 'sign-in' && (
          <Card className="max-w-2xl">
            <CardHeader>
              <CardTitle>Accesso</CardTitle>
              <CardDescription>Lo decide l’Administrator per il tenant.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <Locked label="Modo di autenticazione" value="Account locali del tenant" hint="Oppure un provider di identità (OIDC), mai entrambi." />
              <Locked label="Regole della password" value="Almeno 10 caratteri, non tutti uguali" hint="Il tenant potrà renderle più severe, non più deboli." />
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
  const save = useAction((s: TenantSettings) => api('PUT', path, s), { ok: 'Impostazioni salvate', invalidate: [['settings', slug], ['ctx', slug]] })
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />
  const s = v ?? q.data!
  const dirty = !!v && JSON.stringify(v) !== JSON.stringify(q.data)
  return (
    <div className="max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>Condivisione</CardTitle>
          <CardDescription>Link pubblici e cosa vedono i Tenant Manager.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <label className="flex items-center justify-between gap-4">
            <span>
              <b className="block text-sm">Link pubblici</b>
              <span className="text-xs text-muted-foreground">Chi ha il permesso di gestione può creare link in sola lettura</span>
            </span>
            <Switch checked={s.public_links_enabled} onCheckedChange={(x) => setV({ ...s, public_links_enabled: x })} />
          </label>
          <div className="grid gap-1.5">
            <Label htmlFor="maxd">Durata massima dei link, in giorni (0 = nessun limite)</Label>
            <Input id="maxd" type="number" min={0} className="w-32" value={s.public_link_max_days} onChange={(e) => setV({ ...s, public_link_max_days: Math.max(0, +e.target.value) })} />
          </div>
          <label className="flex items-center justify-between gap-4">
            <span>
              <b className="block text-sm">I Tenant Manager vedono i titoli degli elementi</b>
              <span className="text-xs text-muted-foreground">Altrimenti solo conteggi e dimensioni</span>
            </span>
            <Switch checked={s.managers_see_titles} onCheckedChange={(x) => setV({ ...s, managers_see_titles: x })} />
          </label>
        </CardContent>
      </Card>
      <SaveBar dirty={dirty} busy={save.isPending} onSave={() => v && save.mutate(v, { onSuccess: () => setV(null) })} onCancel={() => setV(null)} />
    </div>
  )
}
