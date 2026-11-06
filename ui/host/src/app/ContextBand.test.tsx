// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { COMMENTS_PANEL_ID, CommentsButton, ModeSwitch, Presence } from './ContextBand.tsx'

async function draw(node: React.ReactNode) {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const el = document.createElement('div')
  document.body.appendChild(el)
  await act(async () => createRoot(el).render(node))
  return el
}

const person = (i: number, name = `Person ${i}`) => ({ id: `p${i}`, name, initials: `P${i}` })

describe('ModeSwitch', () => {
  it('is a switch: checked in edit mode, a click asks for the other mode', async () => {
    const onChange = vi.fn()
    const el = await draw(<ModeSwitch mode={{ value: 'view', canEdit: true }} onChange={onChange} />)
    const sw = el.querySelector('[role=switch]') as HTMLButtonElement
    expect(sw.getAttribute('aria-checked')).toBe('false')
    expect(sw.getAttribute('aria-label')).toBeTruthy()
    await act(async () => sw.click())
    expect(onChange).toHaveBeenCalledWith('edit')
    const el2 = await draw(<ModeSwitch mode={{ value: 'edit', canEdit: true }} onChange={onChange} />)
    expect(el2.querySelector('[role=switch]')!.getAttribute('aria-checked')).toBe('true')
    await act(async () => (el2.querySelector('[role=switch]') as HTMLButtonElement).click())
    expect(onChange).toHaveBeenLastCalledWith('view')
  })

  it('shows "Read only" and no switch when the person cannot edit', async () => {
    const el = await draw(<ModeSwitch mode={{ value: 'view', canEdit: false }} onChange={() => {}} />)
    expect(el.querySelector('[role=switch]')).toBeNull()
    expect(el.textContent).toContain('Read only')
  })
})

describe('Presence', () => {
  it('shows up to three people, each labelled with the name', async () => {
    const el = await draw(<Presence people={[person(1), person(2), person(3)]} />)
    const imgs = [...el.querySelectorAll('[role=img]')]
    expect(imgs.map((i) => i.getAttribute('aria-label'))).toEqual(['Person 1', 'Person 2', 'Person 3'])
    expect(imgs.map((i) => i.getAttribute('title'))).toEqual(['Person 1', 'Person 2', 'Person 3'])
    expect(el.textContent).not.toContain('+')
  })

  it('more than three: three avatars and "+N" announced with the names', async () => {
    const el = await draw(<Presence people={[1, 2, 3, 4, 5].map((i) => person(i))} />)
    const imgs = [...el.querySelectorAll('[role=img]')]
    expect(imgs).toHaveLength(4)
    expect(imgs[3].textContent).toBe('+2')
    expect(imgs[3].getAttribute('aria-label')).toContain('Person 4, Person 5')
  })

  it('nothing when nobody is connected; markup in a name stays text', async () => {
    expect((await draw(<Presence people={[]} />)).innerHTML).toBe('')
    const el = await draw(<Presence people={[person(1, '<b>x</b>')]} />)
    expect(el.querySelector('b')).toBeNull()
  })
})

describe('CommentsButton', () => {
  it('reports its state with aria-expanded and calls onToggle', async () => {
    const onToggle = vi.fn()
    const el = await draw(<CommentsButton comments={{ open: false, count: 3, resource: null }} onToggle={onToggle} />)
    const b = el.querySelector('button')!
    expect(b.getAttribute('aria-expanded')).toBe('false')
    expect(b.textContent).toContain('Comments')
    expect(b.textContent).toContain('3')
    expect(b.hasAttribute('aria-controls')).toBe(false)
    await act(async () => b.click())
    expect(onToggle).toHaveBeenCalledOnce()
  })

  it('open: expanded, and it points at the panel only when the panel is on the page', async () => {
    const panel = document.createElement('div')
    panel.id = COMMENTS_PANEL_ID
    document.body.appendChild(panel)
    const el = await draw(<CommentsButton comments={{ open: true, count: 0, resource: null }} onToggle={() => {}} />)
    const b = el.querySelector('button')!
    expect(b.getAttribute('aria-expanded')).toBe('true')
    expect(b.getAttribute('aria-controls')).toBe(COMMENTS_PANEL_ID)
    expect(b.textContent).not.toContain('0')
    panel.remove()
  })
})
