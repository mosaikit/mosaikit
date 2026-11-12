// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { kanban } from './kanban.ts'
import { addDays, avatarStack, personPicker, progress, segmented, tagInput, toast } from './kit.ts'
import { checkProgress, renderMarkdown, toggleCheck } from './markdown.ts'
import { prefixLines, richText, wrapSelection } from './richtext.ts'

describe('markdown', () => {
  it('never interprets HTML of the source', () => {
    const e = renderMarkdown('<img src=x onerror=alert(1)> **b**')
    expect(e.querySelector('img')).toBeNull()
    expect(e.querySelector('strong')!.textContent).toBe('b')
    expect(e.textContent).toContain('<img src=x onerror=alert(1)>')
  })
  it('links only http, https and mailto', () => {
    const e = renderMarkdown('[a](https://x.org) [b](javascript:alert(1)) [c](mailto:a@b.c)')
    const hrefs = [...e.querySelectorAll('a')].map((a) => a.getAttribute('href'))
    expect(hrefs).toEqual(['https://x.org', 'mailto:a@b.c'])
    expect(e.textContent).toContain('[b](javascript:alert(1))')
  })
  it('renders blocks', () => {
    const e = renderMarkdown('# T\n\npara\nline\n\n- a\n- b\n\n1. x\n\n> q\n\n```\ncode **x**\n```')
    expect(e.querySelector('h1')!.textContent).toBe('T')
    expect(e.querySelectorAll('ul li')).toHaveLength(2)
    expect(e.querySelectorAll('ol li')).toHaveLength(1)
    expect(e.querySelector('p br')).not.toBeNull()
    expect(e.querySelector('blockquote')!.textContent).toBe('q')
    expect(e.querySelector('pre code')!.textContent).toBe('code **x**')
  })
  it('check lists are live and keep their line numbers', () => {
    const onToggle = vi.fn()
    const e = renderMarkdown('intro\n- [ ] one\n- [x] two', { onToggle })
    const boxes = e.querySelectorAll<HTMLInputElement>('input[type=checkbox]')
    expect([...boxes].map((b) => b.checked)).toEqual([false, true])
    boxes[0]!.checked = true
    boxes[0]!.dispatchEvent(new Event('change'))
    expect(onToggle).toHaveBeenCalledWith(1, true)
  })
  it('toggles and counts checks', () => {
    const src = '- [ ] a\n- [x] b\ntext'
    expect(toggleCheck(src, 0, true)).toBe('- [x] a\n- [x] b\ntext')
    expect(toggleCheck(src, 2, true)).toBe(src)
    expect(checkProgress(src)).toEqual({ done: 1, total: 2 })
  })
})

describe('editor helpers', () => {
  it('wraps a selection or a placeholder', () => {
    expect(wrapSelection('hello world', 0, 5, '**', '**')).toEqual({ text: '**hello** world', start: 2, end: 7 })
    expect(wrapSelection('', 0, 0, '*', '*', 'it').text).toBe('*it*')
  })
  it('prefixes and unprefixes the lines of a selection', () => {
    const a = prefixLines('a\nb\nc', 0, 3, '- ')
    expect(a.text).toBe('- a\n- b\nc')
    expect(prefixLines(a.text, a.start, a.end, '- ').text).toBe('a\nb\nc')
  })
  it('keeps the value and shows a preview', () => {
    const onChange = vi.fn()
    const rt = richText({ label: 'Text', value: '# hi', onChange })
    document.body.append(rt.el)
    rt.el.querySelector<HTMLButtonElement>('[role=tab]:nth-child(2)')!.click()
    expect(rt.el.querySelector('.msk-rt-view h1')!.textContent).toBe('hi')
    rt.el.querySelector<HTMLButtonElement>('[role=tab]')!.click()
    const ta = rt.el.querySelector('textarea')!
    ta.value = 'x'
    ta.dispatchEvent(new Event('input'))
    expect(onChange).toHaveBeenCalledWith('x')
    expect(rt.get()).toBe('x')
  })
})

describe('kit', () => {
  it('progress exposes its value and clamps', () => {
    const p = progress({ value: 7, max: 4, label: 'Done' })
    expect(p.getAttribute('aria-valuenow')).toBe('4')
    expect(p.style.getPropertyValue('--pct')).toBe('100')
    expect(progress({ value: 1, max: 0, label: 'x' }).style.getPropertyValue('--pct')).toBe('0')
  })
  it('segmented marks the pressed one and reports changes', () => {
    const onChange = vi.fn()
    const s = segmented({ label: 'View', options: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }], value: 'a', onChange })
    const [a, b] = s.el.querySelectorAll('button')
    expect(a!.getAttribute('aria-pressed')).toBe('true')
    b!.click()
    expect(onChange).toHaveBeenCalledWith('b')
    expect(b!.getAttribute('aria-pressed')).toBe('true')
  })
  it('tag input adds, de-duplicates and removes', () => {
    const onChange = vi.fn()
    const t = tagInput({ label: 'Tags', values: ['a'], onChange })
    const input = t.el.querySelector('input')!
    input.value = 'B'
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    input.value = 'b'
    t.el.querySelector('input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(t.get()).toEqual(['a', 'B'])
    t.el.querySelector<HTMLButtonElement>('.msk-tagx')!.click()
    expect(t.get()).toEqual(['B'])
  })
  it('person picker searches and picks', async () => {
    vi.useFakeTimers()
    const search = vi.fn(async () => [{ id: 'u1', username: 'ada', name: 'Ada Lovelace' }])
    const onChange = vi.fn()
    const p = personPicker({ label: 'Assignee', search, value: null, onChange })
    const input = p.el.querySelector('input')!
    input.value = 'ad'
    input.dispatchEvent(new Event('input'))
    await vi.advanceTimersByTimeAsync(250)
    p.el.querySelector<HTMLButtonElement>('.msk-person-opt')!.click()
    expect(onChange).toHaveBeenCalledWith({ id: 'u1', username: 'ada', name: 'Ada Lovelace' })
    expect(p.el.textContent).toContain('Ada Lovelace')
    vi.useRealTimers()
  })
  it('dates and stacks', () => {
    expect(addDays(1, new Date(2026, 0, 31))).toBe('2026-02-01')
    const s = avatarStack(['A B', 'C D', 'E F'], 2)
    expect(s.querySelectorAll('.msk-avatar')).toHaveLength(3)
    expect(s.querySelector('.more')!.textContent).toBe('+1')
  })
  it('toast announces and goes away', () => {
    vi.useFakeTimers()
    toast('Saved', { ms: 100 })
    expect(document.querySelector('.msk-toasts')!.getAttribute('aria-live')).toBe('polite')
    expect(document.querySelectorAll('.msk-toast')).toHaveLength(1)
    vi.advanceTimersByTime(150)
    expect(document.querySelectorAll('.msk-toast')).toHaveLength(0)
    vi.useRealTimers()
  })
})

describe('kanban', () => {
  type T = { id: string; col: string }
  const make = (items: T[], onMove = vi.fn()) => {
    const k = kanban<T>({
      label: 'Board',
      columns: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }, { key: 'c', label: 'C', droppable: false }],
      columnOf: (t) => t.col,
      id: (t) => t.id,
      card: (t) => Object.assign(document.createElement('span'), { textContent: t.id }),
      title: (t) => t.id,
      onMove,
    })
    k.set(items)
    document.body.append(k.el)
    return { k, onMove }
  }
  const key = (el: Element, key: string) => el.dispatchEvent(new KeyboardEvent('keydown', { key, altKey: true, bubbles: true }))

  it('lists the cards per column with counts', () => {
    const { k } = make([{ id: '1', col: 'a' }, { id: '2', col: 'a' }, { id: '3', col: 'b' }])
    expect([...k.el.querySelectorAll('.msk-colcount')].map((c) => c.textContent)).toEqual(['2', '1', '0'])
  })
  it('Alt+Right moves to the next column, skipping fixed ones, and announces it', () => {
    const { k, onMove } = make([{ id: '1', col: 'a' }, { id: '3', col: 'b' }])
    key(k.el.querySelector('[data-id="1"]')!, 'ArrowRight')
    expect(onMove).toHaveBeenCalledWith({ id: '1', col: 'a' }, 'b', 0, '3')
    expect(k.el.querySelector('.msk-sr')!.textContent).toBe('1 moved to B')
    key(k.el.querySelector('[data-id="3"]')!, 'ArrowRight')
    expect(onMove).toHaveBeenCalledTimes(1)
  })
  it('Alt+Down reorders inside a column', () => {
    const { k, onMove } = make([{ id: '1', col: 'a' }, { id: '2', col: 'a' }, { id: '3', col: 'a' }])
    key(k.el.querySelector('[data-id="1"]')!, 'ArrowDown')
    expect(onMove).toHaveBeenCalledWith({ id: '1', col: 'a' }, 'a', 1, '3')
    key(k.el.querySelector('[data-id="3"]')!, 'ArrowDown')
    expect(onMove).toHaveBeenCalledTimes(1)
  })
  it('a fixed card does not move', () => {
    const onMove = vi.fn()
    const k = kanban<T>({ label: 'B', columns: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }], columnOf: (t) => t.col, id: (t) => t.id, card: () => document.createElement('i'), onMove, canMove: () => false })
    k.set([{ id: '1', col: 'a' }])
    key(k.el.querySelector('[data-id="1"]')!, 'ArrowRight')
    expect(onMove).not.toHaveBeenCalled()
  })
})
