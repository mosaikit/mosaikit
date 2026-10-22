// Il simbolo di Mosaikit (docs/logo): nove tessere, quella in alto a destra sollevata in giallo fuori dal
// suo posto tratteggiato, un plugin che entra. Positivo (tessere bordeaux) sulle superfici chiare,
// negativo (tessere crema) su quelle scure: la barra in alto e il pannello dell'accesso, sempre scuri,
// usano il negativo. I colori sono quelli del marchio, non del tema. Un logo del marchio (brand.toml)
// prende il posto del simbolo, anche nella favicon.

import { useEffect } from 'react'
import { useBrand } from '../brand.ts'

export type MarkVariant = 'positive' | 'negative'

/** La parte dei disegni da 512 di docs/logo che contiene il simbolo. */
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

/** Il simbolo in SVG; `slot` false toglie il posto tratteggiato (a 16 px diventa una macchia). */
export function markSvg(variant: MarkVariant, slot = true): string {
  const tiles = AT.map(([x, y], i) => `<rect x="${x}" y="${y}" width="104" height="104" rx="14" fill="${TILES[variant][i]}"/>`).join('')
  const dashed = slot ? '<rect x="326" y="82" width="104" height="104" rx="14" fill="none" stroke="#C9707C" stroke-width="5" stroke-dasharray="14 10"/>' : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VIEW}">${tiles}${dashed}<rect x="352" y="56" width="104" height="104" rx="14" fill="#F0B23A"/></svg>`
}

/** La favicon: il simbolo positivo, o il logo del marchio. */
export function useFavicon() {
  const brand = useBrand()
  useEffect(() => {
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    if (!link) {
      link = document.createElement('link')
      link.rel = 'icon'
      document.head.appendChild(link)
    }
    if (brand.logo) {
      link.type = ''
      link.href = 'brand/logo'
    } else {
      link.type = 'image/svg+xml'
      link.href = `data:image/svg+xml,${encodeURIComponent(markSvg('positive', false))}`
    }
  }, [brand.logo])
}
