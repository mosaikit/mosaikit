import { describe, expect, it } from 'vitest'
import { releaseNotes, tourOf, TOURS } from './help.ts'
import { press, SEQUENCE_MS, typing, type ShortcutState } from './shortcuts.ts'
import { checks, contrast, fix, generate, themeCss } from './themegen.ts'

describe('theme generator', () => {
  it('computes every variable, light and dark, and the defaults read', () => {
    const t = generate({ accent: '#0f6e5c', bar: 'color', grays: 'neutral' })
    expect(Object.keys(t.light).length).toBeGreaterThan(35)
    expect(Object.keys(t.dark)).toEqual(Object.keys(t.light))
    expect(checks(t).every((c) => c.ok)).toBe(true)
    // the band in the main colour is darker than the accent, its text white
    expect(t.light['--band-foreground']).toBe('#ffffff')
    expect(contrast(t.light['--band'], '#ffffff')).toBeGreaterThan(4.5)
  })

  it('finds the colours that do not read and fixes them', () => {
    const pale = { accent: '#7fd6c2', bar: 'light' as const, grays: 'warm' as const }
    const bad = checks(generate(pale)).filter((c) => !c.ok)
    expect(bad.length).toBeGreaterThan(0)
    expect(bad.some((c) => c.fg === '--primary' && c.mode === 'light')).toBe(true)
    const fixed = fix(pale)
    expect(checks(generate(fixed)).every((c) => c.ok)).toBe(true)
    // the choices stay, only the advanced colours change
    expect([fixed.accent, fixed.bar, fixed.grays]).toEqual(['#7fd6c2', 'light', 'warm'])
    expect(fixed.adv?.accL).toBeTruthy()
  })

  it('writes CSS with colours only', () => {
    const css = themeCss('c-1a2b', { light: { '--primary': '#123456', '--evil': 'red;} body{display:none', 'bad name': '#fff' }, dark: { '--primary': 'rgba(1,2,3,0.5)' } })
    expect(css).toBe("[data-preset='c-1a2b']{--primary:#123456;}.dark[data-preset='c-1a2b']{--primary:rgba(1,2,3,0.5);}")
    expect(themeCss("x'];*{", { light: {}, dark: {} })).toContain("[data-preset='x']")
  })
})

describe('keyboard shortcuts', () => {
  const idle: ShortcutState = { pending: null, at: 0 }
  it('single keys and sequences', () => {
    expect(press(idle, '?', 0).action).toBe('help')
    expect(press(idle, '/', 0).action).toBe('search')
    const g = press(idle, 'g', 1000)
    expect(g.action).toBeNull()
    expect(press(g.state, 'h', 1500).action).toBe('home')
    expect(press(g.state, 'n', 1500).action).toBe('notifications')
    expect(press(g.state, 'A', 1500).action).toBe('account')
    // too late, or another key: nothing
    expect(press(g.state, 'h', 1000 + SEQUENCE_MS + 1).action).toBeNull()
    expect(press(g.state, 'x', 1500).action).toBeNull()
    // with Ctrl/Alt/Meta the keys belong to the browser or to the search (Ctrl K)
    expect(press(idle, '/', 0, { ctrl: true }).action).toBeNull()
  })

  it('never while typing', () => {
    const input = document.createElement('input')
    const div = document.createElement('div')
    div.setAttribute('contenteditable', 'true')
    const span = document.createElement('span')
    div.appendChild(span)
    expect(typing(input)).toBe(true)
    expect(typing(span)).toBe(true)
    expect(typing(document.body)).toBe(false)
  })
})

describe('help', () => {
  it('a tour for Home, Manage, Plugins and System', () => {
    expect(tourOf({ area: 'tenant', tenant: 'x', page: 'home' })).toBe('home')
    expect(tourOf({ area: 'tenant', tenant: 'x', page: 'manage' })).toBe('manage')
    expect(tourOf({ area: 'tenant', tenant: 'x', page: 'plugins' })).toBe('plugins')
    expect(tourOf({ area: 'admin', page: 'system' })).toBe('system')
    expect(tourOf({ area: 'tenant', tenant: 'x', page: 'usage' })).toBeNull()
    for (const id of ['home', 'manage', 'plugins', 'system']) expect(TOURS[id].length).toBeGreaterThan(1)
  })

  it('release notes of a version from the changelog', () => {
    const md = '# Changelog\n\n## 1.1.0\n\n- later\n\n## 1.0.0\n\n### The shell\n\n- one\n- two that\n  goes on\n\n### Work\n\n- three\n'
    expect(releaseNotes(md, '1.0.0')).toEqual([
      { group: 'The shell', items: ['one', 'two that goes on'] },
      { group: 'Work', items: ['three'] },
    ])
    expect(releaseNotes(md, '1.1.0')).toEqual([{ group: '', items: ['later'] }])
    expect(releaseNotes(md, '9.9.9')).toEqual([])
  })
})
