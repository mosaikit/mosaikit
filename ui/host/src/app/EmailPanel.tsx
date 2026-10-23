// System › Email, as in the mockup: the mail server of the platform (address, port, security, user and
// password), the sender and the footer of the messages with a preview, and «Send a test». The password is
// encrypted by the kernel and never comes back: the page only knows whether there is one.

import { useState } from 'react'
import { Loader2, Mail } from 'lucide-react'
import { toast } from 'sonner'
import { api, ApiError, errText } from '../api.ts'
import type { Session } from '../types.ts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useAction, useApi } from './core.ts'
import { t } from './i18n.ts'
import { ErrorBox, Loading, SaveBar } from './kit.tsx'

interface EmailSettings {
  host: string
  port: number
  security: 'starttls' | 'tls' | 'none'
  username: string
  sender: string
  footer: string
}

interface EmailView extends EmailSettings {
  has_password: boolean
  configured: boolean
}

type Draft = EmailSettings & { password: string | null }

function draftOf(v: EmailView): Draft {
  return { host: v.host, port: v.port, security: v.security, username: v.username, sender: v.sender, footer: v.footer, password: null }
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  )
}

export function EmailPanel({ session }: { session: Session }) {
  const q = useApi<EmailView>(['email'], '/api/admin/email')
  const [v, setV] = useState<Draft | null>(null)
  const [to, setTo] = useState('')
  const [testing, setTesting] = useState(false)
  // the outcome of the last test, shown next to the button (and in a toast)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const save = useAction((d: Draft) => api('PUT', '/api/admin/email', d.password === null ? { ...d, password: undefined } : d), { ok: t('Mail server saved'), invalidate: [['email']] })
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />
  const view = q.data!
  const saved = draftOf(view)
  const d = v ?? saved
  const dirty = !!v && JSON.stringify(v) !== JSON.stringify(saved)
  const set = (x: Partial<Draft>) => setV({ ...d, ...x })
  async function test() {
    setTesting(true)
    setResult(null)
    try {
      await api('POST', '/api/admin/email/test', { to: to.trim() })
      const text = t('Test message sent to {to}', { to: to.trim() })
      setResult({ ok: true, text })
      toast.success(text)
    } catch (e) {
      // the translated message, with the address of the server; for a refusal of the server its own
      // answer (SMTP replies are in English) helps whoever sets it — never the text of the operating system
      const code = e instanceof ApiError ? e.code : undefined
      const where = `${view.host}:${view.port}`
      const reply = (code === 'email_failed' || code === 'email_auth') && e instanceof ApiError ? e.message.replace(/^mail server( refused the sign-in)?: /, '') : ''
      const text = ['email_refused', 'email_timeout', 'email_unreachable'].includes(code ?? '')
        ? `${errText(e)} (${where})`
        : reply
          ? `${errText(e)}: ${reply}`
          : errText(e)
      setResult({ ok: false, text })
      toast.error(text)
    } finally {
      setTesting(false)
    }
  }
  const hasPassword = d.password === null ? view.has_password : d.password !== ''
  return (
    <div className="grid max-w-3xl gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            {t('Mail server')}
            <Badge variant="secondary" className={view.configured ? 'bg-ok/10 text-ok' : ''}>{view.configured ? t('Ready') : t('Not set')}</Badge>
          </CardTitle>
          <CardDescription>{t('Used for the notifications by email and their daily summary. Without a server nothing is sent.')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field id="em-host" label={t('SMTP server')}>
            <Input id="em-host" className="font-mono" placeholder="smtp.example.org" value={d.host} onChange={(e) => set({ host: e.target.value.trim() })} />
          </Field>
          <Field id="em-port" label={t('Port')}>
            <Input id="em-port" type="number" className="w-32" value={String(d.port)} onChange={(e) => set({ port: Number(e.target.value) || 0 })} />
          </Field>
          <Field id="em-sec" label={t('Security')} hint={d.security === 'none' ? t('Only for a server on the same machine or network.') : undefined}>
            <Select
              value={d.security}
              onValueChange={(x) => set({ security: x as Draft['security'], port: x === 'tls' && d.port === 587 ? 465 : x === 'starttls' && d.port === 465 ? 587 : d.port })}
            >
              <SelectTrigger id="em-sec" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="starttls">STARTTLS</SelectItem>
                <SelectItem value="tls">TLS</SelectItem>
                <SelectItem value="none">{t('None')}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field id="em-user" label={t('User')} hint={t('Empty: the server does not ask for credentials.')}>
            <Input id="em-user" className="font-mono" autoComplete="off" value={d.username} onChange={(e) => set({ username: e.target.value })} />
          </Field>
          <Field id="em-pw" label={t('Password')} hint={t('Encrypted, never sent back to the browser.')}>
            <div className="flex gap-2">
              <Input
                id="em-pw"
                type="password"
                autoComplete="new-password"
                placeholder={hasPassword && d.password === null ? t('Saved: write to replace it') : ''}
                value={d.password ?? ''}
                onChange={(e) => set({ password: e.target.value })}
              />
              {hasPassword && (
                <Button type="button" variant="outline" onClick={() => set({ password: '' })}>
                  {t('Remove')}
                </Button>
              )}
            </div>
          </Field>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('Messages')}</CardTitle>
          <CardDescription>{t('Sender and footer of every message the platform sends.')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="grid content-start gap-4">
            <Field id="em-from" label={t('Sender')} hint={t('An address or «Name <address>»')}>
              <Input id="em-from" className="font-mono" placeholder="Mosaikit <noreply@example.org>" value={d.sender} onChange={(e) => set({ sender: e.target.value })} />
            </Field>
            <Field id="em-foot" label={t('Footer')}>
              <Input id="em-foot" value={d.footer} onChange={(e) => set({ footer: e.target.value })} />
            </Field>
          </div>
          <div className="rounded-lg border bg-muted/40 p-3 text-sm" aria-label={t('Preview')}>
            <p className="text-xs text-muted-foreground">
              {t('From')} <span className="font-mono text-foreground">{d.sender || '—'}</span>
            </p>
            <p className="text-xs text-muted-foreground">
              {t('Subject')} <span className="text-foreground">{t('2 new notifications')}</span>
            </p>
            <div className="mt-2 grid gap-1 border-t pt-2">
              <span>• {t('Elena Ricci shared «Site visit» with you')}</span>
              <span className="mt-2 border-t pt-2 text-xs text-muted-foreground">{d.footer || '—'}</span>
            </div>
          </div>
        </CardContent>
      </Card>
      <SaveBar dirty={dirty} busy={save.isPending} onSave={() => save.mutate(d, { onSuccess: () => setV(null) })} onCancel={() => setV(null)} />
      <Card>
        <CardHeader>
          <CardTitle>{t('Send a test')}</CardTitle>
          <CardDescription>{t('A message sent at once with the saved settings; the answer of the server shows here.')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-2">
          <Field id="em-to" label={t('To')}>
            <Input id="em-to" type="email" className="w-72" placeholder={session.user.username + '@example.org'} value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <Button variant="outline" disabled={!to.trim() || testing || dirty || !view.configured} onClick={() => void test()}>
            {testing ? <Loader2 className="animate-spin" /> : <Mail />}
            {t('Send a test')}
          </Button>
          {result && (
            <p role={result.ok ? 'status' : 'alert'} className={result.ok ? 'basis-full text-sm text-ok' : 'basis-full text-sm text-destructive'}>
              {result.text}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
