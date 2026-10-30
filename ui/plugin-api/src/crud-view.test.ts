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

function fakeMsk(rows: any[], context?: UiContext, decl: unknown[] = fields) {
  const calls: { op: string; args: any }[] = []
  const listeners: ((event: string, data: unknown) => void)[] = []
  const bridge = {
    call: async (op: string, args: any) => {
      calls.push({ op, args })
      if (op === 'crud.list') return { resource: 'notes', fields: decl, rows }
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
  it('a plugin adds its own parts: box of the item, editor with hidden values, header controls, onLoad', async () => {
    const el = document.createElement('div')
    const { msk, calls } = fakeMsk([row('1', 'one', 'manage')])
    const loaded: number[] = []
    const extra = document.createElement('button')
    extra.textContent = 'Tags'
    mountCrud(el, msk, 'notes', {
      views: [{ key: 'flow', label: 'Flow', kind: 'flow', item: (c) => Object.assign(document.createElement('span'), { textContent: c.text('title') }), box: (c, box) => box.classList.add('mine', `n-${c.row.id}`) }],
      bar: [extra],
      onLoad: (rows) => loaded.push(rows.length),
      editor: (ctx, box) => {
        const b = document.createElement('button')
        b.type = 'button'
        b.className = 'ed'
        b.textContent = String(ctx.value('secret'))
        b.addEventListener('click', () => ctx.set('secret', 7))
        box.append(b)
      },
    })
    await tick()
    expect(loaded).toEqual([1])
    expect(el.querySelector('.msk-items.flow .msk-item.mine.n-1')).not.toBeNull()
    expect(el.querySelector('.msk-subbar')!.textContent).toContain('Tags')
    el.querySelector<HTMLElement>('.msk-item')!.click()
    await tick()
    el.querySelector<HTMLButtonElement>('.msk-editor .ed')!.click()
    el.querySelector<HTMLButtonElement>('.msk-actions .msk-btn:not(.ghost):not(.danger)')?.click()
    el.querySelectorAll<HTMLButtonElement>('.msk-actions button').forEach((b) => b.textContent === 'Save' && b.click())
    await tick()
    expect(calls.find((c) => c.op === 'crud.update')?.args.values.secret).toBe(7)
  })

  it('a page of the navigation shows only its rows (where)', async () => {
    const el = document.createElement('div')
    const { msk } = fakeMsk([row('1', 'mine', 'manage'), row('2', 'from bruno', 'read', 'bruno')])
    mountCrud(el, msk, 'notes', { title: 'Shared with me', where: (r) => r.owner_name !== 'anna' })
    await tick()
    expect(el.querySelectorAll('tbody tr.row').length).toBe(1)
    expect(el.textContent).toContain('bruno')
  })

  it('asks a page at a time, loads more and filters on the server', async () => {
    const el = document.createElement('div')
    const calls: { op: string; args: any }[] = []
    const bridge = {
      call: async (op: string, args: any) => {
        calls.push({ op, args })
        if (op === 'crud.list') {
          if (args.filter) return { resource: 'notes', fields, rows: [row('9', 'found', 'manage')], next: null, total: 1 }
          if (args.cursor === 'c2') return { resource: 'notes', fields, rows: [row('3', 'c', 'manage')], next: null, total: 3 }
          return { resource: 'notes', fields, rows: [row('1', 'a', 'manage'), row('2', 'b', 'manage')], next: 'c2', total: 3 }
        }
        if (op === 'ext.list') return []
        return {}
      },
      onEvent: () => () => {},
    } as unknown as Bridge
    mountCrud(el, new Msk(bridge, { public: false }), 'notes')
    await tick()
    expect(calls.find((c) => c.op === 'crud.list')!.args).toEqual({ resource: 'notes', filter: undefined, limit: 100 })
    expect(el.querySelector('.msk-count')!.textContent).toBe('2 of 3 items')
    const more = el.querySelector<HTMLButtonElement>('.msk-more')!
    expect(more.hidden).toBe(false)
    more.click()
    await tick()
    expect(calls.filter((c) => c.op === 'crud.list')[1].args.cursor).toBe('c2')
    expect(el.querySelectorAll('tbody tr.row').length).toBe(3)
    expect(el.querySelector('.msk-count')!.textContent).toBe('3 items')
    expect(more.hidden).toBe(true)
    // the words go to the server, a moment after the last key
    const input = el.querySelector<HTMLInputElement>('.msk-filter')!
    input.value = 'found'
    input.dispatchEvent(new Event('input'))
    await new Promise((r) => setTimeout(r, 300))
    await tick()
    expect(calls.filter((c) => c.op === 'crud.list').at(-1)!.args.filter).toBe('found')
    expect(el.querySelectorAll('tbody tr.row').length).toBe(1)
  })

  it('sorts the whole list on the server: the title sends sort and dir and the list restarts from the first page', async () => {
    const el = document.createElement('div')
    const calls: { op: string; args: any }[] = []
    const bridge = {
      call: async (op: string, args: any) => {
        calls.push({ op, args })
        if (op === 'crud.list') {
          const desc = args.dir === 'desc'
          return { resource: 'notes', fields, rows: [row(desc ? '2' : '1', desc ? 'b' : 'a', 'manage')], next: 'c2', total: 3 }
        }
        if (op === 'ext.list') return []
        return {}
      },
      onEvent: () => () => {},
    } as unknown as Bridge
    mountCrud(el, new Msk(bridge, { public: false }), 'notes')
    await tick()
    const lists = () => calls.filter((c) => c.op === 'crud.list')
    expect(lists()[0].args.sort).toBeUndefined()
    const head = () => el.querySelector<HTMLElement>('th button.msk-sorthead')!
    // the computed (hidden) field has no sort button
    expect([...el.querySelectorAll('th')].some((th) => th.textContent === 'Computed' && th.querySelector('button'))).toBe(false)
    head().click()
    await tick()
    expect(lists().at(-1)!.args).toMatchObject({ sort: 'title', dir: 'asc', limit: 100 })
    expect(lists().at(-1)!.args.cursor).toBeUndefined()
    expect(el.querySelector('th')!.getAttribute('aria-sort')).toBe('ascending')
    head().click()
    await tick()
    expect(lists().at(-1)!.args).toMatchObject({ sort: 'title', dir: 'desc' })
    expect(el.querySelector('th')!.getAttribute('aria-sort')).toBe('descending')
    // the next page keeps the sort, with the cursor of the sorted list
    el.querySelector<HTMLButtonElement>('.msk-more')!.click()
    await tick()
    expect(lists().at(-1)!.args).toMatchObject({ sort: 'title', dir: 'desc', cursor: 'c2' })
    // the third click: back to the order of the server
    head().click()
    await tick()
    expect(lists().at(-1)!.args.sort).toBeUndefined()
  })

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

  it('does not offer what the profile of the person does not allow', async () => {
    const el = document.createElement('div')
    const { msk: base } = fakeMsk([row('1', 'mine', 'manage')])
    // only "use": no New, and on an item managed by the person no Share or Delete
    const msk = new Msk(base.bridge, { public: false, perms: ['use'] } as never)
    mountCrud(el, msk, 'notes')
    await tick()
    const toolbar = [...el.querySelectorAll<HTMLButtonElement>('.msk-toolbar button')]
    expect(toolbar.filter((b) => !b.hidden)).toEqual([])
    ;(el.querySelector('tbody tr.row') as HTMLElement).click()
    const buttons = [...el.querySelectorAll<HTMLButtonElement>('.msk-actions button')]
    expect(buttons.filter((b) => !b.hidden).map((b) => b.textContent)).toEqual(['Save', 'Close'])
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

  it('shows the labels of the choice values, and stores the values', async () => {
    const el = document.createElement('div')
    const decl = [{ key: 'tag', label: 'Etichetta', kind: 'choice', options: ['work', 'home'], option_labels: { work: 'lavoro' } }]
    const r = { ...row('1', 'x', 'manage'), values: { tag: 'work' } }
    const { msk } = fakeMsk([r], it_ctx, decl)
    mountCrud(el, msk, 'notes')
    await tick()
    expect(el.querySelector('tbody td')!.textContent).toBe('lavoro')
    ;(el.querySelector('tbody tr.row') as HTMLElement).click()
    const options = [...el.querySelectorAll<HTMLOptionElement>('[data-key="tag"] option')].map((o) => [o.value, o.textContent])
    // a value without a label shows the value
    expect(options).toEqual([['', '—'], ['work', 'lavoro'], ['home', 'home']])
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
  it('shows the fields and actions of the extensions of the plugin', async () => {
    const el = document.createElement('div')
    const calls: { op: string; args: any }[] = []
    const ext = [{ id: 'com.x.review', label: 'Review', fields: [{ key: 'reviewed', label: 'Reviewed', kind: 'bool' }], actions: [{ key: 'approve', label: 'Approve' }] }]
    const bridge = {
      call: async (op: string, args: any) => {
        calls.push({ op, args })
        if (op === 'crud.list') return { resource: 'notes', fields, rows: [row('1', 'mine', 'manage')] }
        if (op === 'crud.update') return row('1', args.values.title, 'manage')
        if (op === 'ext.list') return ext
        if (op === 'ext.values') return { '1': { 'com.x.review': { reviewed: true } } }
        if (op === 'ext.action' || op === 'ext.set') return { values: { reviewed: false } }
        return {}
      },
      onEvent: () => () => {},
    } as unknown as Bridge
    mountCrud(el, new Msk(bridge, { public: false }), 'notes')
    await tick()
    // a column, with the value of the item
    expect([...el.querySelectorAll('th')].map((x) => x.textContent)).toContain('Reviewed')
    expect(el.querySelector('tbody tr.row')!.textContent).toContain('✓')
    expect(calls.find((c) => c.op === 'ext.values')!.args).toEqual({ resource: 'notes', ids: ['1'] })
    // in the detail: the field and the action
    ;(el.querySelector('tbody tr.row') as HTMLElement).click()
    expect(el.querySelector('fieldset legend')!.textContent).toBe('Review')
    const box = el.querySelector<HTMLInputElement>('[data-ext="com.x.review"][data-key="reviewed"]')!
    expect(box.checked).toBe(true)
    const approve = [...el.querySelectorAll<HTMLButtonElement>('fieldset button')].find((b) => b.textContent === 'Approve')!
    approve.click()
    await tick()
    expect(calls.find((c) => c.op === 'ext.action')!.args).toEqual({ resource: 'notes', id: '1', extension: 'com.x.review', action: 'approve' })
    // a changed field is saved with the item
    const box2 = el.querySelector<HTMLInputElement>('[data-ext="com.x.review"][data-key="reviewed"]')!
    box2.checked = true
    ;[...el.querySelectorAll<HTMLButtonElement>('.msk-form > .msk-actions button')].find((b) => b.textContent === 'Save')!.click()
    await tick()
    await tick()
    expect(calls.find((c) => c.op === 'ext.set')!.args).toEqual({ resource: 'notes', id: '1', extension: 'com.x.review', values: { reviewed: true } })
  })

  it('shows the tabs of the extensions in the detail and asks the host to draw them', async () => {
    const el = document.createElement('div')
    document.body.append(el)
    const calls: { op: string; args: any }[] = []
    const listeners: ((event: string, data: unknown) => void)[] = []
    const ext = [
      { id: 'com.x.review', label: 'Review', fields: [{ key: 'history', label: 'History', kind: 'text', hidden: true }], actions: [], tabs: [{ key: 'review', label: 'Review', page: 'tab.html' }] },
    ]
    const bridge = {
      call: async (op: string, args: any) => {
        calls.push({ op, args })
        if (op === 'crud.list') return { resource: 'notes', fields, rows: [row('1', 'mine', 'manage')] }
        if (op === 'ext.list') return ext
        if (op === 'ext.values') return { '1': { 'com.x.review': { history: '[]' } } }
        if (op === 'ext.tab.open') return { handle: 'h1' }
        return null
      },
      onEvent: (fn: (event: string, data: unknown) => void) => {
        listeners.push(fn)
        return () => {}
      },
    } as unknown as Bridge
    const emit = (event: string, data: unknown) => listeners.forEach((l) => l(event, data))
    const unmount = mountCrud(el, new Msk(bridge, { public: false }), 'notes')
    await tick()
    // no tab bar without an item; with an item: Detail and the tab of the extension
    expect(el.querySelector<HTMLElement>('[role="tablist"]')!.hidden).toBe(true)
    ;(el.querySelector('tbody tr.row') as HTMLElement).click()
    const tabs = [...el.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
    expect(tabs.map((t) => [t.textContent, t.getAttribute('aria-selected')])).toEqual([['Detail', 'true'], ['Review', 'false']])
    // the hidden field of the extension and an extension without visible fields: no fieldset
    expect(el.querySelector('fieldset')).toBeNull()
    tabs[1].click()
    await tick()
    expect(calls.find((c) => c.op === 'ext.tab.open')!.args).toMatchObject({ resource: 'notes', id: '1', extension: 'com.x.review', tab: 'review' })
    const panel = el.querySelector<HTMLElement>('[role="tabpanel"]')!
    expect(panel.hidden).toBe(false)
    expect(el.querySelector<HTMLElement>('.msk-form > div:not(.msk-ext):not(.msk-tabs):not(.msk-tabpanel):not(.msk-actions):not(.msk-readonly):not(.msk-msg)')!.hidden).toBe(true)
    // the height asked by the page of the extension, through the host
    emit('ext.tab.height', { handle: 'h1', height: 420 })
    expect(panel.style.height).toBe('420px')
    emit('ext.tab.height', { handle: 'other', height: 90 })
    expect(panel.style.height).toBe('420px')
    // the extension changed its values: the values again
    const before = calls.filter((c) => c.op === 'ext.values').length
    emit('ext.changed', { extension: 'com.x.review', id: '1' })
    await tick()
    expect(calls.filter((c) => c.op === 'ext.values').length).toBe(before + 1)
    // back to the fields: the tab closes; arrows move between the tabs
    el.querySelector<HTMLButtonElement>('[role="tab"]')!.click()
    expect(calls.find((c) => c.op === 'ext.tab.close')!.args).toEqual({ handle: 'h1' })
    expect(panel.hidden).toBe(true)
    el.querySelector<HTMLButtonElement>('[role="tab"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    expect(el.querySelectorAll('[role="tab"]')[1].getAttribute('aria-selected')).toBe('true')
    unmount()
    el.remove()
  })

  it('views: items next to a detail panel, a board by column, reading before editing', async () => {
    const el = document.createElement('div')
    const { msk, calls } = fakeMsk([row('1', 'first', 'manage'), { ...row('2', 'second', 'manage'), values: { title: 'second', done: true } }])
    const item = (c: any) => {
      const d = document.createElement('b')
      d.textContent = c.text('title')
      return d
    }
    mountCrud(el, msk, 'notes', {
      title: 'Notes',
      views: [
        { key: 'cards', label: 'Cards', kind: 'cards', item },
        { key: 'board', label: 'Board', kind: 'board', item, columns: [{ key: 'o', label: () => 'Open', match: (r) => !r.values.done }, { key: 'd', label: () => 'Done', match: (r) => !!r.values.done }] },
      ],
      reader: (c) => {
        const p = document.createElement('p')
        p.className = 'read'
        p.textContent = 'reading ' + c.text('title')
        return p
      },
    })
    await tick()
    expect(el.querySelectorAll('.msk-item').length).toBe(2)
    expect(el.querySelector('.msk-items.cards')).not.toBeNull()
    expect(el.querySelector('.msk-count')!.textContent).toBe('2 items')
    // the switch has two buttons; the board puts each row in its column
    const seg = [...el.querySelectorAll<HTMLButtonElement>('.msk-seg')]
    expect(seg.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false'])
    seg[1].click()
    expect([...el.querySelectorAll('.msk-col')].map((c) => c.textContent)).toEqual(['Open1first', 'Done1second'])
    // an item opens for reading; Edit shows the fields; Cancel goes back to reading
    el.querySelector<HTMLElement>('.msk-item')!.click()
    expect(el.querySelector('.read')!.textContent).toBe('reading first')
    expect(el.querySelector<HTMLElement>('.msk-split')!.dataset.open).toBe('true')
    const edit = [...el.querySelectorAll<HTMLButtonElement>('.msk-actions button')].find((b) => b.textContent === 'Edit')!
    expect(edit.hidden).toBe(false)
    edit.click()
    expect(el.querySelector<HTMLInputElement>('[data-key="title"]')!.value).toBe('first')
    expect(el.querySelector<HTMLElement>('.msk-reader')!.hidden).toBe(true)
    ;[...el.querySelectorAll<HTMLButtonElement>('.msk-actions button')].find((b) => b.textContent === 'Cancel')!.click()
    expect(el.querySelector('.read')).not.toBeNull()
    expect(calls.some((c) => c.op === 'crud.update')).toBe(false)
  })
})
