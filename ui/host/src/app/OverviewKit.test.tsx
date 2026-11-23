import { describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { KpiCard, Spark, WeekStrip } from './OverviewKit.tsx'
import { perDay } from './overviewdata.ts'

function render(node: React.ReactNode): string {
  const box = document.createElement('div')
  document.body.appendChild(box)
  const root = createRoot(box)
  act(() => root.render(node))
  const html = box.innerHTML
  act(() => root.unmount())
  box.remove()
  return html
}

describe('overview kit', () => {
  it('counts the stamps of the last seven days, oldest first', () => {
    const now = new Date(2026, 10, 23, 15, 0, 0)
    const stamps = [new Date(2026, 10, 23, 9).toISOString(), new Date(2026, 10, 23, 10).toISOString(), new Date(2026, 10, 21, 10).toISOString(), new Date(2026, 9, 1).toISOString()]
    expect(perDay(stamps, now)).toEqual([0, 0, 0, 0, 1, 0, 2])
  })

  it('a sparkline of one point or none is a flat line, not an error', () => {
    expect(render(<Spark values={[]} label="x" />)).toContain('M0 29')
    expect(render(<Spark values={[3]} label="x" />)).toContain('M0 29')
    expect(render(<Spark values={[1, 4, 2]} label="x" />)).toContain('stroke="currentColor"')
  })

  it('a KPI card shows its figure, its caption and a labelled sparkline', () => {
    const html = render(<KpiCard label="Members" value={12} hint="3 guests" values={[1, 2, 3]} trend="per day" accent="sky" />)
    expect(html).toContain('Members')
    expect(html).toContain('12')
    expect(html).toContain('aria-label="Members: per day"')
    expect(html).toContain('var(--ov-sky)')
  })

  it('the week strip has seven days with today marked, late items counted apart, and an empty state', () => {
    const now = new Date(2026, 10, 23, 12, 0, 0)
    const due = [
      { resource_id: 'a', plugin_id: 'tasks', plugin: 'Tasks', title: 'Pay', at: '2026-11-25T08:00:00Z' },
      { resource_id: 'b', plugin_id: 'tasks', plugin: 'Tasks', title: 'Old', at: '2026-11-20T08:00:00Z' },
    ]
    const html = render(<WeekStrip slug="rome" due={due} now={now} />)
    expect((html.match(/<li /g) ?? []).length).toBeGreaterThanOrEqual(7)
    expect(html).toContain('aria-current="date"')
    expect(html).toContain('1 item late')
    expect(html).toContain('Pay')
    expect(render(<WeekStrip slug="rome" due={[]} now={now} />)).toContain('empty-compact')
  })
})
