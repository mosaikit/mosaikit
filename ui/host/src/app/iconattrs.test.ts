import { describe, expect, it } from 'vitest'
import { iconAttrs, iconImageOf } from './nav.tsx'

describe('illustrated icons of the apps', () => {
  it('the address comes from the manifest, with the version', () => {
    expect(iconImageOf({ id: 'com.x.notes', version: '1.2.3', icon_image: 'icon.webp' })).toMatch(/\/api\/plugins\/com\.x\.notes\/media\/icon\.webp\?v=1\.2\.3$/)
    expect(iconImageOf({ id: 'com.x.notes', version: '1.2.3', icon_image: null })).toBeUndefined()
  })
  it('an item with an image carries data-image and the variable; without one only data-icon', () => {
    const a = iconAttrs({ iconId: 'notebook-pen', iconImage: '/api/plugins/p/media/i.webp?v=1' })
    expect(a['data-icon']).toBe('notebook-pen')
    expect(a['data-image']).toBe('')
    expect((a.style as Record<string, string>)['--msk-icon-image']).toBe('url("/api/plugins/p/media/i.webp?v=1")')
    expect(iconAttrs({ iconId: 'folder' })).toEqual({ 'data-icon': 'folder' })
  })
})
