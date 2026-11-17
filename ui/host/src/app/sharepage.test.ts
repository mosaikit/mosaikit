import { describe, expect, it } from 'vitest'
import { resolveSharePage } from './sharepage.ts'
import type { PluginView } from '../types.ts'

const p = (id: string, extra: Partial<PluginView> = {}) => ({ id, has_ui: true, ...extra }) as PluginView

describe('the page that replaces the share dialog', () => {
  const rid = '11111111-2222-3333-4444-555555555555'

  it('is none when the app declares nothing', () => {
    expect(resolveSharePage([p('com.a.files')], 'com.a.files', rid)).toBeNull()
    expect(resolveSharePage([], 'com.a.files', rid)).toBeNull()
  })

  it('is a place of the app itself', () => {
    const r = resolveSharePage([p('com.a.maps', { share_page: 'sharing' })], 'com.a.maps', rid)
    expect(r).toEqual({ plugin: 'com.a.maps', at: `sharing?resource=${rid}` })
  })

  it('is a place of another app, and keeps a query that the place has', () => {
    const plugins = [p('com.a.files', { share_page: 'com.b.geo/sharing?tab=people' }), p('com.b.geo')]
    expect(resolveSharePage(plugins, 'com.a.files', rid)).toEqual({ plugin: 'com.b.geo', at: `sharing?tab=people&resource=${rid}` })
  })

  it('falls back to the dialog when the page is of an app that is not there or has no UI', () => {
    expect(resolveSharePage([p('com.a.files', { share_page: 'com.b.geo/sharing' })], 'com.a.files', rid)).toBeNull()
    expect(resolveSharePage([p('com.a.files', { share_page: 'com.b.geo/sharing' }), p('com.b.geo', { has_ui: false })], 'com.a.files', rid)).toBeNull()
  })

  it('treats a slash that is not an app id as part of the place', () => {
    const r = resolveSharePage([p('com.a.maps', { share_page: 'tabs/sharing' })], 'com.a.maps', rid)
    expect(r).toEqual({ plugin: 'com.a.maps', at: `tabs/sharing?resource=${rid}` })
  })
})
