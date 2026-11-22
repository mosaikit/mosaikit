// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { chart, chartOption } from './chart.ts'
import { csvCell, downloadCsv, toCsv } from './download.ts'
import { filteredEmpty } from './empty-state.ts'
import { menu, popover } from './kit.ts'
import { shareChip } from './share-chip.ts'
import { keyName, shortcuts } from './shortcuts.ts'
import { undoToast } from './undo.ts'
import { virtualList } from './virtual-list.ts'

afterEach(() => {
  document.body.replaceChildren()
  vi.useRealTimers()
})

const press = (key: string, init: KeyboardEventInit = {}, target: EventTarget = document) => target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))
const mods = { ctrlKey: false, metaKey: false, altKey: false }

describe('shortcuts', () => {
  it('names keys', () => {
    expect(keyName({ key: 'k', ...mods, ctrlKey: true, shiftKey: false })).toBe('ctrl+k')
    expect(keyName({ key: '?', ...mods, shiftKey: true })).toBe('?')
    expect(keyName({ key: 'ArrowDown', ...mods, shiftKey: true })).toBe('shift+arrowdown')
  })
  it('runs a key, ignores it in a field, opens the help sheet on ?', () => {
    const n = vi.fn()
    const s = shortcuts([
      { keys: 'n', label: 'New', run: n },
      { keys: 'g i', label: 'Go to inbox', run: n, group: 'Go' },
    ])
    press('n')
    expect(n).toHaveBeenCalledTimes(1)
    const input = document.createElement('input')
    document.body.append(input)
    press('n', {}, input)
    expect(n).toHaveBeenCalledTimes(1)
    press('g')
    press('i')
    expect(n).toHaveBeenCalledTimes(2)
    press('?')
    const sheet = document.querySelector('dialog.msk-keysheet')!
    expect(sheet.textContent).toContain('New')
    expect(sheet.querySelectorAll('kbd').length).toBeGreaterThan(2)
    press('n')
    expect(n).toHaveBeenCalledTimes(2) // a dialog is open
    s.dispose()
    expect(document.querySelector('dialog')).toBeNull()
  })
})

describe('download', () => {
  it('quotes and neutralises cells', () => {
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('say "x"')).toBe('"say ""x"""')
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)")
    expect(csvCell('-5')).toBe('-5')
    expect(csvCell(null)).toBe('')
    expect(toCsv([[1, 'x']], { header: ['n', 's'] })).toBe('n,s\r\n1,x\r\n')
  })
  it('downloads through an anchor', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
    const clicked = vi.fn()
    HTMLAnchorElement.prototype.click = clicked
    const blob = downloadCsv('rows', [['é']])
    expect(clicked).toHaveBeenCalled()
    expect(await blob.text()).toBe('﻿é\r\n')
  })
})

describe('undoToast', () => {
  it('commits after the time, once', () => {
    vi.useFakeTimers()
    const commit = vi.fn()
    const undo = vi.fn()
    undoToast({ text: 'Deleted', commit, undo, ms: 1000 })
    vi.advanceTimersByTime(1100)
    expect(commit).toHaveBeenCalledTimes(1)
    expect(undo).not.toHaveBeenCalled()
  })
  it('undo cancels the commit', () => {
    vi.useFakeTimers()
    const commit = vi.fn()
    const undo = vi.fn()
    undoToast({ text: 'Deleted', commit, undo, ms: 1000 })
    ;(document.querySelector('.msk-toast button') as HTMLButtonElement).click()
    vi.advanceTimersByTime(2000)
    expect(undo).toHaveBeenCalledTimes(1)
    expect(commit).not.toHaveBeenCalled()
  })
})

describe('shareChip', () => {
  it('shows who sees it and opens the dialog', () => {
    const open = vi.fn()
    const c = shareChip({ names: ['Ada Lovelace', 'Bob'], onOpen: open })
    document.body.append(c.el)
    expect(c.el.textContent).toContain('Shared with 2')
    ;(c.el.querySelector('button') as HTMLButtonElement).click()
    expect(open).toHaveBeenCalled()
    c.set([])
    expect(c.el.textContent).toContain('Only you')
  })
  it('is not a button when read only', () => {
    const c = shareChip({ names: ['A'], onOpen: () => {}, readonly: true })
    expect(c.el.querySelector('button')).toBeNull()
  })
})

describe('filteredEmpty', () => {
  it('is a small message with Clear filters', () => {
    const clear = vi.fn()
    const e = filteredEmpty('No match', 'Clear filters', clear)
    expect(e.getAttribute('role')).toBe('status')
    e.querySelector('button')!.click()
    expect(clear).toHaveBeenCalled()
  })
})

describe('popover (Floating UI)', () => {
  it('is placed and closes on Escape', async () => {
    const a = document.createElement('button')
    document.body.append(a)
    const p = popover(a, document.createElement('div'))
    await new Promise((r) => setTimeout(r, 0))
    expect(p.el.dataset.placement).toMatch(/^(bottom|top)/)
    expect(a.getAttribute('aria-expanded')).toBe('true')
    press('Escape')
    expect(document.querySelector('.msk-popover')).toBeNull()
    menu(a, [{ label: 'x', onClick: () => {} }]).close()
  })
})

describe('virtualList', () => {
  it('draws only the rows in view', () => {
    const v = virtualList({ count: 10_000, estimateSize: 40, render: (i) => Object.assign(document.createElement('div'), { textContent: `row ${i}` }), label: 'Rows' })
    v.el.style.height = '200px'
    document.body.append(v.el)
    v.setCount(10_000)
    expect(v.visible().length).toBeLessThan(100)
    expect(v.el.querySelector('.msk-vlist-inner')!.getAttribute('aria-label')).toBe('Rows')
    v.setCount(3)
    expect(v.visible().length).toBeLessThanOrEqual(3)
    v.destroy()
  })
})

describe('chart', () => {
  const spec = { type: 'bar' as const, label: 'Tasks per week', categories: ['W1', 'W2'], series: [{ name: 'Closed', data: [3, 5] }] }
  it('has a name and a data table that follows updates', async () => {
    const c = chart(spec, { data: 'Show data' })
    document.body.append(c.el)
    await c.ready // no canvas in the test DOM: it may fall back to the table only
    expect(c.el.querySelector('[role=img]')!.getAttribute('aria-label')).toBe('Tasks per week')
    expect([...c.el.querySelectorAll('tbody td')].map((t) => t.textContent)).toEqual(['3', '5'])
    c.update({ ...spec, series: [{ name: 'Closed', data: [7, 9] }] })
    expect([...c.el.querySelectorAll('tbody td')].map((t) => t.textContent)).toEqual(['7', '9'])
    c.destroy()
  })
  it('builds options in the colours of the page', () => {
    document.documentElement.style.setProperty('--fg', '#111111')
    const o = chartOption(spec, String) as { tooltip: { textStyle: { color: string } }; series: { type: string }[] }
    expect(o.tooltip.textStyle.color).toBe('#111111')
    expect(o.series[0]!.type).toBe('bar')
    const pie = chartOption({ ...spec, type: 'pie' }, String) as { series: { data: unknown[] }[] }
    expect(pie.series[0]!.data).toHaveLength(2)
  })
})
