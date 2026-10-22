// The share dialog of the host, the same for every plugin (mockup: dlg-share). People and
// groups of the tenant with their level, the read-only public link (if the tenant allows them) and,
// for the owner or the Tenant Manager, the transfer of ownership.

import { useEffect, useState } from 'react'
import { Copy, Link2, Loader2, UserRound, Users, X } from 'lucide-react'
import { api, errText, fmtDate } from '../api.ts'
import type { Grant, Level, LinkInfo, Principal, ResourceMeta, TenantContext } from '../types.ts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useApi, useConfirm } from './core.ts'
import { t } from './i18n.ts'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

const enc = encodeURIComponent

function levels(): { v: Level; label: string; hint: string }[] {
  return [
    { v: 'read', label: t('Read'), hint: t('sees the content') },
    { v: 'write', label: t('Write'), hint: t('edits the content') },
    { v: 'manage', label: t('Manage'), hint: t('shares, moves, deletes') },
  ]
}

function LevelSelect({ value, onChange, label }: { value: Level; onChange: (l: Level) => void; label: string }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as Level)}>
      <SelectTrigger size="sm" className="w-36" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {levels().map((l) => (
          <SelectItem key={l.v} value={l.v}>
            {l.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** People and groups of the tenant matching the search. */
function useDirectory(slug: string, q: string) {
  const [found, setFound] = useState<Principal[]>([])
  useEffect(() => {
    const s = q.trim()
    if (!s) {
      setFound([])
      return
    }
    const h = setTimeout(() => {
      api<Principal[]>('GET', `/api/t/${enc(slug)}/directory?q=${enc(s)}`)
        .then(setFound)
        .catch(() => setFound([]))
    }, 200)
    return () => clearTimeout(h)
  }, [q, slug])
  return found
}

export default function ShareDialog({ ctx, resourceId, onClose }: { ctx: TenantContext; resourceId: string | null; onClose: () => void }) {
  const slug = ctx.tenant.slug
  const base = `/api/t/${enc(slug)}/resources/${resourceId}`
  const qc = useQueryClient()
  const confirm = useConfirm()
  const linksOn = ctx.tenant.settings.public_links_enabled
  const g = useApi<{ resource: ResourceMeta; grants: Grant[] }>(['grants', resourceId], resourceId ? `${base}/grants` : null)
  const links = useApi<LinkInfo[]>(['links', resourceId], resourceId && linksOn ? `${base}/links` : null)
  const [q, setQ] = useState('')
  const [pick, setPick] = useState<Principal | null>(null)
  const [level, setLevel] = useState<Level>('read')
  const [days, setDays] = useState(ctx.tenant.settings.public_link_max_days || 7)
  const [pw, setPw] = useState('')
  const [created, setCreated] = useState<string | null>(null)
  const [ownerQ, setOwnerQ] = useState('')
  const [busy, setBusy] = useState(false)
  const found = useDirectory(slug, q)
  const owners = useDirectory(slug, ownerQ)
  useEffect(() => {
    setQ('')
    setPick(null)
    setCreated(null)
    setOwnerQ('')
  }, [resourceId])

  const res = g.data?.resource
  const grants = g.data?.grants ?? []
  const reload = () => {
    void qc.invalidateQueries({ queryKey: ['grants', resourceId] })
    void qc.invalidateQueries({ queryKey: ['links', resourceId] })
    void qc.invalidateQueries({ queryKey: ['m-resources', slug] })
  }
  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true)
    try {
      await fn()
      toast.success(ok)
      reload()
    } catch (e) {
      toast.error(errText(e))
    } finally {
      setBusy(false)
    }
  }
  const setGrant = (p: { principal_type: string; principal_id: string }, l: Level | null) =>
    run(() => api('PUT', `${base}/grants`, { ...p, level: l }), l ? t('Sharing updated') : t('Access revoked'))
  const candidates = found.filter((p) => p.id !== res?.owner_id && !grants.some((x) => x.principal_id === p.id))
  const canOwn = !!res && (res.is_owner || ctx.tenant.role === 'tenant_manager')
  const icon = (kind: string) => (kind === 'group' ? <Users className="size-4 text-muted-foreground" /> : <UserRound className="size-4 text-muted-foreground" />)

  return (
    <Dialog open={!!resourceId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('Sharing')}</DialogTitle>
          <DialogDescription>
            {res ? (
              <>
                <b className="text-foreground">{res.title || t('(untitled)')}</b> · {t('owner {name}', { name: res.owner_name })}
              </>
            ) : (
              t('Loading…')
            )}
          </DialogDescription>
        </DialogHeader>
        {g.isLoading ? (
          <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
        ) : g.error ? (
          <p className="text-sm text-destructive">{errText(g.error)}</p>
        ) : (
          <div className="grid gap-6">
            <section className="grid gap-3">
              <h3 className="text-sm font-semibold">{t('People and groups of the tenant')}</h3>
              <div className="flex flex-wrap items-start gap-2">
                <div className="relative min-w-56 flex-1">
                  <Input
                    type="search"
                    placeholder={t('Search people or groups…')}
                    aria-label={t('Search people or groups')}
                    value={pick ? `${pick.name} (${pick.detail})` : q}
                    onChange={(e) => {
                      setPick(null)
                      setQ(e.target.value)
                    }}
                  />
                  {!pick && candidates.length > 0 && (
                    <ul role="listbox" aria-label={t('Results')} className="absolute inset-x-0 top-full z-10 mt-1 max-h-56 overflow-auto rounded-md border bg-popover p-1 shadow-md">
                      {candidates.map((p) => (
                        <li key={p.kind + p.id}>
                          <button
                            type="button"
                            role="option"
                            aria-selected={false}
                            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                            onClick={() => setPick(p)}
                          >
                            {icon(p.kind)}
                            <span className="flex-1">{p.name}</span>
                            <span className="font-mono text-xs text-muted-foreground">{p.detail}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <LevelSelect value={level} onChange={setLevel} label={t('Level')} />
                <Button
                  disabled={!pick || busy}
                  onClick={() =>
                    pick &&
                    void setGrant({ principal_type: pick.kind, principal_id: pick.id }, level).then(() => {
                      setPick(null)
                      setQ('')
                    })
                  }
                >
                  {t('Share')}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {levels()
                  .map((l) => `${l.label}: ${l.hint}`)
                  .join(' · ')}
                . {t('Whoever is not in the tenant must first be invited by the Tenant Manager.')}
              </p>
              <ul className="grid divide-y rounded-lg border" aria-label={t('Shared with')}>
                {grants.length === 0 && <li className="p-3 text-sm text-muted-foreground">{t('Not shared with anybody.')}</li>}
                {grants.map((x) => (
                  <li key={x.principal_type + x.principal_id} className="flex flex-wrap items-center gap-2 p-2 pl-3 text-sm">
                    {icon(x.principal_type)}
                    <span className="min-w-0 flex-1">
                      {x.name} <span className="font-mono text-xs text-muted-foreground">{x.detail}</span>
                    </span>
                    <LevelSelect value={x.level} onChange={(l) => void setGrant(x, l)} label={t('Level of {name}', { name: x.name })} />
                    <Button variant="ghost" size="sm" aria-label={t('Revoke from {name}', { name: x.name })} onClick={() => void setGrant(x, null)}>
                      <X />
                    </Button>
                  </li>
                ))}
              </ul>
            </section>

            <section className="grid gap-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <Link2 className="size-4" />
                {t('Public link (read only)')}
              </h3>
              {!linksOn ? (
                <p className="text-sm text-muted-foreground">{t('Public links are turned off for this tenant.')}</p>
              ) : (
                <>
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="grid gap-1.5">
                      <Label htmlFor="sh-days">{t('Expiry (days)')}</Label>
                      <Input
                        id="sh-days"
                        type="number"
                        className="w-32"
                        min={1}
                        max={ctx.tenant.settings.public_link_max_days || 3650}
                        value={days}
                        onChange={(e) => setDays(Number(e.target.value))}
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="sh-pw">{t('Password (optional)')}</Label>
                      <Input id="sh-pw" type="password" className="w-52" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
                    </div>
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          const l = await api<LinkInfo>('POST', `${base}/links`, { days, password: pw || null })
                          setCreated(l.url ?? null)
                          setPw('')
                        }, t('Link created'))
                      }
                    >
                      {t('Create link')}
                    </Button>
                  </div>
                  {created && (
                    <div className="grid gap-1.5">
                      <div className="flex gap-2">
                        <Input readOnly value={created} aria-label={t('Public link')} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
                        <Button variant="outline" onClick={() => void navigator.clipboard?.writeText(created).then(() => toast.success(t('Link copied')))}>
                          <Copy />
                          {t('Copy')}
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">{t('The link is shown only now: the server keeps only a fingerprint of it.')}</p>
                    </div>
                  )}
                  {(links.data ?? []).length > 0 && (
                    <ul className="grid divide-y rounded-lg border" aria-label={t('Public links')}>
                      {(links.data ?? []).map((l) => (
                        <li key={l.id} className="flex flex-wrap items-center gap-2 p-2 pl-3 text-sm">
                          <span className="min-w-0 flex-1">
                            {t('Created on {date}', { date: fmtDate(l.created_at) })}
                            <span className="block text-xs text-muted-foreground">
                              {l.expires_at ? t('Expires on {date}', { date: fmtDate(l.expires_at) }) : t('No expiry')} · {t('{n} views', { n: l.view_count })}
                              {l.has_password ? ` · ${t('with password')}` : ''}
                            </span>
                          </span>
                          {!l.active && <Badge variant="secondary">{t('Expired')}</Badge>}
                          <Button variant="outline" size="sm" onClick={() => void run(() => api('DELETE', `/api/t/${enc(slug)}/links/${l.id}`), t('Link revoked'))}>
                            {t('Revoke')}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </section>

            {canOwn && (
              <section className="grid gap-3">
                <h3 className="text-sm font-semibold">{t('Ownership')}</h3>
                <Input type="search" placeholder={t('Search the new owner…')} aria-label={t('New owner')} value={ownerQ} onChange={(e) => setOwnerQ(e.target.value)} />
                {owners.filter((p) => p.kind === 'user' && p.id !== res!.owner_id).length > 0 && (
                  <ul className="grid divide-y rounded-lg border">
                    {owners
                      .filter((p) => p.kind === 'user' && p.id !== res!.owner_id)
                      .map((p) => (
                        <li key={p.id} className="flex items-center gap-2 p-2 pl-3 text-sm">
                          <span className="flex-1">
                            {p.name} <span className="font-mono text-xs text-muted-foreground">{p.detail}</span>
                          </span>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={busy}
                            onClick={async () => {
                              if (!(await confirm(t('Transfer the ownership to {name}?', { name: p.name }), true))) return
                              await run(() => api('POST', `${base}/owner`, { user_id: p.id }), t('Ownership transferred'))
                              setOwnerQ('')
                            }}
                          >
                            {t('Transfer')}
                          </Button>
                        </li>
                      ))}
                  </ul>
                )}
              </section>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
