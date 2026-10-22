// How the people of a tenant sign in (Administrator › Tenants › a tenant › Sign-in), as in the mockup
// (tenant/sign-in): local accounts or the identity provider of the tenant (OIDC), never both; the
// addresses to register in the provider, "Check the configuration", where the roles come from, the
// mirror of the groups of the provider, the claims, and how many accounts the choice touches
// (docs/architecture.md, OIDC).

import { useState } from 'react'
import { AlertTriangle, CheckCircle2, Copy, Loader2, ShieldCheck, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { api, errText } from '../api.ts'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { useAction, useApi, useConfirm } from './core.ts'
import { t } from './i18n.ts'
import { ErrorBox, Loading, SaveBar } from './kit.tsx'

/** The configuration as the server shows it (never the client secret). */
export interface OidcView {
  enabled: boolean
  issuer: string
  client_id: string
  has_secret: boolean
  secret_hint: string
  scopes: string
  button_text: string
  roles_source: 'mosaikit' | 'idp'
  manager_groups: string[]
  user_groups: string[]
  claim_username: string
  claim_name: string
  claim_email: string
  claim_groups: string
  /** mirror the groups of the token as read-only groups of the tenant */
  sync_groups: boolean
  /** only the groups starting with this ('' = all) */
  group_prefix: string
  redirect_uri: string
  backchannel_logout_uri: string
  frontchannel_logout_uri: string
  post_logout_redirect_uri: string
  local_accounts: number
  provider_accounts: number
  guests: number
}

interface Draft extends Omit<OidcView, 'manager_groups' | 'user_groups'> {
  manager_groups: string
  user_groups: string
  /** new secret: '' keeps the stored one */
  secret: string
  /** remove the stored secret */
  remove_secret: boolean
}

interface CheckStep {
  step: string
  level: 'ok' | 'warning' | 'error'
  detail: string
}

const STEP_LABEL: Record<string, string> = {
  issuer: 'Issuer',
  discovery: 'Discovery document',
  pkce: 'PKCE (S256)',
  keys: 'Signing keys',
  end_session: 'Sign-out at the provider',
  backchannel_logout: 'Back-channel logout',
  frontchannel_logout: 'Front-channel logout',
}

function draftOf(v: OidcView): Draft {
  return { ...v, manager_groups: v.manager_groups.join(', '), user_groups: v.user_groups.join(', '), secret: '', remove_secret: false }
}

const list = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

function Choice({ name, value, current, title, text, onPick }: { name: string; value: string; current: string; title: string; text: string; onPick: (v: string) => void }) {
  const on = value === current
  return (
    <label className={cn('flex cursor-pointer gap-3 rounded-lg border p-3 text-sm', on && 'border-primary ring-1 ring-primary')}>
      <input type="radio" name={name} value={value} checked={on} onChange={() => onPick(value)} className="mt-0.5 accent-primary" />
      <span>
        <b className="block">{title}</b>
        <span className="text-muted-foreground">{text}</span>
      </span>
    </label>
  )
}

function Address({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 font-mono text-xs" title={value}>
          {value}
        </code>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('Copy {what}', { what: label })}
          onClick={() => void navigator.clipboard?.writeText(value).then(() => toast.success(t('Copied')))}
        >
          <Copy />
        </Button>
      </div>
    </div>
  )
}

export function SignInSettings({ id }: { id: string }) {
  const path = `/api/admin/tenants/${id}/sign-in`
  const q = useApi<OidcView>(['admin-sign-in', id], path)
  const [d, setD] = useState<Draft | null>(null)
  const [steps, setSteps] = useState<CheckStep[] | null>(null)
  const [checking, setChecking] = useState(false)
  const confirm = useConfirm()
  const save = useAction(
    (x: Draft) =>
      api('PUT', path, {
        enabled: x.enabled,
        issuer: x.issuer,
        client_id: x.client_id,
        client_secret: x.remove_secret ? '' : x.secret || undefined,
        scopes: x.scopes,
        button_text: x.button_text,
        roles_source: x.roles_source,
        manager_groups: list(x.manager_groups),
        user_groups: list(x.user_groups),
        claim_username: x.claim_username,
        claim_name: x.claim_name,
        claim_email: x.claim_email,
        claim_groups: x.claim_groups,
        sync_groups: x.sync_groups,
        group_prefix: x.group_prefix,
      }),
    { ok: t('Sign-in saved'), invalidate: [['admin-sign-in', id], ['admin-tenants']] },
  )
  if (q.isLoading) return <Loading />
  if (q.error || !q.data) return <ErrorBox error={q.error} />
  const v = q.data
  const cur = d ?? draftOf(v)
  const dirty = !!d && JSON.stringify(d) !== JSON.stringify(draftOf(v))
  const set = (patch: Partial<Draft>) => setD({ ...cur, ...patch })

  async function onSave() {
    if (cur.enabled && !v.enabled && v.local_accounts > 0) {
      const ok = await confirm(
        t('With the identity provider the {n} local accounts of the tenant can no longer sign in. Continue?', { n: v.local_accounts }),
        true,
      )
      if (!ok) return
    }
    save.mutate(cur, { onSuccess: () => setD(null) })
  }

  async function check() {
    setChecking(true)
    setSteps(null)
    try {
      setSteps(await api<CheckStep[]>('POST', '/api/admin/oidc/check', { issuer: cur.issuer }))
    } catch (e) {
      toast.error(errText(e))
    } finally {
      setChecking(false)
    }
  }

  const oidc = cur.enabled
  return (
    <div className="grid max-w-3xl gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('How people sign in')}</CardTitle>
          <CardDescription>{t('One method per tenant, never both. Administrators always sign in with their local password.')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <Choice
            name="method"
            value="local"
            current={oidc ? 'oidc' : 'local'}
            title={t('Local accounts')}
            text={t('Username and password kept by Mosaikit; the Tenant Manager creates the people.')}
            onPick={() => set({ enabled: false })}
          />
          <Choice
            name="method"
            value="oidc"
            current={oidc ? 'oidc' : 'local'}
            title={t('Identity provider (OIDC)')}
            text={t('The password is asked by the provider of the tenant; people are created at their first sign-in.')}
            onPick={() => set({ enabled: true })}
          />
        </CardContent>
      </Card>

      {oidc && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{t('Identity provider')}</CardTitle>
              <CardDescription>{t('Register Mosaikit in the provider as a confidential client with the addresses below.')}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <Field id="oi-issuer" label={t('Address of the provider (issuer)')} hint={t('The rest (endpoints, keys) is read from its discovery document.')}>
                <Input id="oi-issuer" className="font-mono" value={cur.issuer} placeholder="https://login.example.org/realms/staff" onChange={(e) => set({ issuer: e.target.value })} />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="oi-client" label={t('Client id')}>
                  <Input id="oi-client" className="font-mono" value={cur.client_id} onChange={(e) => set({ client_id: e.target.value })} />
                </Field>
                <Field
                  id="oi-secret"
                  label={t('Client secret')}
                  hint={cur.remove_secret ? t('It will be removed when you save.') : v.has_secret ? t('Stored, ends with {hint}. Encrypted, never sent to the browser.', { hint: v.secret_hint }) : t('Encrypted, never sent to the browser.')}
                >
                  <div className="flex gap-2">
                    <Input
                      id="oi-secret"
                      type="password"
                      autoComplete="off"
                      value={cur.secret}
                      placeholder={v.has_secret && !cur.remove_secret ? '••••' + v.secret_hint : ''}
                      onChange={(e) => set({ secret: e.target.value, remove_secret: false })}
                    />
                    {v.has_secret && !cur.remove_secret && (
                      <Button variant="outline" onClick={() => set({ secret: '', remove_secret: true })}>
                        {t('Remove')}
                      </Button>
                    )}
                  </div>
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="oi-scopes" label={t('Scopes')}>
                  <Input id="oi-scopes" className="font-mono" value={cur.scopes} onChange={(e) => set({ scopes: e.target.value })} />
                </Field>
                <Field id="oi-button" label={t('Text of the button')} hint={t('On the sign-in page: «Sign in with …»')}>
                  <Input id="oi-button" value={cur.button_text} placeholder={t('your identity provider')} onChange={(e) => set({ button_text: e.target.value })} />
                </Field>
              </div>
              <div className="grid gap-3 rounded-lg border p-3">
                <Address label={t('Return address (redirect URI)')} value={v.redirect_uri} />
                <Address label={t('Back-channel logout address')} value={v.backchannel_logout_uri} />
                <Address label={t('Front-channel logout address')} value={v.frontchannel_logout_uri} />
                <Address label={t('Address after the sign-out')} value={v.post_logout_redirect_uri} />
              </div>
              <div className="grid gap-3">
                <Button variant="outline" className="justify-self-start" disabled={checking || !cur.issuer.trim()} onClick={() => void check()}>
                  {checking ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
                  {t('Check the configuration')}
                </Button>
                {steps && (
                  <ul className="grid gap-2 text-sm" aria-label={t('Result of the check')}>
                    {steps.map((s) => (
                      <li key={s.step} className="flex gap-2">
                        {s.level === 'ok' ? (
                          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" aria-label={t('OK')} />
                        ) : s.level === 'warning' ? (
                          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" aria-label={t('Warning')} />
                        ) : (
                          <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-label={t('Error')} />
                        )}
                        <span className="min-w-0">
                          <b>{t(STEP_LABEL[s.step] ?? s.step)}</b> <span className="break-all text-muted-foreground">{s.detail}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('Where roles come from')}</CardTitle>
              <CardDescription>{t('One source only, so that a role is never decided in two places.')}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Choice
                  name="roles"
                  value="mosaikit"
                  current={cur.roles_source}
                  title={t('Managed in Mosaikit')}
                  text={t('The provider only says who the person is; the Tenant Manager gives roles.')}
                  onPick={() => set({ roles_source: 'mosaikit' })}
                />
                <Choice
                  name="roles"
                  value="idp"
                  current={cur.roles_source}
                  title={t('Groups of the identity provider')}
                  text={t('The role is read from the groups of the token at every sign-in.')}
                  onPick={() => set({ roles_source: 'idp' })}
                />
              </div>
              {cur.roles_source === 'idp' && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field id="oi-mg" label={t('Groups of the Tenant Managers')} hint={t('Separated by commas.')}>
                    <Input id="oi-mg" value={cur.manager_groups} onChange={(e) => set({ manager_groups: e.target.value })} />
                  </Field>
                  <Field id="oi-ug" label={t('Groups of the Users')} hint={t('Empty: everybody the provider lets in is a User.')}>
                    <Input id="oi-ug" value={cur.user_groups} onChange={(e) => set({ user_groups: e.target.value })} />
                  </Field>
                </div>
              )}
              <div className="grid gap-3 rounded-lg border p-3">
                <div className="flex items-start justify-between gap-4">
                  <Label htmlFor="oi-sync" className="grid gap-1">
                    <b>{t('Groups of the provider in Mosaikit')}</b>
                    <span className="text-xs font-normal text-muted-foreground">
                      {t('The groups of the token become groups of the tenant at every sign-in, to share items with. Only the provider changes them; a group it no longer sends empties, it is never deleted.')}
                    </span>
                  </Label>
                  <Switch id="oi-sync" checked={cur.sync_groups} onCheckedChange={(on) => set({ sync_groups: on })} />
                </div>
                {cur.sync_groups && (
                  <Field id="oi-prefix" label={t('Only the groups starting with')} hint={t('Empty: every group of the token.')}>
                    <Input id="oi-prefix" className="font-mono" value={cur.group_prefix} onChange={(e) => set({ group_prefix: e.target.value })} />
                  </Field>
                )}
              </div>
              <details className="rounded-lg border p-3 text-sm">
                <summary className="cursor-pointer font-medium">{t('Claims of the token')}</summary>
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <Field id="oi-cu" label={t('Username')}>
                    <Input id="oi-cu" className="font-mono" value={cur.claim_username} onChange={(e) => set({ claim_username: e.target.value })} />
                  </Field>
                  <Field id="oi-cn" label={t('Full name')}>
                    <Input id="oi-cn" className="font-mono" value={cur.claim_name} onChange={(e) => set({ claim_name: e.target.value })} />
                  </Field>
                  <Field id="oi-ce" label={t('Email')}>
                    <Input id="oi-ce" className="font-mono" value={cur.claim_email} onChange={(e) => set({ claim_email: e.target.value })} />
                  </Field>
                  <Field id="oi-cg" label={t('Groups')}>
                    <Input id="oi-cg" className="font-mono" value={cur.claim_groups} onChange={(e) => set({ claim_groups: e.target.value })} />
                  </Field>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">{t('A person is recognized by the issuer and the subject (sub) of the token, never by the email.')}</p>
              </details>
            </CardContent>
          </Card>
        </>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t('Accounts')}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-muted-foreground">{t('Local accounts')}</dt>
            <dd>
              {v.local_accounts}
              {oidc && v.local_accounts > 0 && <span className="ml-2 text-xs text-warn">{t('cannot sign in while the provider is on')}</span>}
            </dd>
            <dt className="text-muted-foreground">{t('Accounts of the provider')}</dt>
            <dd>{v.provider_accounts}</dd>
            <dt className="text-muted-foreground">{t('Guests')}</dt>
            <dd>
              {v.guests} <span className="text-xs text-muted-foreground">{t('they sign in with their own tenant, as before')}</span>
            </dd>
          </dl>
        </CardContent>
      </Card>
      <SaveBar dirty={dirty} busy={save.isPending} onSave={() => void onSave()} onCancel={() => setD(null)} />
    </div>
  )
}
