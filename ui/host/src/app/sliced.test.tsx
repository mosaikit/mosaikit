import { describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Sliced } from './kit.tsx'

describe('Sliced', () => {
  it('shows a page, then more by the button; no foot when everything fits', async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const el = document.createElement('div')
    const root = createRoot(el)
    const items = Array.from({ length: 120 }, (_, i) => i)
    await act(async () => root.render(<Sliced items={items}>{(rows) => <ul>{rows.map((r) => <li key={r}>{r}</li>)}</ul>}</Sliced>))
    expect(el.querySelectorAll('li').length).toBe(50)
    expect(el.textContent).toContain('50 of 120')
    await act(async () => el.querySelector('button')!.click())
    expect(el.querySelectorAll('li').length).toBe(100)
    await act(async () => root.render(<Sliced items={[1, 2, 3]}>{(rows) => <ul>{rows.map((r) => <li key={r}>{r}</li>)}</ul>}</Sliced>))
    expect(el.querySelectorAll('li').length).toBe(3)
    expect(el.querySelector('button')).toBeNull()
  })
})
