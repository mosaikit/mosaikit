// Contact person and registration data of a tenant (Administrator), as in the mockup (tenant/details): a
// card with the save bar that appears only after a change.

import { useState } from 'react'
import { api } from '../api.ts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
    <Card className="max-w-2xl">
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
