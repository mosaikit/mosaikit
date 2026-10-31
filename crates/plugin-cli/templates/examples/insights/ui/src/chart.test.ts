import { describe, expect, it } from 'vitest'
import { bars } from './chart.ts'
import { texts } from './i18n.ts'

describe('bars', () => {
  it('has no bar without data', () => {
    expect(bars([], 480, 240)).toEqual([])
  })

  it('makes the tallest bar as high as the chart and the others in proportion', () => {
    const b = bars(
      [
        { category: 'food', total: 100, items: 2 },
        { category: 'home', total: 50, items: 1 },
      ],
      480,
      240,
    )
    expect(b[0]!.height).toBe(192)
    expect(b[1]!.height).toBe(96)
    // the bars stand on the same line
    expect(b[0]!.y + b[0]!.height).toBe(b[1]!.y + b[1]!.height)
  })

  it('does not divide by zero when everything is zero', () => {
    expect(bars([{ category: 'food', total: 0, items: 1 }], 480, 240)[0]!.height).toBe(0)
  })
})

describe('texts', () => {
  it('have the categories in every language of the plugin', () => {
    expect(texts('it').food).toBe('Cibo')
    expect(texts('xx').food).toBe('Food')
  })
})
