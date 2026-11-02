import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHoverController } from './hoverMenu.ts'

describe('createHoverController', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('opens after the delay, not on a fast pass', () => {
    const set = vi.fn()
    const c = createHoverController(set, 150, 150)
    c.enter(false)
    vi.advanceTimersByTime(100)
    c.leave(false)
    vi.advanceTimersByTime(500)
    expect(set).not.toHaveBeenCalled()
    c.enter(false)
    vi.advanceTimersByTime(150)
    expect(set).toHaveBeenCalledWith(true)
  })

  it('closes after the grace delay, unless the pointer comes back', () => {
    const set = vi.fn()
    const c = createHoverController(set, 150, 150)
    c.leave(true)
    vi.advanceTimersByTime(100)
    c.enter(true)
    vi.advanceTimersByTime(500)
    expect(set).not.toHaveBeenCalled()
    c.leave(true)
    vi.advanceTimersByTime(150)
    expect(set).toHaveBeenCalledWith(false)
  })
})
