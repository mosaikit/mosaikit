import { describe, expect, it } from 'vitest'
import { csvFields, parseCsv } from './csv.ts'
import { checks, contrast, generate, selectedBg } from './themegen.ts'

describe('import of people from CSV', () => {
  it('reads commas or semicolons, quotes, roles and groups, and says what is wrong per row', () => {
    expect(csvFields('a,"b, c","d ""e"""', ',')).toEqual(['a', 'b, c', 'd "e"'])
    const rows = parseCsv('username;name;email;role;groups\nCarla;Carla Neri;carla@example.org;Tenant Manager;staff|field\ncarla;Again;;user;\nx y;Bad;;;\ndino;Dino;not-an-email;;')
    expect(rows.map((r) => r.username)).toEqual(['carla', 'carla', 'x y', 'dino'])
    expect(rows[0]).toMatchObject({ display_name: 'Carla Neri', role: 'tenant_manager', groups: ['staff', 'field'] })
    expect(rows[0].problem).toBeUndefined()
    expect(rows.slice(1).every((r) => r.problem)).toBe(true)
  })
})

describe('selected item of a list', () => {
  it('is checked in every generated theme, light and dark, and passes AA', () => {
    for (const accent of ['#5b5fc7', '#a8293a', '#0066cc', '#e3a634']) {
      const t = generate({ accent, bar: 'color', grays: 'neutral' })
      const c = checks(t).filter((x) => x.label === 'Selected item of a list')
      expect(c).toHaveLength(2)
      expect(c.every((x) => x.ok)).toBe(true)
      expect(contrast(t.dark['--primary-strong'], selectedBg(t.dark['--pane'], t.dark['--primary']))).toBeGreaterThanOrEqual(4.5)
    }
  })
})
