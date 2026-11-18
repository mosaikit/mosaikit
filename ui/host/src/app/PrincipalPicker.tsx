// Picker of people and groups of the tenant for a page of a plugin (`msk.pickPrincipals`): the page that replaces
// the share dialog needs to add people without the dialog of the shell. It searches the directory of the tenant
// with the rights of the person, and hands back what they chose.

import { useEffect, useState } from 'react'
import { UserRound, Users, X } from 'lucide-react'
import type { Principal } from '../types.ts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { t } from './i18n.ts'
import { shown, useDirectory } from './directory.ts'
import type { PickOptions, PickedPrincipal } from '../ui-context.ts'

const keyOf = (p: { kind: string; id: string }) => `${p.kind}:${p.id}`

export default function PrincipalPicker({ slug, request, onDone }: { slug: string; request: PickOptions | null; onDone: (picked: PickedPrincipal[]) => void }) {
  const [q, setQ] = useState('')
  const [chosen, setChosen] = useState<Principal[]>([])
  const found = useDirectory(slug, q)
  useEffect(() => {
    setQ('')
    setChosen([])
  }, [request])
  const kind = request?.kind ?? 'both'
  const exclude = new Set((request?.exclude ?? []).map((p) => `${p.type === 'all' ? 'group' : p.type}:${p.id}`))
  const single = request?.multiple === false
  const list = found.filter((p) => (kind === 'both' || p.kind === kind) && !exclude.has(keyOf(p)) && !chosen.some((c) => keyOf(c) === keyOf(p)))
  const toggle = (p: Principal) => (single ? setChosen([p]) : setChosen((c) => [...c, p]))
  const done = (picked: Principal[]) =>
    onDone(picked.map((p) => (p.builtin === 'all' ? { type: 'all' as const, id: 'all', name: shown(p).name } : { type: p.kind, id: p.id, name: shown(p).name })))
  return (
    <Dialog open={!!request} onOpenChange={(o) => !o && done([])}>
      <DialogContent className="sm:max-w-md" data-testid="principal-picker">
        <DialogHeader>
          <DialogTitle>{request?.title || (kind === 'user' ? t('Choose people') : kind === 'group' ? t('Choose groups') : t('Choose people and groups'))}</DialogTitle>
          <DialogDescription>{t('Search the people and groups of the organization.')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Input type="search" autoFocus placeholder={t('Search people or groups…')} aria-label={t('Search people or groups')} value={q} onChange={(e) => setQ(e.target.value)} />
          {chosen.length > 0 && (
            <ul className="flex flex-wrap gap-1.5" aria-label={t('Chosen')}>
              {chosen.map((p) => (
                <li key={keyOf(p)}>
                  <Badge variant="secondary" className="gap-1">
                    {shown(p).name}
                    <button type="button" aria-label={t('Remove')} onClick={() => setChosen((c) => c.filter((x) => keyOf(x) !== keyOf(p)))}>
                      <X className="size-3" />
                    </button>
                  </Badge>
                </li>
              ))}
            </ul>
          )}
          {list.length > 0 && (
            <ul role="listbox" aria-label={t('Results')} className="max-h-56 overflow-auto rounded-md border p-1">
              {list.map((p) => (
                <li key={keyOf(p)}>
                  <button type="button" role="option" aria-selected={false} className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent" onClick={() => toggle(p)}>
                    {p.kind === 'group' ? <Users className="size-4 text-muted-foreground" /> : <UserRound className="size-4 text-muted-foreground" />}
                    <span className="grid">
                      <span>{shown(p).name}</span>
                      <span className="text-xs text-muted-foreground">{shown(p).detail}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => done([])}>
              {t('Cancel')}
            </Button>
            <Button disabled={chosen.length === 0} onClick={() => done(chosen)} data-testid="principal-picker-add">
              {chosen.length > 1 ? t('Add {n}', { n: chosen.length }) : t('Add')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
