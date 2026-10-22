// Pagine dell'Administrator: panoramica della piattaforma, tenant e dettaglio a schede, plugin, Sistema
// (amministratori, identita' e barra in alto). Account e Notifiche sono in common.tsx e notifications.tsx.

import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Bell, Building2, CircleHelp, Contrast, Info, KeyRound, MoreHorizontal, Palette, PanelLeft, PanelTop, Plus, Power, Puzzle, Search, ShieldCheck, Trash2, Upload, Users } from 'lucide-react'
import { api, fmtBytes, fmtDate } from '../../api.ts'
import { useBrand } from '../../brand.ts'
import type { AdminPlugin, AdminUser, CatalogItem, GlobalKpi, Member, Session, ShellBand, SystemOverview, TenantInfo } from '../../types.ts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { initials, useAction, useApi, useConfirm } from '../core.ts'
import AppIcon from '../AppIcon.tsx'
import { DataTable, Empty, ErrorBox, FormDialog, Kpi, Loading, PageHeader, Pills, PluginKpis, SaveBar, Sections, StatusBadge, Tabs } from '../kit.tsx'
import { go, to } from '../router.ts'
import { bandOf } from '../prefs.ts'
import { AppMark } from '../Shell.tsx'
import { PlatformTheme } from '../ThemeSettings.tsx'
import { t } from '../i18n.ts'

const enc = encodeURIComponent

/* ── Panoramica ──────────────────────────────────────────────────────── */

export function AdminOverview({ session }: { session: Session }) {
  const q = useApi<SystemOverview>(['admin-overview'], '/api/admin/overview')
  const kpi = useApi<GlobalKpi>(['admin-kpi'], '/api/admin/kpi')
  return (
    <>
      <PageHeader title={t('Panoramica della piattaforma')} sub={t('Ciao {name} · Administrator', { name: session.user.display_name || session.user.username })} />
      <div className="grid gap-6 p-6 max-[620px]:p-4">
        {q.isLoading ? (
          <Loading />
        ) : q.error ? (
          <ErrorBox error={q.error} />
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
            <Kpi label={t('Tenant attivi')} value={`${q.data!.active_tenants}/${q.data!.tenants}`} onClick={() => go(to.admin('tenants'))} />
            <Kpi label={t('Utenti attivi')} value={q.data!.users} hint={t('{n} negli ultimi 30 giorni', { n: q.data!.active_users_30d })} />
            <Kpi label={t('Administrator')} value={q.data!.administrators} onClick={() => go(to.admin('system', 'admins'))} />
            <Kpi label={t('Risorse')} value={q.data!.resources} hint={fmtBytes(q.data!.bytes)} />
            <Kpi label={t('Plugin attivi')} value={`${q.data!.plugins_active}/${q.data!.plugins_installed}`} onClick={() => go(to.admin('plugins'))} />
          </div>
        )}
        {q.data?.tenants === 0 && (
          <Empty icon={<Building2 />} title={t('Nessun tenant')}>
            <Button className="mt-2" onClick={() => go(to.admin('tenants'))}>
              {t('Crea il primo tenant')}
            </Button>
          </Empty>
        )}
        {kpi.data && kpi.data.resources.length > 0 && (
          <section className="grid gap-3">
            <h2 className="text-sm font-semibold">{t('Elementi per plugin, in tutti i tenant')}</h2>
            <DataTable
              label={t('Elementi per plugin, in tutti i tenant')}
              rows={kpi.data.resources.map((r) => ({ [t('Plugin')]: r.plugin, [t('Tipo')]: r.kind, [t('Elementi')]: r.count, [t('Spazio')]: fmtBytes(r.bytes) }))}
            />
          </section>
        )}
        {kpi.data && <PluginKpis items={kpi.data.plugins} />}
      </div>
    </>
  )
}

/* ── Tenant ──────────────────────────────────────────────────────────── */

export function AdminTenants() {
  const q = useApi<TenantInfo[]>(['admin-tenants'], '/api/admin/tenants')
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const create = useAction((v: Record<string, string>) => api('POST', '/api/admin/tenants', v), {
    ok: (v) => t('Tenant {name} creato con il suo Tenant Manager', { name: v.name }),
    invalidate: [['admin-tenants'], ['admin-overview']],
  })
  const rows = (q.data ?? []).filter((tn) => !search || `${tn.name} ${tn.slug}`.toLowerCase().includes(search.toLowerCase()))
  return (
    <>
      <PageHeader
        title={t('Tenant')}
        sub={q.data ? `${q.data.length} tenant` : undefined}
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus />
            {t('Nuovo tenant')}
          </Button>
        }
      />
      <div className="grid gap-3 p-6 max-[620px]:p-4">
        <Input type="search" placeholder={t('Cerca un tenant')} aria-label={t('Cerca un tenant')} className="w-72 max-w-full" value={search} onChange={(e) => setSearch(e.target.value)} />
        {q.isLoading ? (
          <Loading />
        ) : q.error ? (
          <ErrorBox error={q.error} />
        ) : rows.length === 0 ? (
          <Empty icon={<Building2 />} title={q.data?.length ? t('Nessun tenant trovato') : t('Nessun tenant')} />
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('Tenant')}</TableHead>
                  <TableHead className="text-right">{t('Membri')}</TableHead>
                  <TableHead className="text-right">{t('Ospiti')}</TableHead>
                  <TableHead className="text-right">{t('Risorse')}</TableHead>
                  <TableHead className="text-right">{t('Spazio')}</TableHead>
                  <TableHead>{t('Stato')}</TableHead>
                  <TableHead>{t('Creato')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((tn) => (
                  <TableRow key={tn.id} className="cursor-pointer" onClick={() => go(to.adminTenant(tn.id))}>
                    <TableCell>
                      <a href={to.adminTenant(tn.id)} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
                        {tn.name}
                      </a>
                      <span className="ml-2 font-mono text-xs text-muted-foreground">{tn.slug}</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{tn.members}</TableCell>
                    <TableCell className="text-right tabular-nums">{tn.guests}</TableCell>
                    <TableCell className="text-right tabular-nums">{tn.resources}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtBytes(tn.bytes)}</TableCell>
                    <TableCell>
                      <StatusBadge status={tn.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">{fmtDate(tn.created_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={t('Nuovo tenant')}
        description={t('Con il suo primo Tenant Manager, un account locale del tenant.')}
        fields={[
          { name: 'slug', label: t('Identificativo'), required: true, hint: t('Minuscole, cifre e trattini: va nell’indirizzo e non cambia') },
          { name: 'name', label: t('Nome'), required: true },
          { name: 'manager_username', label: t('Username del Tenant Manager'), required: true },
          { name: 'manager_display_name', label: t('Nome del Tenant Manager') },
          { name: 'manager_password', label: t('Password iniziale'), type: 'password', required: true, hint: t('Almeno 10 caratteri') },
        ]}
        submit={t('Crea il tenant')}
        onSubmit={(v) => create.mutateAsync(v)}
      />
    </>
  )
}

export function AdminTenant({ id, section }: { id: string; section?: string }) {
  const tenants = useApi<TenantInfo[]>(['admin-tenants'], '/api/admin/tenants')
  const members = useApi<Member[]>(['admin-members', id], `/api/admin/tenants/${id}/members`)
  const confirm = useConfirm()
  const tn = tenants.data?.find((x) => x.id === id)
  const cur = section === 'users' ? 'users' : 'details'
  const toggle = async () => {
    const next = tn!.status === 'active' ? 'suspended' : 'active'
    if (next === 'active' || (await confirm(t('Sospendere {name}? Le sue persone non potranno più accedere.', { name: tn!.name }), true))) status.mutate(next)
  }
  const status = useAction((s: string) => api('PUT', `/api/admin/tenants/${id}/status`, { status: s }), {
    ok: (s) => (s === 'active' ? t('Tenant riattivato') : t('Tenant sospeso')),
    invalidate: [['admin-tenants'], ['admin-overview']],
  })
  if (tenants.isLoading) return <Loading />
  if (!tn) return <Empty title={t('Tenant inesistente')} />
  return (
    <>
      <PageHeader
        crumbs={[{ label: t('Tenant'), href: to.admin('tenants') }]}
        title={tn.name}
        badge={<StatusBadge status={tn.status} />}
        sub={t('{slug} · {members} membri · {guests} ospiti', { slug: tn.slug, members: tn.members, guests: tn.guests })}
        more={
          <DropdownMenuItem variant={tn.status === 'active' ? 'destructive' : 'default'} onSelect={() => void toggle()}>
            <Power />
            {tn.status === 'active' ? t('Sospendi il tenant') : t('Riattiva il tenant')}
          </DropdownMenuItem>
        }
      />
      <Tabs
        tabs={[
          { id: 'details', label: t('Dettagli') },
          { id: 'users', label: t('Utenti e gestori'), count: members.data?.length },
        ]}
        current={cur}
        href={(s) => to.adminTenant(id, s === 'details' ? undefined : s)}
      />
      <div className="p-6 max-[620px]:p-4">

        {cur === 'details' ? (
          <Card className="max-w-2xl">
            <CardHeader>
              <CardTitle>{t('Tenant')}</CardTitle>
              <CardDescription>{t('Accesso con account locali. L’accesso con un provider di identità (OIDC) arriva nella fase 2.')}</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
                <dt className="text-muted-foreground">{t('Nome')}</dt>
                <dd>{tn.name}</dd>
                <dt className="text-muted-foreground">{t('Identificativo')}</dt>
                <dd className="font-mono">{tn.slug}</dd>
                <dt className="text-muted-foreground">{t('Accesso')}</dt>
                <dd>{t('Account locali')}</dd>
                <dt className="text-muted-foreground">{t('Risorse')}</dt>
                <dd>
                  {tn.resources} · {fmtBytes(tn.bytes)}
                </dd>
                <dt className="text-muted-foreground">{t('Creato')}</dt>
                <dd>{fmtDate(tn.created_at)}</dd>
              </dl>
            </CardContent>
          </Card>
        ) : (
          <TenantUsers id={id} q={members} />
        )}
      </div>
    </>
  )
}

function TenantUsers({ id, q }: { id: string; q: { data?: Member[]; isLoading: boolean; error: unknown } }) {
  const base = `/api/admin/tenants/${id}`
  const [dlg, setDlg] = useState<null | 'manager' | Member>(null)
  const inval = [['admin-members', id], ['admin-tenants']]
  const setRole = useAction(({ uid, role }: { uid: string; role: string }) => api('PUT', `${base}/members/${uid}/role`, { role }), { ok: t('Ruolo aggiornato'), invalidate: inval })
  const newManager = useAction((v: Record<string, string>) => api('POST', `${base}/managers`, v), { ok: (v) => t('{username} è Tenant Manager', { username: v.username }), invalidate: inval })
  const resetPw = useAction(({ uid, password }: { uid: string; password: string }) => api('POST', `${base}/members/${uid}/password`, { password }), { ok: t('Password reimpostata') })
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-muted-foreground">{t('Utenti e ruoli, mai i contenuti: per nominare o sostituire un Tenant Manager e sbloccare un accesso.')}</p>
        <Button variant="outline" onClick={() => setDlg('manager')}>
          <Plus />
          {t('Nuovo Tenant Manager')}
        </Button>
      </div>
      <div className="overflow-hidden rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('Utente')}</TableHead>
              <TableHead className="w-48">{t('Ruolo')}</TableHead>
              <TableHead>{t('Stato')}</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(q.data ?? []).map((m) => (
              <TableRow key={m.user_id}>
                <TableCell>
                  <div className="font-medium">{m.display_name || m.username}</div>
                  <div className="text-xs text-muted-foreground">
                    {m.username}@{m.home_tenant}
                    {m.is_guest && ' · ospite'}
                  </div>
                </TableCell>
                <TableCell>
                  <Select value={m.role} onValueChange={(role) => setRole.mutate({ uid: m.user_id, role })}>
                    <SelectTrigger size="sm" aria-label={t('Ruolo di {username}', { username: m.username })}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="tenant_manager">{t('Tenant Manager')}</SelectItem>
                      <SelectItem value="user">{t('User')}</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <StatusBadge status={m.status} />
                </TableCell>
                <TableCell>
                  {!m.is_guest && (
                    <Button variant="ghost" size="icon" aria-label={t('Reimposta la password di {username}', { username: m.username })} onClick={() => setDlg(m)}>
                      <KeyRound />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <FormDialog
        open={dlg === 'manager'}
        onOpenChange={(o) => !o && setDlg(null)}
        title={t('Nuovo Tenant Manager')}
        description={t('Un account locale del tenant, con il ruolo di Tenant Manager.')}
        fields={[
          { name: 'username', label: t('Username'), required: true },
          { name: 'display_name', label: t('Nome') },
          { name: 'password', label: t('Password iniziale'), type: 'password', required: true, hint: t('Almeno 10 caratteri') },
        ]}
        submit={t('Crea')}
        onSubmit={(v) => newManager.mutateAsync(v)}
      />
      <FormDialog
        open={!!dlg && dlg !== 'manager'}
        onOpenChange={(o) => !o && setDlg(null)}
        title={t('Nuova password per {v}', { v: dlg && dlg !== 'manager' ? dlg.username : '' })}
        fields={[{ name: 'password', label: t('Nuova password'), type: 'password', required: true, hint: t('Almeno 10 caratteri') }]}
        submit={t('Reimposta')}
        onSubmit={(v) => resetPw.mutateAsync({ uid: (dlg as Member).user_id, password: v.password })}
      />
    </div>
  )
}

/* ── Plugin ──────────────────────────────────────────────────────────── */

/** I plugin della piattaforma: installati (attivi o no) e il catalogo dei registri fidati. Un plugin con
 *  pagine proprie e' un'App, senza e' un Servizio (docs/refactoring-ui.md §4). */
export function AdminPlugins({ section }: { section?: string }) {
  const installed = useApi<AdminPlugin[]>(['admin-plugins'], '/api/admin/plugins')
  const catalog = useApi<CatalogItem[]>(['admin-catalog'], '/api/admin/catalog')
  const confirm = useConfirm()
  const file = useRef<HTMLInputElement>(null)
  const cur = section === 'updates' || section === 'catalog' ? section : 'installed'
  const inval = [['admin-plugins'], ['admin-catalog'], ['admin-overview']]
  const act = useAction(({ id, action }: { id: string; action: 'activate' | 'deactivate' }) => api('POST', `/api/admin/plugins/${enc(id)}/${action}`), {
    ok: ({ action }) => (action === 'activate' ? t('Plugin attivato') : t('Plugin disattivato')),
    invalidate: inval,
  })
  const uninstall = useAction((id: string) => api('DELETE', `/api/admin/plugins/${enc(id)}`), { ok: t('Plugin disinstallato'), invalidate: inval })
  const install = useAction((id: string) => api('POST', `/api/admin/catalog/${enc(id)}/install`), { ok: t('Plugin installato'), invalidate: inval })
  const upload = useAction((f: File) => api('POST', '/api/admin/plugins', undefined, { raw: f }), { ok: t('Pacchetto installato'), invalidate: inval })
  const updates = (catalog.data ?? []).filter((c) => c.update_available)
  const available = (catalog.data ?? []).filter((c) => !c.installed)
  return (
    <>
      <PageHeader
        title={t('Plugin')}
        sub={t('Installati sulla piattaforma e disponibili nei registri fidati')}
        actions={
          <>
            <input
              ref={file}
              type="file"
              accept=".mskp"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) upload.mutate(f)
                e.target.value = ''
              }}
            />
            <Button onClick={() => file.current?.click()}>
              <Upload />
              {t('Installa da file')}
            </Button>
          </>
        }
      />
      <div className="grid gap-3 p-6 max-[620px]:p-4">
        <Pills
          items={[
            { id: 'installed', label: t('Installati'), count: installed.data?.length },
            { id: 'updates', label: t('Aggiornamenti'), count: updates.length },
            { id: 'catalog', label: t('Catalogo'), count: available.length },
          ]}
          value={cur}
          onChange={(id) => go(to.admin('plugins', id === 'installed' ? undefined : id))}
        />
        {cur === 'installed' ? (
          installed.isLoading ? (
            <Loading />
          ) : installed.error ? (
            <ErrorBox error={installed.error} />
          ) : !installed.data?.length ? (
            <Empty icon={<Puzzle />} title={t('Nessun plugin installato')} />
          ) : (
            <div className="overflow-hidden rounded-xl border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('Plugin')}</TableHead>
                    <TableHead>{t('Tipo')}</TableHead>
                    <TableHead>{t('Versione')}</TableHead>
                    <TableHead>{t('Firma')}</TableHead>
                    <TableHead>{t('Stato')}</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {installed.data.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>
                        <span className="flex items-center gap-2.5">
                          <AppIcon id={p.id} className="size-5 text-primary" />
                          <span>
                            <b className="block font-medium">{p.label}</b>
                            <span className="font-mono text-xs text-muted-foreground">{p.id}</span>
                          </span>
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="font-normal">
                          {p.has_ui ? 'App' : 'Servizio'}
                        </Badge>
                        {p.dev && (
                          <Badge variant="outline" className="ml-1.5 font-normal">
                            sviluppo
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{p.version}</TableCell>
                      <TableCell className="text-sm">{p.signed_by ?? <span className="text-warn">{t('non firmato')}</span>}</TableCell>
                      <TableCell>
                        <StatusBadge status={p.status} />
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" aria-label={t('Azioni per {label}', { label: p.label })}>
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {p.status === 'active' ? (
                              <DropdownMenuItem onSelect={async () => (await confirm(t('Disattivare {label}? Si spegne in tutti i tenant.', { label: p.label }), true)) && act.mutate({ id: p.id, action: 'deactivate' })}>
                                <Power />
                                {t('Disattiva')}
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem onSelect={() => act.mutate({ id: p.id, action: 'activate' })}>
                                <Power />
                                {t('Attiva')}
                              </DropdownMenuItem>
                            )}
                            {!p.dev && (
                              <DropdownMenuItem
                                variant="destructive"
                                onSelect={async () => (await confirm(t('Disinstallare {label}? I suoi dati restano nel database.', { label: p.label }), true)) && uninstall.mutate(p.id)}
                              >
                                <Trash2 />
                                {t('Disinstalla')}
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )
        ) : catalog.isLoading ? (
          <Loading />
        ) : catalog.error ? (
          <ErrorBox error={catalog.error} />
        ) : (cur === 'updates' ? updates : available).length === 0 ? (
          <Empty icon={<Puzzle />} title={cur === 'updates' ? t('Nessun aggiornamento') : t('Niente da installare nel catalogo')} />
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('Plugin')}</TableHead>
                  <TableHead>{t('Versione')}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(cur === 'updates' ? updates : available).map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <b className="block font-medium">{c.name}</b>
                      <span className="line-clamp-1 text-xs text-muted-foreground">{c.description}</span>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{c.installed ? `${c.installed} → ${c.latest}` : c.latest}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" disabled={install.isPending} onClick={() => install.mutate(c.id)}>
                        {c.installed ? 'Aggiorna' : 'Installa'}
                      </Button>
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

/* ── Sistema ─────────────────────────────────────────────────────────── */

export function AdminSystem({ session, section }: { session: Session; section?: string }) {
  const sections = [
    { id: 'admins', label: t('Amministratori'), icon: <ShieldCheck />, group: t('Piattaforma') },
    { id: 'identity', label: t('Identità e testi'), icon: <Info />, group: t('Identità e aspetto') },
    { id: 'theme', label: t('Tema'), icon: <Palette /> },
    { id: 'topbar', label: t('Barra in alto'), icon: <PanelTop /> },
  ]
  const cur = sections.some((s) => s.id === section) ? section! : 'admins'
  return (
    <>
      <PageHeader title={t('Sistema')} sub={t('Impostazioni della piattaforma, per tutti i tenant')} />
      <Sections sections={sections} current={cur} href={(id) => to.admin('system', id)}>
        {cur === 'admins' && <Admins me={session.user.user_id} />}
        {cur === 'identity' && <Identity />}
        {cur === 'theme' && <PlatformTheme session={session} />}
        {cur === 'topbar' && <BandSettings session={session} />}
      </Sections>
    </>
  )
}

function Identity() {
  const brand = useBrand()
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>{t('Identità e testi')}</CardTitle>
        <CardDescription>{t('Dal marchio della distribuzione (brand.toml). Modificarli da qui arriverà con il kernel.')}</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-[max-content_1fr] items-center gap-x-6 gap-y-3 text-sm">
          <dt className="text-muted-foreground">{t('Logo')}</dt>
          <dd>
            <AppMark />
          </dd>
          <dt className="text-muted-foreground">{t('Nome')}</dt>
          <dd>{brand.name}</dd>
          <dt className="text-muted-foreground">{t('Versione')}</dt>
          <dd className="font-mono">{brand.version}</dd>
        </dl>
      </CardContent>
    </Card>
  )
}

const bandItems = (): { key: keyof ShellBand; label: string; off: string }[] => [
  { key: 'logo', label: t('Logo e nome dell’applicazione'), off: t('il pulsante della sidebar prende il posto del logo.') },
  { key: 'search', label: t('Ricerca'), off: t('spariscono la casella e Ctrl K; resta la ricerca nelle pagine.') },
  { key: 'lang', label: t('Lingua'), off: t('la lingua si sceglie in Account › Aspetto e lingua.') },
  { key: 'help', label: t('Guida'), off: t('tour, guida e novità passano nel menu della persona.') },
  { key: 'mode', label: t('Tonalità (chiaro, scuro, automatico)'), off: t('vale il modo predefinito; la persona lo cambia in Account.') },
]

/** La barra in alto, decisa dall'Administrator per tutti i tenant, con l'anteprima. Campanella, menu
 *  della persona e selettore del tenant restano sempre. */
function BandSettings({ session }: { session: Session }) {
  const qc = useQueryClient()
  const saved = bandOf(session)
  const [v, setV] = useState<ShellBand | null>(null)
  const b = v ?? saved
  const save = useAction((x: ShellBand) => api('PUT', '/api/admin/band', x), { ok: t('Barra in alto aggiornata per tutti'), invalidate: [['session']] })
  const dirty = !!v && JSON.stringify(v) !== JSON.stringify(saved)
  return (
    <div className="grid max-w-3xl gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('Anteprima')}</CardTitle>
          <CardDescription>{t('Uguale per tutti i tenant.')}</CardDescription>
        </CardHeader>
        <CardContent>
          <BandPreview band={b} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('Elementi')}</CardTitle>
          <CardDescription>{t('Campanella, menu della persona e selettore del tenant restano sempre.')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-1">
          {bandItems().map((it) => (
            <label key={it.key} className="flex items-center justify-between gap-4 border-b py-3 last:border-0">
              <span>
                <b className="block text-sm">{it.label}</b>
                <span className="text-xs text-muted-foreground">Se è spento: {it.off}</span>
              </span>
              <Switch checked={b[it.key]} onCheckedChange={(x) => setV({ ...b, [it.key]: x })} />
            </label>
          ))}
        </CardContent>
      </Card>
      <SaveBar
        dirty={dirty}
        busy={save.isPending}
        onSave={() => v && save.mutate(v, { onSuccess: () => (setV(null), void qc.invalidateQueries({ queryKey: ['session'] })) })}
        onCancel={() => setV(null)}
      />
    </div>
  )
}

function BandPreview({ band }: { band: ShellBand }) {
  const brand = useBrand()
  const icon = 'flex size-6 items-center justify-center rounded text-band-foreground/90 [&>svg]:size-3.5'
  return (
    <div aria-hidden="true" className="flex h-10 items-center overflow-hidden rounded-lg border bg-band text-band-foreground">
      <div className="flex h-full w-40 shrink-0 items-center gap-2 border-r border-band-line px-3">
        {band.logo ? (
          <>
            <AppMark className="size-5" />
            <b className="truncate text-xs">{brand.name}</b>
          </>
        ) : (
          <span className={icon}>
            <PanelLeft />
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-2 px-2">
        {band.logo && (
          <span className={icon}>
            <PanelLeft />
          </span>
        )}
        <span className="truncate rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-semibold">{t('Comune di Esempio')}</span>
        <span className="flex flex-1 justify-center">{band.search && <span className="flex h-6 w-full max-w-48 items-center gap-1.5 rounded bg-search px-2 text-[11px] text-search-foreground"><Search className="size-3" />{t('Cerca ovunque')}</span>}</span>
        {band.lang && <span className={cn(icon, 'font-mono text-[10px] font-semibold')}>{t('IT')}</span>}
        {band.mode && (
          <span className={icon}>
            <Contrast />
          </span>
        )}
        {band.help && (
          <span className={icon}>
            <CircleHelp />
          </span>
        )}
        <span className={icon}>
          <Bell />
        </span>
        <span className="flex size-6 items-center justify-center rounded-full bg-teal-700 text-[9px] font-semibold text-white">{t('ER')}</span>
      </div>
    </div>
  )
}

function Admins({ me }: { me: string }) {
  const q = useApi<AdminUser[]>(['admins'], '/api/admin/administrators')
  const confirm = useConfirm()
  const [dlg, setDlg] = useState<null | 'new' | AdminUser>(null)
  const inval = [['admins'], ['admin-overview']]
  const create = useAction((v: Record<string, string>) => api('POST', '/api/admin/administrators', v), { ok: (v) => t('Administrator {username} creato', { username: v.username }), invalidate: inval })
  const status = useAction(({ id, active }: { id: string; active: boolean }) => api('PUT', `/api/admin/administrators/${id}/status`, { active }), {
    ok: ({ active }) => (active ? t('Riattivato') : t('Disabilitato: le sue sessioni sono chiuse')),
    invalidate: inval,
  })
  const totp = useAction((id: string) => api('DELETE', `/api/admin/administrators/${id}/totp`), { ok: t('Secondo fattore rimosso: al prossimo accesso registra di nuovo l’app'), invalidate: inval })
  const pw = useAction(({ id, password }: { id: string; password: string }) => api('POST', `/api/admin/administrators/${id}/password`, { password }), { ok: t('Password reimpostata') })
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />
  return (
    <div className="grid max-w-4xl gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-muted-foreground">
          {t('Account della piattaforma, separati da quelli dei tenant: accedono da «Accesso amministratori» con password locale e secondo fattore. Ne resta sempre almeno uno attivo.')}
        </p>
        <Button onClick={() => setDlg('new')}>
          <Plus />
          {t('Nuovo Administrator')}
        </Button>
      </div>
      <div className="overflow-hidden rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('Administrator')}</TableHead>
              <TableHead>{t('Stato')}</TableHead>
              <TableHead>{t('Secondo fattore')}</TableHead>
              <TableHead>{t('Creato')}</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(q.data ?? []).map((a) => (
              <TableRow key={a.user_id}>
                <TableCell>
                  <div className="flex items-center gap-2.5">
                    <span className="flex size-8 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">{initials(a.display_name || a.username)}</span>
                    <div>
                      <div className="font-medium">
                        {a.display_name || a.username}
                        {a.user_id === me && (
                          <Badge variant="secondary" className="ml-2 font-normal">
                            tu
                          </Badge>
                        )}
                      </div>
                      <div className="font-mono text-xs text-muted-foreground">{a.username}</div>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <StatusBadge status={a.status} />
                </TableCell>
                <TableCell>{a.totp ? <Badge className="bg-ok/10 font-normal text-ok">attivo</Badge> : <Badge variant="secondary" className="font-normal">{t('da registrare')}</Badge>}</TableCell>
                <TableCell className="text-muted-foreground">{fmtDate(a.created_at)}</TableCell>
                <TableCell>
                  {a.user_id !== me && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label={t('Azioni per {username}', { username: a.username })}>
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setDlg(a)}>
                          <KeyRound />
                          {t('Reimposta la password')}
                        </DropdownMenuItem>
                        {a.totp && (
                          <DropdownMenuItem onSelect={async () => (await confirm(t('Togliere il secondo fattore a {username}?', { username: a.username }), true)) && totp.mutate(a.user_id)}>
                            <ShieldCheck />
                            {t('Reimposta il secondo fattore')}
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          variant={a.status === 'active' ? 'destructive' : 'default'}
                          onSelect={async () => {
                            const active = a.status !== 'active'
                            if (active || (await confirm(t('Disabilitare {username}? Le sue sessioni vengono chiuse.', { username: a.username }), true))) status.mutate({ id: a.user_id, active })
                          }}
                        >
                          <Users />
                          {a.status === 'active' ? 'Disabilita' : 'Riattiva'}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <FormDialog
        open={dlg === 'new'}
        onOpenChange={(o) => !o && setDlg(null)}
        title={t('Nuovo Administrator')}
        description={t('Al primo accesso registra il secondo fattore.')}
        fields={[
          { name: 'username', label: t('Username'), required: true },
          { name: 'display_name', label: t('Nome') },
          { name: 'password', label: t('Password iniziale'), type: 'password', required: true, hint: t('Almeno 10 caratteri') },
        ]}
        submit={t('Crea')}
        onSubmit={(v) => create.mutateAsync(v)}
      />
      <FormDialog
        open={!!dlg && dlg !== 'new'}
        onOpenChange={(o) => !o && setDlg(null)}
        title={t('Nuova password per {v}', { v: dlg && dlg !== 'new' ? dlg.username : '' })}
        fields={[{ name: 'password', label: t('Nuova password'), type: 'password', required: true, hint: t('Almeno 10 caratteri') }]}
        submit={t('Reimposta')}
        onSubmit={(v) => pw.mutateAsync({ id: (dlg as AdminUser).user_id, password: v.password })}
      />
    </div>
  )
}
