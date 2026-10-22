// Pagine dell'Administrator: panoramica della piattaforma, tenant e dettaglio a schede, plugin, Sistema
// (amministratori, identita' e barra in alto). Account e Notifiche sono in common.tsx e notifications.tsx.

import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Bell, Building2, CircleHelp, Contrast, Info, KeyRound, MoreHorizontal, Palette, PanelLeft, PanelTop, Plus, Power, Puzzle, Search, ShieldCheck, Trash2, Upload, Users } from 'lucide-react'
import { api, fmtBytes, fmtDate } from '../../api.ts'
import { useBrand } from '../../brand.ts'
import type { AdminPlugin, AdminUser, CatalogItem, Member, Session, ShellBand, SystemOverview, TenantInfo } from '../../types.ts'
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
import { Empty, ErrorBox, FormDialog, Kpi, Loading, PageHeader, Pills, SaveBar, Sections, StatusBadge, Tabs } from '../kit.tsx'
import { go, to } from '../router.ts'
import { bandOf } from '../prefs.ts'
import { AppMark } from '../Shell.tsx'
import { PlatformTheme } from '../ThemeSettings.tsx'

const enc = encodeURIComponent

/* ── Panoramica ──────────────────────────────────────────────────────── */

export function AdminOverview({ session }: { session: Session }) {
  const q = useApi<SystemOverview>(['admin-overview'], '/api/admin/overview')
  return (
    <>
      <PageHeader title="Panoramica della piattaforma" sub={`Ciao ${session.user.display_name || session.user.username} · Administrator`} />
      <div className="grid gap-6 p-6 max-[620px]:p-4">
        {q.isLoading ? (
          <Loading />
        ) : q.error ? (
          <ErrorBox error={q.error} />
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
            <Kpi label="Tenant attivi" value={`${q.data!.active_tenants}/${q.data!.tenants}`} onClick={() => go(to.admin('tenants'))} />
            <Kpi label="Utenti attivi" value={q.data!.users} hint={`${q.data!.active_users_30d} negli ultimi 30 giorni`} />
            <Kpi label="Administrator" value={q.data!.administrators} onClick={() => go(to.admin('system', 'admins'))} />
            <Kpi label="Risorse" value={q.data!.resources} hint={fmtBytes(q.data!.bytes)} />
            <Kpi label="Plugin attivi" value={`${q.data!.plugins_active}/${q.data!.plugins_installed}`} onClick={() => go(to.admin('plugins'))} />
          </div>
        )}
        {q.data?.tenants === 0 && (
          <Empty icon={<Building2 />} title="Nessun tenant">
            <Button className="mt-2" onClick={() => go(to.admin('tenants'))}>
              Crea il primo tenant
            </Button>
          </Empty>
        )}
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
    ok: (v) => `Tenant ${v.name} creato con il suo Tenant Manager`,
    invalidate: [['admin-tenants'], ['admin-overview']],
  })
  const rows = (q.data ?? []).filter((t) => !search || `${t.name} ${t.slug}`.toLowerCase().includes(search.toLowerCase()))
  return (
    <>
      <PageHeader
        title="Tenant"
        sub={q.data ? `${q.data.length} tenant` : undefined}
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus />
            Nuovo tenant
          </Button>
        }
      />
      <div className="grid gap-3 p-6 max-[620px]:p-4">
        <Input type="search" placeholder="Cerca un tenant" aria-label="Cerca un tenant" className="w-72 max-w-full" value={search} onChange={(e) => setSearch(e.target.value)} />
        {q.isLoading ? (
          <Loading />
        ) : q.error ? (
          <ErrorBox error={q.error} />
        ) : rows.length === 0 ? (
          <Empty icon={<Building2 />} title={q.data?.length ? 'Nessun tenant trovato' : 'Nessun tenant'} />
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tenant</TableHead>
                  <TableHead className="text-right">Membri</TableHead>
                  <TableHead className="text-right">Ospiti</TableHead>
                  <TableHead className="text-right">Risorse</TableHead>
                  <TableHead className="text-right">Spazio</TableHead>
                  <TableHead>Stato</TableHead>
                  <TableHead>Creato</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((t) => (
                  <TableRow key={t.id} className="cursor-pointer" onClick={() => go(to.adminTenant(t.id))}>
                    <TableCell>
                      <a href={to.adminTenant(t.id)} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
                        {t.name}
                      </a>
                      <span className="ml-2 font-mono text-xs text-muted-foreground">{t.slug}</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{t.members}</TableCell>
                    <TableCell className="text-right tabular-nums">{t.guests}</TableCell>
                    <TableCell className="text-right tabular-nums">{t.resources}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtBytes(t.bytes)}</TableCell>
                    <TableCell>
                      <StatusBadge status={t.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">{fmtDate(t.created_at)}</TableCell>
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
        title="Nuovo tenant"
        description="Con il suo primo Tenant Manager, un account locale del tenant."
        fields={[
          { name: 'slug', label: 'Identificativo', required: true, hint: 'Minuscole, cifre e trattini: va nell’indirizzo e non cambia' },
          { name: 'name', label: 'Nome', required: true },
          { name: 'manager_username', label: 'Username del Tenant Manager', required: true },
          { name: 'manager_display_name', label: 'Nome del Tenant Manager' },
          { name: 'manager_password', label: 'Password iniziale', type: 'password', required: true, hint: 'Almeno 10 caratteri' },
        ]}
        submit="Crea il tenant"
        onSubmit={(v) => create.mutateAsync(v)}
      />
    </>
  )
}

export function AdminTenant({ id, section }: { id: string; section?: string }) {
  const tenants = useApi<TenantInfo[]>(['admin-tenants'], '/api/admin/tenants')
  const members = useApi<Member[]>(['admin-members', id], `/api/admin/tenants/${id}/members`)
  const confirm = useConfirm()
  const t = tenants.data?.find((x) => x.id === id)
  const cur = section === 'users' ? 'users' : 'details'
  const toggle = async () => {
    const next = t!.status === 'active' ? 'suspended' : 'active'
    if (next === 'active' || (await confirm(`Sospendere ${t!.name}? Le sue persone non potranno più accedere.`, true))) status.mutate(next)
  }
  const status = useAction((s: string) => api('PUT', `/api/admin/tenants/${id}/status`, { status: s }), {
    ok: (s) => (s === 'active' ? 'Tenant riattivato' : 'Tenant sospeso'),
    invalidate: [['admin-tenants'], ['admin-overview']],
  })
  if (tenants.isLoading) return <Loading />
  if (!t) return <Empty title="Tenant inesistente" />
  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Tenant', href: to.admin('tenants') }]}
        title={t.name}
        badge={<StatusBadge status={t.status} />}
        sub={`${t.slug} · ${t.members} membri · ${t.guests} ospiti`}
        more={
          <DropdownMenuItem variant={t.status === 'active' ? 'destructive' : 'default'} onSelect={() => void toggle()}>
            <Power />
            {t.status === 'active' ? 'Sospendi il tenant' : 'Riattiva il tenant'}
          </DropdownMenuItem>
        }
      />
      <Tabs
        tabs={[
          { id: 'details', label: 'Dettagli' },
          { id: 'users', label: 'Utenti e gestori', count: members.data?.length },
        ]}
        current={cur}
        href={(s) => to.adminTenant(id, s === 'details' ? undefined : s)}
      />
      <div className="p-6 max-[620px]:p-4">

        {cur === 'details' ? (
          <Card className="max-w-2xl">
            <CardHeader>
              <CardTitle>Tenant</CardTitle>
              <CardDescription>Accesso con account locali. L’accesso con un provider di identità (OIDC) arriva nella fase 2.</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
                <dt className="text-muted-foreground">Nome</dt>
                <dd>{t.name}</dd>
                <dt className="text-muted-foreground">Identificativo</dt>
                <dd className="font-mono">{t.slug}</dd>
                <dt className="text-muted-foreground">Accesso</dt>
                <dd>Account locali</dd>
                <dt className="text-muted-foreground">Risorse</dt>
                <dd>
                  {t.resources} · {fmtBytes(t.bytes)}
                </dd>
                <dt className="text-muted-foreground">Creato</dt>
                <dd>{fmtDate(t.created_at)}</dd>
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
  const setRole = useAction(({ uid, role }: { uid: string; role: string }) => api('PUT', `${base}/members/${uid}/role`, { role }), { ok: 'Ruolo aggiornato', invalidate: inval })
  const newManager = useAction((v: Record<string, string>) => api('POST', `${base}/managers`, v), { ok: (v) => `${v.username} è Tenant Manager`, invalidate: inval })
  const resetPw = useAction(({ uid, password }: { uid: string; password: string }) => api('POST', `${base}/members/${uid}/password`, { password }), { ok: 'Password reimpostata' })
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-muted-foreground">Utenti e ruoli, mai i contenuti: per nominare o sostituire un Tenant Manager e sbloccare un accesso.</p>
        <Button variant="outline" onClick={() => setDlg('manager')}>
          <Plus />
          Nuovo Tenant Manager
        </Button>
      </div>
      <div className="overflow-hidden rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Utente</TableHead>
              <TableHead className="w-48">Ruolo</TableHead>
              <TableHead>Stato</TableHead>
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
                    <SelectTrigger size="sm" aria-label={`Ruolo di ${m.username}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="tenant_manager">Tenant Manager</SelectItem>
                      <SelectItem value="user">User</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <StatusBadge status={m.status} />
                </TableCell>
                <TableCell>
                  {!m.is_guest && (
                    <Button variant="ghost" size="icon" aria-label={`Reimposta la password di ${m.username}`} onClick={() => setDlg(m)}>
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
        title="Nuovo Tenant Manager"
        description="Un account locale del tenant, con il ruolo di Tenant Manager."
        fields={[
          { name: 'username', label: 'Username', required: true },
          { name: 'display_name', label: 'Nome' },
          { name: 'password', label: 'Password iniziale', type: 'password', required: true, hint: 'Almeno 10 caratteri' },
        ]}
        submit="Crea"
        onSubmit={(v) => newManager.mutateAsync(v)}
      />
      <FormDialog
        open={!!dlg && dlg !== 'manager'}
        onOpenChange={(o) => !o && setDlg(null)}
        title={`Nuova password per ${dlg && dlg !== 'manager' ? dlg.username : ''}`}
        fields={[{ name: 'password', label: 'Nuova password', type: 'password', required: true, hint: 'Almeno 10 caratteri' }]}
        submit="Reimposta"
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
    ok: ({ action }) => (action === 'activate' ? 'Plugin attivato' : 'Plugin disattivato'),
    invalidate: inval,
  })
  const uninstall = useAction((id: string) => api('DELETE', `/api/admin/plugins/${enc(id)}`), { ok: 'Plugin disinstallato', invalidate: inval })
  const install = useAction((id: string) => api('POST', `/api/admin/catalog/${enc(id)}/install`), { ok: 'Plugin installato', invalidate: inval })
  const upload = useAction((f: File) => api('POST', '/api/admin/plugins', undefined, { raw: f }), { ok: 'Pacchetto installato', invalidate: inval })
  const updates = (catalog.data ?? []).filter((c) => c.update_available)
  const available = (catalog.data ?? []).filter((c) => !c.installed)
  return (
    <>
      <PageHeader
        title="Plugin"
        sub="Installati sulla piattaforma e disponibili nei registri fidati"
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
              Installa da file
            </Button>
          </>
        }
      />
      <div className="grid gap-3 p-6 max-[620px]:p-4">
        <Pills
          items={[
            { id: 'installed', label: 'Installati', count: installed.data?.length },
            { id: 'updates', label: 'Aggiornamenti', count: updates.length },
            { id: 'catalog', label: 'Catalogo', count: available.length },
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
            <Empty icon={<Puzzle />} title="Nessun plugin installato" />
          ) : (
            <div className="overflow-hidden rounded-xl border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Plugin</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Versione</TableHead>
                    <TableHead>Firma</TableHead>
                    <TableHead>Stato</TableHead>
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
                      <TableCell className="text-sm">{p.signed_by ?? <span className="text-warn">non firmato</span>}</TableCell>
                      <TableCell>
                        <StatusBadge status={p.status} />
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" aria-label={`Azioni per ${p.label}`}>
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {p.status === 'active' ? (
                              <DropdownMenuItem onSelect={async () => (await confirm(`Disattivare ${p.label}? Si spegne in tutti i tenant.`, true)) && act.mutate({ id: p.id, action: 'deactivate' })}>
                                <Power />
                                Disattiva
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem onSelect={() => act.mutate({ id: p.id, action: 'activate' })}>
                                <Power />
                                Attiva
                              </DropdownMenuItem>
                            )}
                            {!p.dev && (
                              <DropdownMenuItem
                                variant="destructive"
                                onSelect={async () => (await confirm(`Disinstallare ${p.label}? I suoi dati restano nel database.`, true)) && uninstall.mutate(p.id)}
                              >
                                <Trash2 />
                                Disinstalla
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
          <Empty icon={<Puzzle />} title={cur === 'updates' ? 'Nessun aggiornamento' : 'Niente da installare nel catalogo'} />
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Plugin</TableHead>
                  <TableHead>Versione</TableHead>
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
    { id: 'admins', label: 'Amministratori', icon: <ShieldCheck />, group: 'Piattaforma' },
    { id: 'identity', label: 'Identità e testi', icon: <Info />, group: 'Identità e aspetto' },
    { id: 'theme', label: 'Tema', icon: <Palette /> },
    { id: 'topbar', label: 'Barra in alto', icon: <PanelTop /> },
  ]
  const cur = sections.some((s) => s.id === section) ? section! : 'admins'
  return (
    <>
      <PageHeader title="Sistema" sub="Impostazioni della piattaforma, per tutti i tenant" />
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
        <CardTitle>Identità e testi</CardTitle>
        <CardDescription>Dal marchio della distribuzione (brand.toml). Modificarli da qui arriverà con il kernel.</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-[max-content_1fr] items-center gap-x-6 gap-y-3 text-sm">
          <dt className="text-muted-foreground">Logo</dt>
          <dd>
            <AppMark />
          </dd>
          <dt className="text-muted-foreground">Nome</dt>
          <dd>{brand.name}</dd>
          <dt className="text-muted-foreground">Versione</dt>
          <dd className="font-mono">{brand.version}</dd>
        </dl>
      </CardContent>
    </Card>
  )
}

const BAND_ITEMS: { key: keyof ShellBand; label: string; off: string }[] = [
  { key: 'logo', label: 'Logo e nome dell’applicazione', off: 'il pulsante della sidebar prende il posto del logo.' },
  { key: 'search', label: 'Ricerca', off: 'spariscono la casella e Ctrl K; resta la ricerca nelle pagine.' },
  { key: 'lang', label: 'Lingua', off: 'la lingua si sceglie in Account › Aspetto e lingua.' },
  { key: 'help', label: 'Guida', off: 'tour, guida e novità passano nel menu della persona.' },
  { key: 'mode', label: 'Tonalità (chiaro, scuro, automatico)', off: 'vale il modo predefinito; la persona lo cambia in Account.' },
]

/** La barra in alto, decisa dall'Administrator per tutti i tenant, con l'anteprima. Campanella, menu
 *  della persona e selettore del tenant restano sempre. */
function BandSettings({ session }: { session: Session }) {
  const qc = useQueryClient()
  const saved = bandOf(session)
  const [v, setV] = useState<ShellBand | null>(null)
  const b = v ?? saved
  const save = useAction((x: ShellBand) => api('PUT', '/api/admin/band', x), { ok: 'Barra in alto aggiornata per tutti', invalidate: [['session']] })
  const dirty = !!v && JSON.stringify(v) !== JSON.stringify(saved)
  return (
    <div className="grid max-w-3xl gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Anteprima</CardTitle>
          <CardDescription>Uguale per tutti i tenant.</CardDescription>
        </CardHeader>
        <CardContent>
          <BandPreview band={b} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Elementi</CardTitle>
          <CardDescription>Campanella, menu della persona e selettore del tenant restano sempre.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-1">
          {BAND_ITEMS.map((it) => (
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
        <span className="truncate rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-semibold">Comune di Esempio</span>
        <span className="flex flex-1 justify-center">{band.search && <span className="flex h-6 w-full max-w-48 items-center gap-1.5 rounded bg-search px-2 text-[11px] text-search-foreground"><Search className="size-3" />Cerca ovunque</span>}</span>
        {band.lang && <span className={cn(icon, 'font-mono text-[10px] font-semibold')}>IT</span>}
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
        <span className="flex size-6 items-center justify-center rounded-full bg-teal-500 text-[9px] font-semibold text-white">ER</span>
      </div>
    </div>
  )
}

function Admins({ me }: { me: string }) {
  const q = useApi<AdminUser[]>(['admins'], '/api/admin/administrators')
  const confirm = useConfirm()
  const [dlg, setDlg] = useState<null | 'new' | AdminUser>(null)
  const inval = [['admins'], ['admin-overview']]
  const create = useAction((v: Record<string, string>) => api('POST', '/api/admin/administrators', v), { ok: (v) => `Administrator ${v.username} creato`, invalidate: inval })
  const status = useAction(({ id, active }: { id: string; active: boolean }) => api('PUT', `/api/admin/administrators/${id}/status`, { active }), {
    ok: ({ active }) => (active ? 'Riattivato' : 'Disabilitato: le sue sessioni sono chiuse'),
    invalidate: inval,
  })
  const totp = useAction((id: string) => api('DELETE', `/api/admin/administrators/${id}/totp`), { ok: 'Secondo fattore rimosso: al prossimo accesso registra di nuovo l’app', invalidate: inval })
  const pw = useAction(({ id, password }: { id: string; password: string }) => api('POST', `/api/admin/administrators/${id}/password`, { password }), { ok: 'Password reimpostata' })
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />
  return (
    <div className="grid max-w-4xl gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-muted-foreground">
          Account della piattaforma, separati da quelli dei tenant: accedono da «Accesso amministratori» con password locale e secondo fattore. Ne resta sempre almeno uno attivo.
        </p>
        <Button onClick={() => setDlg('new')}>
          <Plus />
          Nuovo Administrator
        </Button>
      </div>
      <div className="overflow-hidden rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Administrator</TableHead>
              <TableHead>Stato</TableHead>
              <TableHead>Secondo fattore</TableHead>
              <TableHead>Creato</TableHead>
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
                <TableCell>{a.totp ? <Badge className="bg-ok/10 font-normal text-ok">attivo</Badge> : <Badge variant="secondary" className="font-normal">da registrare</Badge>}</TableCell>
                <TableCell className="text-muted-foreground">{fmtDate(a.created_at)}</TableCell>
                <TableCell>
                  {a.user_id !== me && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label={`Azioni per ${a.username}`}>
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setDlg(a)}>
                          <KeyRound />
                          Reimposta la password
                        </DropdownMenuItem>
                        {a.totp && (
                          <DropdownMenuItem onSelect={async () => (await confirm(`Togliere il secondo fattore a ${a.username}?`, true)) && totp.mutate(a.user_id)}>
                            <ShieldCheck />
                            Reimposta il secondo fattore
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          variant={a.status === 'active' ? 'destructive' : 'default'}
                          onSelect={async () => {
                            const active = a.status !== 'active'
                            if (active || (await confirm(`Disabilitare ${a.username}? Le sue sessioni vengono chiuse.`, true))) status.mutate({ id: a.user_id, active })
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
        title="Nuovo Administrator"
        description="Al primo accesso registra il secondo fattore."
        fields={[
          { name: 'username', label: 'Username', required: true },
          { name: 'display_name', label: 'Nome' },
          { name: 'password', label: 'Password iniziale', type: 'password', required: true, hint: 'Almeno 10 caratteri' },
        ]}
        submit="Crea"
        onSubmit={(v) => create.mutateAsync(v)}
      />
      <FormDialog
        open={!!dlg && dlg !== 'new'}
        onOpenChange={(o) => !o && setDlg(null)}
        title={`Nuova password per ${dlg && dlg !== 'new' ? dlg.username : ''}`}
        fields={[{ name: 'password', label: 'Nuova password', type: 'password', required: true, hint: 'Almeno 10 caratteri' }]}
        submit="Reimposta"
        onSubmit={(v) => pw.mutateAsync({ id: (dlg as AdminUser).user_id, password: v.password })}
      />
    </div>
  )
}
