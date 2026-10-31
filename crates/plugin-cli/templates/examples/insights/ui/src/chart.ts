// STEP 6 - the chart. No chart library: a bar chart is a few rectangles, and a plugin UI loads no code from
// outside (its CSP forbids it). The geometry is a pure function, so it is tested without a browser;
// `barChart` only turns it into SVG.

export interface Total {
  category: string
  total: number
  items: number
}

export interface Bar {
  category: string
  value: number
  x: number
  y: number
  width: number
  height: number
}

/** The bars of a chart `width` x `height` (with `pad` free around it), the tallest as high as the chart. */
export function bars(data: Total[], width: number, height: number, pad = 24): Bar[] {
  if (!data.length) return []
  const max = Math.max(...data.map((d) => d.total), 0)
  const slot = (width - 2 * pad) / data.length
  const inner = height - 2 * pad
  return data.map((d, i) => {
    const h = max > 0 ? (Math.max(d.total, 0) / max) * inner : 0
    return { category: d.category, value: d.total, x: pad + i * slot + slot * 0.15, y: height - pad - h, width: slot * 0.7, height: h }
  })
}

const NS = 'http://www.w3.org/2000/svg'

function svgEl(tag: string, attrs: Record<string, string | number>, text?: string): SVGElement {
  const e = document.createElementNS(NS, tag)
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v))
  if (text !== undefined) e.textContent = text
  return e as SVGElement
}

/** A bar chart as an SVG; `label` gives the text under a bar (the category in the language of the person). */
export function barChart(data: Total[], label: (category: string) => string, name: string): SVGElement {
  const W = 480
  const H = 240
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': name, class: 'chart' })
  for (const b of bars(data, W, H)) {
    const bar = svgEl('rect', { x: b.x, y: b.y, width: b.width, height: b.height, rx: 4, fill: 'var(--acc)' })
    bar.append(svgEl('title', {}, `${label(b.category)}: ${b.value}`))
    svg.append(
      bar,
      svgEl('text', { x: b.x + b.width / 2, y: b.y - 6, 'text-anchor': 'middle', 'font-size': 12, fill: 'currentColor' }, String(Math.round(b.value))),
      svgEl('text', { x: b.x + b.width / 2, y: H - 8, 'text-anchor': 'middle', 'font-size': 12, fill: 'currentColor' }, label(b.category)),
    )
  }
  return svg
}
