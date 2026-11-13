// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetBusy, setBusy, withBusy } from './busy.ts'

const box = () => document.querySelector('.msk-busy')

describe('the loading spinner of the kit', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetBusy()
  })
  afterEach(() => {
    resetBusy()
    vi.useRealTimers()
  })

  it('shows only if the work lasts a little, and hides at the end', () => {
    setBusy(true, 'Loading…')
    expect(box()).toBeNull()
    vi.advanceTimersByTime(200)
    expect(box()?.textContent).toBe('Loading…')
    expect(box()?.getAttribute('role')).toBe('status')
    setBusy(false, 'Loading…')
    expect(box()).toBeNull()
  })

  it('does not flash for a fast answer', () => {
    setBusy(true, 'Loading…')
    setBusy(false, 'Loading…')
    vi.advanceTimersByTime(500)
    expect(box()).toBeNull()
  })

  it('is counted: two works keep it on until both are done', () => {
    setBusy(true, 'x')
    setBusy(true, 'x')
    vi.advanceTimersByTime(200)
    setBusy(false, 'x')
    expect(box()).not.toBeNull()
    setBusy(false, 'x')
    expect(box()).toBeNull()
  })

  it('goes off at an unhandled error of the page, so a plugin that forgot to turn it off is not stuck', () => {
    setBusy(true, 'x')
    vi.advanceTimersByTime(200)
    expect(box()).not.toBeNull()
    window.dispatchEvent(new Event('error'))
    expect(box()).toBeNull()
  })

  it('withBusy turns it off also when the work fails', async () => {
    vi.useRealTimers()
    await expect(withBusy(Promise.reject(new Error('no')), 'x')).rejects.toThrow('no')
    expect(box()).toBeNull()
  })
})
