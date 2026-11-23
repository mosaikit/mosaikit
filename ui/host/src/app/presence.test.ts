import { describe, expect, it } from 'vitest'
import { ActivityClock, applyEvent, AWAY_AFTER, HIDDEN_AFTER } from './presence.ts'

describe('ActivityClock', () => {
  it('is available, then away after 5 minutes without input, then back on input', () => {
    const c = new ActivityClock(0)
    expect(c.status(AWAY_AFTER - 1)).toBe('available')
    expect(c.status(AWAY_AFTER)).toBe('away')
    c.input(AWAY_AFTER + 10)
    expect(c.status(AWAY_AFTER + 11)).toBe('available')
    expect(c.status(2 * AWAY_AFTER + 10)).toBe('away')
  })

  it('a tab hidden for long is away even if the person typed before', () => {
    const c = new ActivityClock(0)
    c.input(1000)
    c.visibility(2000, true)
    expect(c.status(2000 + HIDDEN_AFTER - 1)).toBe('available')
    expect(c.status(2000 + HIDDEN_AFTER)).toBe('away')
    // showing the tab again is an act of the person
    c.visibility(2000 + HIDDEN_AFTER + 5, false)
    expect(c.status(2000 + HIDDEN_AFTER + 6)).toBe('available')
  })

  it('says when the status may change', () => {
    const c = new ActivityClock(0)
    expect(c.next(1000)).toBe(AWAY_AFTER - 1000)
    c.visibility(1000, true)
    expect(c.next(1000)).toBe(HIDDEN_AFTER)
    expect(c.next(AWAY_AFTER + HIDDEN_AFTER)).toBeNull()
  })

  it('starts away-counting from a hidden tab', () => {
    const c = new ActivityClock(0, true)
    expect(c.status(HIDDEN_AFTER)).toBe('away')
  })
})

describe('applyEvent', () => {
  const a = { id: 'a', state: { status: 'available' } }
  const b = { id: 'b', state: { status: 'away' } }
  it('the first event replaces the list', () => {
    expect(applyEvent({ old: 'available' }, 'presence', { people: [a, b] })).toEqual({ a: 'available', b: 'away' })
  })
  it('join, state and leave change one person', () => {
    let u = applyEvent({}, 'join', { from: a })
    expect(u).toEqual({ a: 'available' })
    u = applyEvent(u, 'state', { from: { id: 'a', state: { status: 'away' } } })
    expect(u).toEqual({ a: 'away' })
    u = applyEvent(u, 'leave', { from: { id: 'a' } })
    expect(u).toEqual({})
  })
  it('ignores what it does not know', () => {
    const u = { a: 'available' as const }
    expect(applyEvent(u, 'message', { from: b })).toBe(u)
    expect(applyEvent(u, 'join', null)).toBe(u)
  })
})
