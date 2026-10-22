// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { Msk } from './client.ts'
import { mountCrud } from './crud-view.ts'
import type { Bridge } from './bridge.ts'
import type { UiContext } from './protocol.ts'

const fields = [
  { key: 'title', label: 'Title', kind: 'text', required: true },
  { key: 'done', label: 'Done', kind: 'bool' },
  { key: 'secret', label: 'Computed', kind: 'number', hidden: true },
]

function row(id: string, title: string, level: string, owner = 'anna') {
  return { id, values: { title, done: false, secret: 1 }, owner_id: 'u', owner_name: owner, my_level: level, shared: level !== 'manage', parent_id: null, created_at: '', updated_at: '' }
}

function fakeMsk(rows: any[], context?: UiContext) {
  const calls: { op: string; args: any }[] = []
  const listeners: ((event: string, data: unknown) => void)[] = []
  const bridge = {
    call: async (op: string, args: any) => {
      calls.push({ op, args })
      if (op === 'crud.list') return { resource: 'notes', fields, rows }
      if (op === 'crud.create') return row('new', args.values.title, 'manage')
      if (op === 'confirm') return true
      return {}
    },
    onEvent: (fn: (event: string, data: unknown) => void) => {
      listeners.push(fn)
      return () => {}
    },
  } as unknown as Bridge
  const emit = (event: string, data: unknown) => listeners.forEach((l) => l(event, data))
  return { msk: new Msk(bridge, { public: false, context }), calls, emit }
}

const tick = () => new Promise((r) => setTimeout(r, 0))
const it_ctx: UiContext = { lang: 'it', preset: 'mosaikit', mode: 'light', preference: 'light', theme: {} }

describe('mountCrud', () => {
  it('shows rows and levels and hides the computed fields', async () => {
    const el = document.createElement('div')
    const { msk } = fakeMsk([row('1', 'mine', 'manage'), row('2', 'bruno\'s', 'read', 'bruno')])
    mountCrud(el, msk, 'notes', { title: 'Notes' })
    await tick()
    expect(el.querySelectorAll('tbody tr.row').length).toBe(2)
    expect(el.textContent).toContain('read only')
    expect(el.querySelector('th')!.textContent).toBe('Title')
    expect(el.textContent).not.toContain('Computed')
    // read-only row: disabled fields, no save/share/delete
    ;(el.querySelectorAll('tbody tr.row')[1] as HTMLElement).click()
    const input = el.querySelector<HTMLInputElement>('[data-key="title"]')!
    expect(input.disabled).toBe(true)
    const buttons = [...el.querySelectorAll<HTMLButtonElement>('.msk-actions button')]
    expect(buttons.filter((b) => !b.hidden).map((b) => b.textContent)).toEqual(['Close'])
  })

  it('creates an item with typed values', async () => {
    const el = document.createElement('div')
    const { msk, calls } = fakeMsk([])
    mountCrud(el, msk, 'notes')
    await tick()
    el.querySelector<HTMLInputElement>('[data-key="title"]')!.value = 'new note'
    el.querySelector<HTMLInputElement>('[data-key="done"]')!.checked = true
    ;[...el.querySelectorAll<HTMLButtonElement>('.msk-actions button')].find((b) => b.textContent === 'Save')!.click()
    await tick()
    const create = calls.find((c) => c.op === 'crud.create')!
    expect(create.args).toEqual({ resource: 'notes', values: { title: 'new note', done: true }, parent: undefined })
  })

  it('the text of the records does not become HTML', async () => {
    const el = document.createElement('div')
    const { msk } = fakeMsk([row('1', '<img src=x onerror=alert(1)>', 'manage')])
    mountCrud(el, msk, 'notes')
    await tick()
    expect(el.querySelector('img')).toBeNull()
    expect(el.textContent).toContain('<img src=x')
  })

  it('speaks the language of the host and follows its changes', async () => {
    const el = document.createElement('div')
    const { msk, emit } = fakeMsk([row('1', 'a', 'read')], it_ctx)
    mountCrud(el, msk, 'notes')
    await tick()
    expect(el.textContent).toContain('sola lettura')
    expect(el.querySelector('.msk-count')!.textContent).toBe('1 elemento')
    msk.context = { ...it_ctx, lang: 'en' }
    emit('context', msk.context)
    expect(el.textContent).toContain('read only')
    expect(el.querySelector('.msk-count')!.textContent).toBe('1 item')
  })
})
