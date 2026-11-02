import { describe, expect, it, vi } from 'vitest'
import { Msk } from './client.ts'
import type { Bridge } from './bridge.ts'

function fake() {
  const calls: { op: string; args: any }[] = []
  const listeners: ((event: string, data: unknown) => void)[] = []
  const bridge = {
    call: async (op: string, args: any) => {
      calls.push({ op, args })
      return null
    },
    onEvent: (fn: (event: string, data: unknown) => void) => {
      listeners.push(fn)
      return () => {}
    },
  } as unknown as Bridge
  return { msk: new Msk(bridge, { public: false }), calls, emit: (e: string, d: unknown) => listeners.forEach((l) => l(e, d)) }
}

describe('msk.band', () => {
  it('sends the data without the callbacks and routes the events to them', () => {
    const { msk, calls, emit } = fake()
    const onChange = vi.fn()
    const onToggle = vi.fn()
    msk.band.set({ search: false, mode: { value: 'view', canEdit: true, onChange }, presence: [{ id: 'a', name: 'Ada' }], comments: { open: false, count: 2, onToggle } })
    expect(calls).toEqual([
      { op: 'band.set', args: { search: false, mode: { value: 'view', canEdit: true }, presence: [{ id: 'a', name: 'Ada' }], comments: { open: false, count: 2 } } },
    ])
    emit('band.mode', { value: 'edit' })
    emit('band.mode', { value: 'nonsense' })
    emit('band.comments', {})
    expect(onChange).toHaveBeenCalledOnce()
    expect(onChange).toHaveBeenCalledWith('edit')
    expect(onToggle).toHaveBeenCalledOnce()
  })

  it('reset drops the callbacks and tells the host', () => {
    const { msk, calls, emit } = fake()
    const onToggle = vi.fn()
    msk.band.set({ comments: { open: false, onToggle } })
    msk.band.reset()
    emit('band.comments', {})
    expect(onToggle).not.toHaveBeenCalled()
    expect(calls.at(-1)).toEqual({ op: 'band.reset', args: undefined })
  })
})
