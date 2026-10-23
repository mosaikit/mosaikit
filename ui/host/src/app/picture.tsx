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
