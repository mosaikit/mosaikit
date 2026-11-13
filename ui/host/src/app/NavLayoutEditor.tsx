// Settings › Navigation: the groups of the sidebar, with one level of subgroups. The editor changes a list of
// groups (`NavGroupDef`); the page saves it as the setting `nav.layout`. Order is changed with the arrows, which
// also work with the keyboard. An app is in one place only: adding it to a group takes it out of the previous one.

import { ArrowDown, ArrowUp, FolderPlus, GripVertical, Plus, Trash2 } from 'lucide-react'
import { useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import AppIcon, { ICON_NAMES } from './AppIcon.tsx'
import { t } from './i18n.ts'
import { groupIds, move, newGroupId, placeApp, placed, reorder, unplace, type NavGroupDef } from './navgroups.ts'

export interface EditorApp {
  id: string
  label: string
  icon_name?: string | null
}

type Lang = { id: string; name: string }

/** What is being dragged: an app, or a group (`i`), or a subgroup (`i`, `j`). */
type Drag = { kind: 'app'; plugin: string } | { kind: 'group'; i: number } | { kind: 'sub'; i: number; j: number }

const startDrag = (e: React.DragEvent, set: () => void) => {
  e.dataTransfer.effectAllowed = 'move'
  e.dataTransfer.setData('text/plain', 'msk-nav')
  set()
}
const over = (e: React.DragEvent) => {
  e.preventDefault()
  e.dataTransfer.dropEffect = 'move'
}

const none = '__none__'

function patch(list: NavGroupDef[], i: number, change: Partial<NavGroupDef>): NavGroupDef[] {
  return list.map((g, k) => (k === i ? { ...g, ...change } : g))
}

function LabelFields({ g, langs, onChange }: { g: NavGroupDef; langs: Lang[]; onChange: (c: Partial<NavGroupDef>) => void }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <Input aria-label={t('Name of the group')} placeholder={t('Name')} value={g.label} onChange={(e) => onChange({ label: e.target.value })} />
      {langs
        .filter((l) => l.id !== 'en')
        .map((l) => (
          <Input
            key={l.id}
            aria-label={t('Name in {language}', { language: l.name })}
            placeholder={l.name}
            value={g.i18n?.[l.id]?.label ?? ''}
            onChange={(e) => onChange({ i18n: { ...(g.i18n ?? {}), [l.id]: { label: e.target.value } } })}
          />
        ))}
    </div>
  )
}

function IconSelect({ g, onChange }: { g: NavGroupDef; onChange: (c: Partial<NavGroupDef>) => void }) {
  return (
    <Select value={g.icon || none} onValueChange={(v) => onChange({ icon: v === none ? null : v })}>
      <SelectTrigger size="sm" className="w-44" aria-label={t('Icon of the group')}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        <SelectItem value={none}>{t('Default icon')}</SelectItem>
        {ICON_NAMES.map((n) => (
          <SelectItem key={n} value={n}>
            <span className="flex items-center gap-2">
              <AppIcon id="" name={n} className="size-4" />
              {n}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** The apps of one group: order, remove and add (from the apps not placed anywhere, or taken from another group). */
function AppsOf({ g, apps, all, onChange, onDragApp, onDropApp }: { g: NavGroupDef; apps: EditorApp[]; all: NavGroupDef[]; onChange: (plugins: string[], moved?: string) => void; onDragApp: (plugin: string) => void; onDropApp: (before?: string) => void }) {
  const byId = new Map(apps.map((a) => [a.id, a]))
  const here = (g.plugins ?? []).filter((p) => byId.has(p))
  const inGroups = placed(all)
  const addable = apps.filter((a) => !(g.plugins ?? []).includes(a.id))
  return (
    <div className="grid gap-1" onDragOver={over} onDrop={(e) => (e.preventDefault(), onDropApp())}>
      {here.map((p, i) => (
        <div
          key={p}
          draggable
          onDragStart={(e) => startDrag(e, () => onDragApp(p))}
          onDragOver={over}
          onDrop={(e) => (e.preventDefault(), e.stopPropagation(), onDropApp(p))}
          className="flex cursor-grab items-center gap-2 rounded-md border bg-background px-2 py-1 text-sm active:cursor-grabbing"
        >
          <GripVertical className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <AppIcon id={p} name={byId.get(p)?.icon_name} className="size-4 text-primary" />
          <span className="min-w-0 flex-1 truncate">{byId.get(p)!.label}</span>
          <Button variant="ghost" size="icon" className="size-7" aria-label={t('Move {name} up', { name: byId.get(p)!.label })} disabled={i === 0} onClick={() => onChange(move(here, i, -1))}>
            <ArrowUp />
          </Button>
          <Button variant="ghost" size="icon" className="size-7" aria-label={t('Move {name} down', { name: byId.get(p)!.label })} disabled={i === here.length - 1} onClick={() => onChange(move(here, i, 1))}>
            <ArrowDown />
          </Button>
          <Button variant="ghost" size="icon" className="size-7" aria-label={t('Take {name} out of the group', { name: byId.get(p)!.label })} onClick={() => onChange(here.filter((x) => x !== p))}>
            <Trash2 />
          </Button>
        </div>
      ))}
      {addable.length > 0 && (
        <Select value="" onValueChange={(v) => onChange([...here, v], v)}>
          <SelectTrigger size="sm" className="w-56" aria-label={t('Add an app to the group')}>
            <SelectValue placeholder={t('Add an app…')} />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            {addable.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.label}
                {inGroups.has(a.id) ? ` · ${t('now in another group')}` : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  )
}

export default function NavLayoutEditor({ value, apps, langs, onChange, canLock }: { value: NavGroupDef[]; apps: EditorApp[]; langs: Lang[]; onChange: (v: NavGroupDef[]) => void; canLock?: boolean }) {
  const ids = groupIds(value)
  const drag = useRef<Drag | null>(null)
  const setApps = (path: { i: number; j?: number }, plugins: string[], moved?: string) => {
    // an app taken from another group first leaves it
    const base = moved ? unplace(value, moved) : value
    onChange(
      base.map((g, i) => {
        if (i !== path.i) return g
        if (path.j === undefined) return { ...g, plugins }
        return { ...g, children: (g.children ?? []).map((c, j) => (j === path.j ? { ...c, plugins } : c)) }
      }),
    )
  }
  // a drop: an app goes before another app or at the end of a group; a group or a subgroup takes the place of another
  const dropApp = (to: { i: number; j?: number }) => (before?: string) => {
    const d = drag.current
    drag.current = null
    if (d?.kind === 'app' && d.plugin !== before) onChange(placeApp(value, d.plugin, to, before))
  }
  const dropGroup = (to: number) => {
    const d = drag.current
    drag.current = null
    if (d?.kind === 'group') onChange(reorder(value, d.i, to))
  }
  const dropSub = (i: number, to: number) => {
    const d = drag.current
    drag.current = null
    if (d?.kind === 'sub' && d.i === i) onChange(patch(value, i, { children: reorder(value[i].children ?? [], d.j, to) }))
  }
  const addGroup = () => onChange([...value, { id: newGroupId(t('New group'), ids), label: t('New group'), plugins: [] }])
  const addSub = (i: number) => {
    const name = t('New subgroup')
    onChange(patch(value, i, { children: [...(value[i].children ?? []), { id: newGroupId(name, ids), label: name, plugins: [] }] }))
  }
  const unassigned = apps.filter((a) => !placed(value).has(a.id))
  return (
    <div className="grid gap-4" data-testid="nav-editor">
      {value.length === 0 && <p className="text-sm text-muted-foreground">{t('No groups: the apps show in one list. Add a group to start.')}</p>}
      {value.map((g, i) => (
        <section
          key={g.id}
          className="grid gap-3 rounded-xl border bg-card p-4"
          aria-label={g.label || g.id}
          onDragOver={over}
          onDrop={(e) => {
            e.preventDefault()
            if (drag.current?.kind === 'group') dropGroup(i)
          }}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span
              draggable
              role="img"
              aria-label={t('Drag the group')}
              onDragStart={(e) => startDrag(e, () => (drag.current = { kind: 'group', i }))}
              className="flex cursor-grab items-center text-muted-foreground active:cursor-grabbing"
            >
              <GripVertical className="size-5" />
            </span>
            <IconSelect g={g} onChange={(c) => onChange(patch(value, i, c))} />
            <div className="min-w-48 flex-1">
              <LabelFields g={g} langs={langs} onChange={(c) => onChange(patch(value, i, c))} />
            </div>
            <Button variant="outline" size="icon" aria-label={t('Move the group up')} disabled={i === 0} onClick={() => onChange(move(value, i, -1))}>
              <ArrowUp />
            </Button>
            <Button variant="outline" size="icon" aria-label={t('Move the group down')} disabled={i === value.length - 1} onClick={() => onChange(move(value, i, 1))}>
              <ArrowDown />
            </Button>
            <Button variant="outline" size="icon" aria-label={t('Delete the group')} onClick={() => onChange(value.filter((_, k) => k !== i))}>
              <Trash2 />
            </Button>
          </div>
          {canLock && (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={!!g.locked} onCheckedChange={(v) => onChange(patch(value, i, { locked: !!v }))} aria-label={t('Keep this group in every tenant')} />
              {t('Keep this group in every tenant')}
              <span className="text-xs text-muted-foreground">{t('A tenant that sets its own groups still has it, first')}</span>
            </label>
          )}
          <AppsOf g={g} apps={apps} all={value} onChange={(p, moved) => setApps({ i }, p, moved)} onDragApp={(plugin) => (drag.current = { kind: 'app', plugin })} onDropApp={dropApp({ i })} />
          {(g.children ?? []).map((c, j) => (
            <div
              key={c.id}
              className="ml-5 grid gap-3 border-l-2 pl-4"
              role="group"
              aria-label={c.label || c.id}
              onDragOver={over}
              onDrop={(e) => {
                if (drag.current?.kind === 'sub') (e.preventDefault(), e.stopPropagation(), dropSub(i, j))
              }}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  draggable
                  role="img"
                  aria-label={t('Drag the subgroup')}
                  onDragStart={(e) => (e.stopPropagation(), startDrag(e, () => (drag.current = { kind: 'sub', i, j })))}
                  className="flex cursor-grab items-center text-muted-foreground active:cursor-grabbing"
                >
                  <GripVertical className="size-5" />
                </span>
                <IconSelect g={c} onChange={(ch) => onChange(patch(value, i, { children: (g.children ?? []).map((x, k) => (k === j ? { ...x, ...ch } : x)) }))} />
                <div className="min-w-48 flex-1">
                  <LabelFields g={c} langs={langs} onChange={(ch) => onChange(patch(value, i, { children: (g.children ?? []).map((x, k) => (k === j ? { ...x, ...ch } : x)) }))} />
                </div>
                <Button variant="outline" size="icon" aria-label={t('Move the subgroup up')} disabled={j === 0} onClick={() => onChange(patch(value, i, { children: move(g.children ?? [], j, -1) }))}>
                  <ArrowUp />
                </Button>
                <Button variant="outline" size="icon" aria-label={t('Move the subgroup down')} disabled={j === (g.children ?? []).length - 1} onClick={() => onChange(patch(value, i, { children: move(g.children ?? [], j, 1) }))}>
                  <ArrowDown />
                </Button>
                <Button variant="outline" size="icon" aria-label={t('Delete the subgroup')} onClick={() => onChange(patch(value, i, { children: (g.children ?? []).filter((_, k) => k !== j) }))}>
                  <Trash2 />
                </Button>
              </div>
              <AppsOf g={c} apps={apps} all={value} onChange={(p, moved) => setApps({ i, j }, p, moved)} onDragApp={(plugin) => (drag.current = { kind: 'app', plugin })} onDropApp={dropApp({ i, j })} />
            </div>
          ))}
          <div>
            <Button variant="outline" size="sm" onClick={() => addSub(i)}>
              <FolderPlus />
              {t('Add a subgroup')}
            </Button>
          </div>
        </section>
      ))}
      <div>
        <Button variant="outline" onClick={addGroup}>
          <Plus />
          {t('Add a group')}
        </Button>
      </div>
      {value.length > 0 && unassigned.length > 0 && (
        <div className="grid gap-1">
          <p className="text-sm font-medium">{t('Not in a group')}</p>
          <p className="text-xs text-muted-foreground">{t('They show below the groups, in one list.')}</p>
          <div className="flex flex-wrap gap-2">
            {unassigned.map((a) => (
              <span key={a.id} className="flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs">
                <AppIcon id={a.id} name={a.icon_name} className="size-3.5 text-primary" />
                {a.label}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
