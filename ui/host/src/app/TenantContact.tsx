// Contact person and registration data of a tenant (Administrator), as in the mockup (tenant/details): a
// card with the save bar that appears only after a change.

import { useState } from 'react'
import { api } from '../api.ts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAction, useApi } from './core.ts'
import { t } from './i18n.ts'
import { ErrorBox, Loading, SaveBar } from './kit.tsx'

interface Details {
  contact_name: string
  contact_email: string
  contact_phone: string
  registration: string
}

const FIELDS: [keyof Details, string, string][] = [
  ['contact_name', 'Contact person', 'text'],
  ['contact_email', 'Email of the contact', 'email'],
  ['contact_phone', 'Phone of the contact', 'tel'],
  ['registration', 'Registration data (VAT number, tax code)', 'text'],
]

export function TenantContact({ id }: { id: string }) {
  const path = `/api/admin/tenants/${encodeURIComponent(id)}/details`
  const q = useApi<Details>(['tenant-details', id], path)
  const [v, setV] = useState<Details | null>(null)
  const save = useAction((d: Details) => api('PUT', path, d), { ok: t('Details saved'), invalidate: [['tenant-details', id]] })
  if (q.isLoading) return <Loading />
  if (q.error || !q.data) return <ErrorBox error={q.error} />
  const d = v ?? q.data
  const dirty = !!v && JSON.stringify(v) !== JSON.stringify(q.data)
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Contact and registration')}</CardTitle>
        <CardDescription>{t('Who to call about the tenant, and its registration data.')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">
        {FIELDS.map(([k, label, type]) => (
          <div key={k} className="grid gap-1.5">
            <Label htmlFor={`td-${k}`}>{t(label)}</Label>
            <Input id={`td-${k}`} type={type} value={d[k]} onChange={(e) => setV({ ...d, [k]: e.target.value })} />
          </div>
        ))}
      </CardContent>
      <SaveBar dirty={dirty} busy={save.isPending} onSave={() => save.mutate(d, { onSuccess: () => setV(null) })} onCancel={() => setV(null)} />
    </Card>
  )
}

/** Name and identifier of a tenant: editable by the Administrator (the identifier is what people type to sign in). */
export function TenantIdentity({ id, name, slug }: { id: string; name: string; slug: string }) {
  const [v, setV] = useState<{ name: string; slug: string } | null>(null)
  const save = useAction((d: { name: string; slug: string }) => api('PUT', `/api/admin/tenants/${encodeURIComponent(id)}/identity`, d), {
    ok: t('Name and identifier saved'),
    invalidate: [['admin-tenants'], ['admin-overview']],
  })
  const d = v ?? { name, slug }
  const dirty = !!v && (v.name !== name || v.slug !== slug)
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="grid gap-1.5">
        <Label htmlFor="tn-name">{t('Name')}</Label>
        <Input id="tn-name" value={d.name} onChange={(e) => setV({ ...d, name: e.target.value })} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="tn-slug">{t('Identifier')}</Label>
        <Input id="tn-slug" className="font-mono" value={d.slug} onChange={(e) => setV({ ...d, slug: e.target.value.toLowerCase() })} />
      </div>
      <p className="text-xs text-muted-foreground sm:col-span-2">{t('The identifier is what people choose at sign-in and what appears in addresses: lower case letters, digits and «-». Changing it changes those addresses.')}</p>
      {dirty && (
        <div className="flex gap-2 sm:col-span-2">
          <Button type="button" size="sm" disabled={save.isPending} onClick={() => save.mutate(d, { onSuccess: () => setV(null) })}>
            {t('Save')}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setV(null)}>
            {t('Cancel')}
          </Button>
        </div>
      )}
    </div>
  )
}
