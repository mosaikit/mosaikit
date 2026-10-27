// The picture of a person (Account › Profile), or their initials when there is none. `version` changes
// with every new picture; without it the picture is asked anyway and the initials stay if there is none.

import { useEffect, useState } from 'react'
import { appUrl } from '../api.ts'
import { cn } from '@/lib/utils'
import { initials } from './core.ts'

export function PersonPicture({ id, name, version, className }: { id: string; name: string; version?: string | null; className?: string }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [id, version])
  const known = version !== null
  return (
    <span className={cn('flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-teal-700 text-xl font-semibold text-white', className)}>
      {known && !failed ? (
        <img src={appUrl(`/api/people/${encodeURIComponent(id)}/picture${version ? `?v=${encodeURIComponent(version)}` : ''}`)} alt="" className="size-full object-cover" onError={() => setFailed(true)} />
      ) : (
        <span aria-hidden="true">{initials(name)}</span>
      )}
    </span>
  )
}

/** What is known of the logos of the tenants: the slot that answered, or null when there is none. */
const logoSlot = new Map<string, string | null>()
const SLOTS = ['logo_light', 'logo_dark']

/** The logo of a tenant (Tenant settings › Identity and texts), or its initials on the accent colour when it has none. */
export function TenantLogo({ slug, name, className }: { slug: string; name: string; className?: string }) {
  const [slot, setSlot] = useState<string | null | undefined>(() => logoSlot.get(slug))
  const [tried, setTried] = useState(0)
  useEffect(() => {
    setSlot(logoSlot.get(slug))
    setTried(0)
  }, [slug])
  const current = slot === undefined ? SLOTS[tried] : slot
  return (
    <span className={cn('flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md bg-primary text-xs font-bold text-primary-foreground', className)}>
      {current ? (
        <img
          src={appUrl(`/api/auth/tenants/${encodeURIComponent(slug)}/logo/${current}`)}
          alt=""
          className="size-full bg-white object-contain"
          onLoad={() => logoSlot.set(slug, current)}
          onError={() => {
            if (tried + 1 < SLOTS.length) setTried(tried + 1)
            else {
              logoSlot.set(slug, null)
              setSlot(null)
            }
          }}
        />
      ) : (
        <span aria-hidden="true">{initials(name)}</span>
      )}
    </span>
  )
}
