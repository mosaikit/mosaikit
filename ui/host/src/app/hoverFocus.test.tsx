import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { FlyoutMenu } from './slots.tsx'
import { useHoverMenu } from './hoverMenu.ts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver

function Rail() {
  const hover = useHoverMenu(true)
  return (
    <div>
      <input id="typing" />
      <div id="area" {...hover.areaProps}>
        <FlyoutMenu item={{ label: 'Work', active: false, children: [{ label: 'Notes', href: '#/n', active: false }] }} hover={hover} trigger={<button type="button">Work</button>} />
      </div>
    </div>
  )
}

describe('menu opened by hover', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('opens without taking the focus from the field being typed in', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => root.render(<Rail />))
    const input = host.querySelector<HTMLInputElement>('#typing')!
    input.focus()
    const area = host.querySelector('#area')!
    await act(async () => {
      area.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }))
      area.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }))
      vi.advanceTimersByTime(200)
    })
    expect(document.querySelector('[role="menu"]')).not.toBeNull()
    await act(async () => vi.advanceTimersByTime(50))
    expect(document.activeElement).toBe(input)
    await act(async () => root.unmount())
  })
})
