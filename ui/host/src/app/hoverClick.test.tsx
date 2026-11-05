import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useHoverMenu } from './hoverMenu.ts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function Probe() {
  const h = useHoverMenu(true)
  return (
    <div id="area" data-open={h.open} {...h.areaProps}>
      <a id="link" href="#x">
        link
      </a>
    </div>
  )
}

// React builds pointerenter/leave from pointerover/out
const real: Record<string, string> = { pointerenter: 'pointerover', pointerleave: 'pointerout' }
const ev = (type: string) => new PointerEvent(real[type] ?? type, { bubbles: true, pointerType: 'mouse' })

describe('hover menu and a click on the entry', () => {
  let host: HTMLElement
  let root: Root
  beforeEach(async () => {
    vi.useFakeTimers()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => root.render(<Probe />))
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    vi.useRealTimers()
    host.remove()
  })
  const area = () => host.querySelector('#area')!
  const open = () => area().getAttribute('data-open')
  const fire = async (el: Element, type: string, ms = 0) =>
    act(async () => {
      el.dispatchEvent(ev(type))
      vi.advanceTimersByTime(ms)
    })

  it('opens as soon as the pointer is on the entry', async () => {
    await fire(area(), 'pointerenter', 200)
    expect(open()).toBe('true')
  })

  it('a press on the link keeps the menu the hover opened, and it stays after the pointer leaves', async () => {
    await fire(area(), 'pointerenter', 0)
    await fire(host.querySelector('#link')!, 'pointerdown', 500)
    expect(open()).toBe('true')
    await fire(area(), 'pointerleave', 500)
    expect(open()).toBe('true')
  })

  it('a press in the same tick as the enter leaves the menu open', async () => {
    await act(async () => {
      area().dispatchEvent(ev('pointerenter'))
      host.querySelector('#link')!.dispatchEvent(ev('pointerdown'))
    })
    expect(open()).toBe('true')
  })

  it('opening a menu closes the one that was open', async () => {
    await act(async () => {
      root.render(
        <>
          <Probe />
          <Probe />
        </>,
      )
    })
    const [a, b] = Array.from(host.querySelectorAll('#area'))
    await fire(a, 'pointerenter', 0)
    expect(a.getAttribute('data-open')).toBe('true')
    await fire(b, 'pointerenter', 0)
    expect(b.getAttribute('data-open')).toBe('true')
    expect(a.getAttribute('data-open')).toBe('false')
  })

  it('opens again after the pointer left and came back', async () => {
    await fire(host.querySelector('#link')!, 'pointerdown')
    await fire(area(), 'pointerleave', 200)
    await fire(area(), 'pointerenter', 200)
    expect(open()).toBe('true')
  })
})
