import { describe, expect, it } from 'vitest'
import { alertDetailText } from './notes.ts'

// the kernel words the detail of an alert in English; the shell turns the known ones into the language of the person
describe('alertDetailText', () => {
  it('keeps the English text in English and the unknown ones as they are', () => {
    expect(alertDetailText('7.3% of the disk free')).toBe('7.3% of the disk free')
    expect(alertDetailText('12.5% of the requests failed in 15 minutes')).toBe('12.5% of the requests failed in 15 minutes')
    expect(alertDetailText('3 emails failed in the last hour')).toBe('3 emails failed in the last hour')
    expect(alertDetailText('the last backup failed: disk full\nretry')).toBe('the last backup failed: disk full\nretry')
    expect(alertDetailText('something else')).toBe('something else')
  })
})
