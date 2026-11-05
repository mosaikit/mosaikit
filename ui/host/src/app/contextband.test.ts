import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OpError } from '../bridge.ts'
import { backFromActiveEntry, bandEmit, cleanText, currentBand, initialsOf, resetBand, sanitizeBand, setBand } from './contextband.ts'
import { contrast } from './themegen.ts'

const bad = (x: unknown) => expect(() => sanitizeBand(x)).toThrow(OpError)

describe('sanitizeBand', () => {
  it('accepts the full state', () => {
    const v = sanitizeBand({ search: false, mode: { value: 'edit', canEdit: true }, presence: [{ id: 'a', name: 'Ada Lovelace' }, { id: 'b', name: 'Bo', initials: 'xy' }], comments: { open: true, count: 4 } })
    expect(v).toEqual({
      hideSearch: true,
      mode: { value: 'edit', canEdit: true },
      presence: [
        { id: 'a', name: 'Ada Lovelace', initials: 'AL' },
        { id: 'b', name: 'Bo', initials: 'xy' },
      ],
      comments: { open: true, count: 4, resource: null },
      back: null,
    })
  })

  it('a resource id hands the comments to the shell; a wrong id is refused', () => {
    const id = '0F8A4C1E-7B2D-4E55-9A3C-1D2E3F4A5B6C'
    expect(sanitizeBand({ comments: { resource: id } }).comments).toEqual({ open: false, count: null, resource: id.toLowerCase() })
    for (const resource of ['x', 5, '../etc', `${id}0`]) expect(() => sanitizeBand({ comments: { resource } })).toThrow()
    // without a resource the page still says whether the panel is open
    expect(() => sanitizeBand({ comments: {} })).toThrow()
  })

  it('an empty state leaves everything as the shell draws it', () => {
    expect(sanitizeBand({})).toEqual({ hideSearch: false, mode: null, presence: [], comments: null, back: null })
    expect(sanitizeBand(undefined).hideSearch).toBe(false)
    // `search: true` never adds anything
    expect(sanitizeBand({ search: true }).hideSearch).toBe(false)
  })

  it('refuses wrong types', () => {
    const wrong = ['x', 3, [], { search: 'no' }, { mode: 'edit' }, { mode: { value: 'x', canEdit: true } }, { mode: { value: 'view' } }, { presence: 'a' }, { presence: [1] }, { presence: [{ id: 'a' }] }, { presence: [{ id: 'a', name: 5 }] }, { comments: { count: 1 } }, { comments: { open: 'y' } }, { comments: { open: true, count: 1.5 } }, { comments: { open: true, count: -1 } }, { comments: { open: true, count: '3' } }, { comments: { open: true, count: NaN } }]
    for (const x of wrong) bad(x)
  })

  it('cuts names to 80 and initials to 3 characters, and the list to 50 people', () => {
    const v = sanitizeBand({ presence: Array.from({ length: 60 }, (_, i) => ({ id: `p${i}`, name: 'n'.repeat(200), initials: 'ABCDE' })) })
    expect(v.presence).toHaveLength(50)
    expect(v.presence[0].name).toHaveLength(80)
    expect(v.presence[0].initials).toBe('ABC')
  })

  it('clamps the count to 9999', () => {
    expect(sanitizeBand({ comments: { open: false, count: 123456 } }).comments?.count).toBe(9999)
    expect(sanitizeBand({ comments: { open: false, count: 0 } }).comments?.count).toBe(0)
    expect(sanitizeBand({ comments: { open: false } }).comments?.count).toBeNull()
  })

  it('a person who cannot edit is never shown in edit mode', () => {
    expect(sanitizeBand({ mode: { value: 'edit', canEdit: false } }).mode).toEqual({ value: 'view', canEdit: false })
  })

  it('keeps plain text: markup stays text, control and bidi characters go, duplicates and empties are dropped', () => {
    const v = sanitizeBand({ presence: [{ id: 'a', name: '<img src=x onerror=1>‮\n evil' }, { id: 'a', name: 'dup' }, { id: ' ', name: 'x' }, { id: 'c', name: '  ' }] })
    expect(v.presence).toHaveLength(1)
    expect(v.presence[0].name).toBe('<img src=x onerror=1> evil')
    expect(cleanText('a\u0000b‮c', 10, 't')).toBe('a b c')
    expect(cleanText('\u{1F600}\u{1F600}\u{1F600}\u{1F600}', 2, 't')).toBe('\u{1F600}\u{1F600}')
  })

  it('derives initials from the name', () => {
    expect(initialsOf('ada lovelace')).toBe('AL')
    expect(initialsOf('Plato')).toBe('P')
    expect(initialsOf('Mary Jane Watson')).toBe('MW')
  })
})

describe('the back button', () => {
  it('keeps plain text, cut to 80 characters, and refuses a wrong or empty label', () => {
    expect(sanitizeBand({ back: { label: '  <b>Sites</b>\n list ' } }).back).toEqual({ label: '<b>Sites</b> list' })
    expect(sanitizeBand({ back: { label: 'x'.repeat(200) } }).back?.label).toHaveLength(80)
    expect(sanitizeBand({}).back).toBeNull()
    expect(sanitizeBand({ back: null }).back).toBeNull()
    expect(() => sanitizeBand({ back: { label: 3 } })).toThrow('invalid band')
    expect(() => sanitizeBand({ back: { label: '  ' } })).toThrow('invalid band')
    expect(() => sanitizeBand({ back: 'x' })).toThrow('invalid band')
  })
})

describe('the state of the band', () => {
  beforeEach(() => resetBand())

  it('a click on the entry of the open detail page does what the back button does', () => {
    const emit = vi.fn()
    expect(backFromActiveEntry(true)).toBe(false) // no band: the entry navigates as usual
    setBand('frame-1', sanitizeBand({ back: { label: 'Dashboards' } }), emit)
    expect(backFromActiveEntry(false)).toBe(false) // an entry of another page
    expect(emit).not.toHaveBeenCalled()
    expect(backFromActiveEntry(true)).toBe(true)
    expect(emit).toHaveBeenCalledWith('band.back', {})
    setBand('frame-1', sanitizeBand({}), emit) // a list page has no back button
    expect(backFromActiveEntry(true)).toBe(false)
  })

  it('only the owner resets it; the shell resets it for everybody', () => {
    const emit = vi.fn()
    setBand('frame-1', sanitizeBand({ search: false }), emit)
    expect(currentBand()?.hideSearch).toBe(true)
    resetBand('frame-2')
    expect(currentBand()).not.toBeNull()
    resetBand('frame-1')
    expect(currentBand()).toBeNull()
    setBand('frame-1', sanitizeBand({}), emit)
    resetBand()
    expect(currentBand()).toBeNull()
  })

  it('the events go back to the frame that owns the band, and nowhere after the reset', () => {
    const emit = vi.fn()
    setBand('f', sanitizeBand({}), emit)
    bandEmit('band.mode', { value: 'edit' })
    expect(emit).toHaveBeenCalledWith('band.mode', { value: 'edit' })
    resetBand()
    bandEmit('band.back', {})
    expect(emit).toHaveBeenCalledOnce()
  })
})

describe('contrast of the band controls', () => {
  // the switch, the avatars and the badge draw the band colour on band-foreground (white in every theme)
  const css = readFileSync(resolve(__dirname, 'index.css'), 'utf8')
  const bands = [...css.matchAll(/--band:\s*(#[0-9a-f]{6})/gi)].map((m) => m[1])
  it('finds the bands of the themes', () => expect(bands.length).toBeGreaterThanOrEqual(6))
  it('band on white is at least 4.5:1 in every theme', () => {
    for (const b of bands) expect(contrast(b, '#ffffff'), b).toBeGreaterThanOrEqual(4.5)
  })
})
