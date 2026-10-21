// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { Msk } from './client.ts'
import { mountCrud } from './crud-view.ts'
import type { Bridge } from './bridge.ts'

const fields = [
  { key: 'title', label: 'Titolo', kind: 'text', required: true },
  { key: 'done', label: 'Fatto', kind: 'bool' },
  { key: 'secret', label: 'Calcolato', kind: 'number', hidden: true },
]

function row(id: string, title: string, level: string, owner = 'anna') {
  return { id, values: { title, done: false, secret: 1 }, owner_id: 'u', owner_name: owner, my_level: level, shared: level !== 'manage', parent_id: null, created_at: '', updated_at: '' }
}

function fakeMsk(rows: any[]) {
  const calls: { op: string; args: any }[] = []
  const bridge = {
    call: async (op: string, args: any) => {
      calls.push({ op, args })
      if (op === 'crud.list') return { resource: 'notes', fields, rows }
      if (op === 'crud.create') return row('nuovo', args.values.title, 'manage')
      if (op === 'confirm') return true
      return {}
    },
    onEvent: () => () => {},
  } as unknown as Bridge
  return { msk: new Msk(bridge, { public: false }), calls }
}

const tick = () => new Promise((r) => setTimeout(r, 0))

describe('mountCrud', () => {
  it('mostra righe, livelli e nasconde i campi calcolati', async () => {
    const el = document.createElement('div')
    const { msk } = fakeMsk([row('1', 'mia', 'manage'), row('2', 'di bruno', 'read', 'bruno')])
    mountCrud(el, msk, 'notes', { title: 'Note' })
    await tick()
    expect(el.querySelectorAll('tbody tr.row').length).toBe(2)
    expect(el.textContent).toContain('sola lettura')
    expect(el.querySelector('th')!.textContent).toBe('Titolo')
    expect(el.textContent).not.toContain('Calcolato')
    // riga in sola lettura: campi disabilitati, niente salva/condividi/elimina
    ;(el.querySelectorAll('tbody tr.row')[1] as HTMLElement).click()
    const input = el.querySelector<HTMLInputElement>('[data-key="title"]')!
    expect(input.disabled).toBe(true)
    const buttons = [...el.querySelectorAll<HTMLButtonElement>('.msk-actions button')]
    expect(buttons.filter((b) => !b.hidden).map((b) => b.textContent)).toEqual(['Chiudi'])
  })

  it('crea un elemento con i valori tipizzati', async () => {
    const el = document.createElement('div')
    const { msk, calls } = fakeMsk([])
    mountCrud(el, msk, 'notes')
    await tick()
    el.querySelector<HTMLInputElement>('[data-key="title"]')!.value = 'nuova nota'
    el.querySelector<HTMLInputElement>('[data-key="done"]')!.checked = true
    ;[...el.querySelectorAll<HTMLButtonElement>('.msk-actions button')].find((b) => b.textContent === 'Salva')!.click()
    await tick()
    const create = calls.find((c) => c.op === 'crud.create')!
    expect(create.args).toEqual({ resource: 'notes', values: { title: 'nuova nota', done: true }, parent: undefined })
  })

  it('il testo dei record non diventa HTML', async () => {
    const el = document.createElement('div')
    const { msk } = fakeMsk([row('1', '<img src=x onerror=alert(1)>', 'manage')])
    mountCrud(el, msk, 'notes')
    await tick()
    expect(el.querySelector('img')).toBeNull()
    expect(el.textContent).toContain('<img src=x')
  })
})
