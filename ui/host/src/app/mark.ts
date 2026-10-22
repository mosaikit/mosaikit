// The symbol of Mosaikit (docs/logo): nine tiles, the one at the top right lifted in yellow out of its
// dashed place, a plugin going in. Positive (burgundy tiles) on light surfaces, negative (cream tiles)
// on dark ones: the top bar and the sign-in panel, always dark, use the negative. The colours are the
// ones of the brand, not of the theme. A brand logo (brand.toml) takes the place of the symbol, in the
// favicon too.

import { useEffect } from 'react'
import { useBrand } from '../brand.ts'

export type MarkVariant = 'positive' | 'negative'

/** The part of the 512 drawings of docs/logo that holds the symbol. */
const VIEW = '70 44 398 398'
const TILES: Record<MarkVariant, string[]> = {
  positive: ['#8A1C2B', '#A8293A', '#6E1522', '#8A1C2B', '#A8293A', '#6E1522', '#8A1C2B', '#A8293A'],
  negative: ['#F3EDE2', '#E8DFCE', '#DDD2BD', '#EDE5D6', '#E2D8C4', '#F1EADD', '#DFD5C1', '#EAE2D2'],
}
const AT = [
  [82, 82],
  [204, 82],
  [82, 204],
  [204, 204],
  [326, 204],
  [82, 326],
  [204, 326],
  [326, 326],
]

/** The symbol in SVG; `slot` false removes the dashed place (at 16 px it becomes a blot). */
export function markSvg(variant: MarkVariant, slot = true): string {
  const tiles = AT.map(([x, y], i) => `<rect x="${x}" y="${y}" width="104" height="104" rx="14" fill="${TILES[variant][i]}"/>`).join('')
  const dashed = slot ? '<rect x="326" y="82" width="104" height="104" rx="14" fill="none" stroke="#C9707C" stroke-width="5" stroke-dasharray="14 10"/>' : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VIEW}">${tiles}${dashed}<rect x="352" y="56" width="104" height="104" rx="14" fill="#F0B23A"/></svg>`
}

/** The favicon: the browser icon of the platform, its logo, or the positive symbol. */
export function useFavicon() {
  const brand = useBrand()
  useEffect(() => {
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    if (!link) {
      link = document.createElement('link')
      link.rel = 'icon'
      document.head.appendChild(link)
    }
    if (brand.icon || brand.logo) {
      // the browser icon of the platform (System › Identity and texts, brand.toml), otherwise its logo
      link.type = ''
      link.href = brand.icon ? 'brand/favicon' : 'brand/logo'
    } else {
      link.type = 'image/svg+xml'
      link.href = `data:image/svg+xml,${encodeURIComponent(markSvg('positive', false))}`
    }
  }, [brand.logo, brand.icon])
}
