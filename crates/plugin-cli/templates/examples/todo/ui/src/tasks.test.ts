import { describe, expect, it } from 'vitest'
import { isOverdue, pageFilter } from './tasks.ts'
import { fill, texts } from './i18n.ts'

describe('tasks', () => {
  it('is overdue only when open and past the due date', () => {
    expect(isOverdue({ due: '2026-01-01' }, '2026-02-01')).toBe(true)
    expect(isOverdue({ due: '2026-01-01', done: true }, '2026-02-01')).toBe(false)
    expect(isOverdue({ due: '2026-03-01' }, '2026-02-01')).toBe(false)
    expect(isOverdue({}, '2026-02-01')).toBe(false)
  })

  it('each page of the navigation filters the tasks', () => {
    const open = { done: false }
    const done = { done: true }
    expect([open, done].filter(pageFilter('done'))).toEqual([done])
    expect([open, done].filter(pageFilter('all'))).toHaveLength(2)
    expect([open, done].filter(pageFilter(undefined))).toEqual([open])
  })
})

describe('texts', () => {
  it('follow the language of the host, with English as the fallback', () => {
    expect(texts('it').late).toBe('In ritardo')
    expect(texts('fr').late).toBe('Overdue')
    expect(fill(texts('en').due, { d: 'Mon' })).toBe('Due Mon')
  })
})
