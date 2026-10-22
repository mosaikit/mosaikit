import { describe, expect, it } from 'vitest'
import { ApiError, errText } from '../api.ts'
import { setLang } from './i18n.ts'
import { noteTitle, type Note } from './notes.ts'

function alert(level: string, extra: Record<string, unknown> = {}): Note {
  return {
    id: '1',
    kind: 'system',
    title: 'English title',
    body: '',
    link: '#/t/alfa/usage',
    source: 'kernel',
    tenant_slug: 'alfa',
    tenant_name: 'Alfa',
    resource_id: null,
    data: { code: 'quota.alert', metric: 'storage', level, percent: 85, days: 12, tenant: 'Alfa', ...extra },
    read: false,
    created_at: '2026-10-22T10:00:00Z',
  }
}

describe('quotas', () => {
  it('alerts of the quotas in the language of the person', () => {
    setLang('en')
    expect(noteTitle(alert('80'))).toBe('Storage of Alfa: 85% of the quota')
    expect(noteTitle(alert('100'))).toBe('Storage of Alfa: the quota is used up, additions stop')
    expect(noteTitle(alert('forecast'))).toBe('Storage of Alfa: at this pace the quota is used up in about 12 days')
    setLang('it')
    expect(noteTitle(alert('80'))).toBe('Spazio di Alfa: 85% della quota')
    setLang('en')
  })
  it('a refusal at the limit is translated from its code', () => {
    setLang('it')
    expect(errText(new ApiError('the items quota of the tenant is used up', 409, 'quota_exceeded'))).toContain('quote')
    setLang('en')
    expect(errText(new ApiError('the items quota of the tenant is used up', 409, 'quota_exceeded'))).toContain('quotas')
  })
})
