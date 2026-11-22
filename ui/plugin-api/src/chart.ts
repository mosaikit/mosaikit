// Charts for plugins: line, bar and pie on Apache ECharts (Apache-2.0), tree-shaken (chart-echarts.ts) and loaded on the
// first call, so a plugin that does not chart pays nothing. The look follows the host: colours come from the CSS
// tokens (`--fg`, `--dim`, `--line`, `--panel`, `--acc`, optional `--chart-1..8`), light or dark, re-read when the
// host changes theme. The chart is a `role="img"` with a name, and the same numbers are in a data table
// («Show data») for screen readers and for people who prefer numbers. Motion respects `prefers-reduced-motion`.
import { h } from './dom.ts'

export type ChartType = 'line' | 'bar' | 'pie'

export interface ChartSeries {
  name: string
  /** one value per category (line, bar) */
  data: number[]
}

export interface ChartSpec {
  type: ChartType
  /** accessible name and caption: «Tasks closed per week» */
  label: string
  /** x axis (line, bar) or slice names (pie) */
  categories: string[]
  /** line and bar: one entry per line or bar group; pie: the first series gives the slices */
  series: ChartSeries[]
  /** bars on top of each other */
  stacked?: boolean
  /** a smooth line with a soft area under it (line only, default true) */
  area?: boolean
  /** formats a value in the tooltip and in the data table (`Intl.NumberFormat` of the page by default) */
  format?: (v: number) => string
  /** height in px (240) */
  height?: number
}

export interface ChartLabels {
  /** the toggle that shows the data table: «Show data» */
  data?: string
  /** the first column header of the table when the categories have no name */
  category?: string
  /** shown while the chart code loads and when it cannot */
  loading?: string
  failed?: string
}

export interface Chart {
  /** the element to put in the page */
  el: HTMLElement
  /** draws the chart again with another spec (new data, another type) */
  update: (spec: ChartSpec) => void
  /** resolves when the chart is drawn (or when it fell back to the table only) */
  ready: Promise<void>
  destroy: () => void
}

type Echarts = typeof import('./chart-echarts.ts')
let loader: Promise<Echarts> | null = null
const load = (): Promise<Echarts> => (loader ??= import('./chart-echarts.ts'))

const css = (name: string, fallback: string): string => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback

/** The categorical colours: `--chart-1..8` if the host defines them, else the accent first and fixed hues that stay apart in both themes. */
export function chartPalette(): string[] {
  const base = ['#4f8cf0', '#5cb887', '#e0615c', '#a77bd8', '#38b6c4', '#e08a4b', '#d46fa8', '#8c9aa8']
  const own = base.map((_, i) => css(`--chart-${i + 1}`, ''))
  const acc = css('--acc', '#f0b23e')
  return own.every(Boolean) ? own : [acc, ...base.filter((c) => c.toLowerCase() !== acc.toLowerCase())].slice(0, 8)
}

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** The ECharts option of a spec in the colours of the page now. Exported for tests. */
export function chartOption(spec: ChartSpec, fmt: (v: number) => string): Record<string, unknown> {
  const fg = css('--fg', '#ece7db')
  const dim = css('--dim', '#8f887a')
  const line = css('--line', '#2a2e37')
  const panel = css('--panel', '#14161b')
  const font = css('--font-ui', 'system-ui, sans-serif')
  const colors = chartPalette()
  const text = { color: dim, fontFamily: font, fontSize: 12 }
  const common = {
    color: colors,
    animation: !reduced(),
    animationDuration: 420,
    animationEasing: 'cubicOut',
    textStyle: { fontFamily: font },
    tooltip: {
      trigger: spec.type === 'pie' ? 'item' : 'axis',
      confine: true,
      backgroundColor: panel,
      borderColor: line,
      borderWidth: 1,
      padding: [8, 12],
      textStyle: { color: fg, fontFamily: font, fontSize: 12 },
      extraCssText: 'border-radius:10px;box-shadow:0 4px 14px rgba(0,0,0,.22);',
      valueFormatter: (v: unknown) => (typeof v === 'number' ? fmt(v) : String(v)),
    },
    legend: spec.series.length > 1 || spec.type === 'pie' ? { bottom: 0, icon: 'circle', itemWidth: 8, itemHeight: 8, itemGap: 16, textStyle: text } : { show: false },
  }
  if (spec.type === 'pie') {
    const s = spec.series[0]
    return {
      ...common,
      series: [
        {
          type: 'pie',
          radius: ['52%', '74%'],
          center: ['50%', '45%'],
          padAngle: 2,
          itemStyle: { borderRadius: 6, borderColor: panel, borderWidth: 2 },
          label: { show: false },
          emphasis: { scaleSize: 6, label: { show: true, color: fg, fontWeight: 600, formatter: '{b}\n{d}%' } },
          data: spec.categories.map((name, i) => ({ name, value: s?.data[i] ?? 0 })),
        },
      ],
    }
  }
  const smooth = spec.type === 'line'
  return {
    ...common,
    grid: { left: 8, right: 16, top: 16, bottom: spec.series.length > 1 ? 36 : 8, containLabel: true },
    xAxis: {
      type: 'category',
      data: spec.categories,
      boundaryGap: spec.type === 'bar',
      axisLine: { lineStyle: { color: line } },
      axisTick: { show: false },
      axisLabel: text,
    },
    yAxis: { type: 'value', axisLabel: { ...text, formatter: (v: number) => fmt(v) }, splitLine: { lineStyle: { color: line, type: 'dashed' } } },
    series: spec.series.map((s, i) => ({
      type: spec.type,
      name: s.name,
      data: s.data,
      stack: spec.stacked ? 'total' : undefined,
      smooth,
      symbol: 'circle',
      symbolSize: 6,
      showSymbol: spec.categories.length <= 24,
      lineStyle: { width: 2.5 },
      areaStyle: spec.type === 'line' && spec.area !== false ? { opacity: 0.12 } : undefined,
      itemStyle: spec.type === 'bar' ? { borderRadius: spec.stacked ? 0 : [5, 5, 0, 0] } : undefined,
      barMaxWidth: 36,
      emphasis: { focus: 'series' },
      z: 10 - i,
    })),
  }
}

/** The numbers of the spec as a table: categories down, one column per series. */
function table(spec: ChartSpec, fmt: (v: number) => string, labels: Required<ChartLabels>): HTMLTableElement {
  const t = h('table', { class: 'msk-chart-table' })
  t.append(h('caption', { class: 'msk-sr' }, spec.label))
  const head = h('tr', {}, h('th', { scope: 'col' }, labels.category))
  const cols = spec.type === 'pie' ? spec.series.slice(0, 1) : spec.series
  for (const s of cols) head.append(h('th', { scope: 'col' }, s.name))
  t.append(h('thead', {}, head))
  const body = h('tbody')
  spec.categories.forEach((c, i) => {
    const tr = h('tr', {}, h('th', { scope: 'row' }, c))
    for (const s of cols) tr.append(h('td', {}, s.data[i] === undefined ? '' : fmt(s.data[i]!)))
    body.append(tr)
  })
  t.append(body)
  return t
}

/**
 * A chart in a box. Put `el` in the page; it draws when the code is loaded and the box has a size, follows the box when
 * it resizes (side panel, window), and the theme when the host changes it.
 */
export function chart(initial: ChartSpec, labels: ChartLabels = {}): Chart {
  const L: Required<ChartLabels> = { data: 'Show data', category: '', loading: 'Loading chart', failed: 'The chart could not be drawn', ...labels }
  let spec = initial
  let fmt = initial.format ?? new Intl.NumberFormat(document.documentElement.lang || undefined).format
  const canvas = h('div', { class: 'msk-chart-canvas', role: 'img' })
  const status = h('div', { class: 'msk-chart-status', role: 'status' }, L.loading)
  const details = h('details', { class: 'msk-chart-data' }, h('summary', {}, L.data))
  const el = h('figure', { class: 'msk-chart' }, canvas, status, details)
  let instance: import('./chart-echarts.ts').ECharts | null = null
  let ro: ResizeObserver | null = null
  let mo: MutationObserver | null = null
  let mq: MediaQueryList | null = null
  let onTheme: (() => void) | null = null
  let dead = false

  const describe = () => {
    canvas.style.height = `${spec.height ?? 240}px`
    canvas.setAttribute('aria-label', spec.label)
    details.querySelector('table')?.remove()
    details.append(table(spec, fmt, L))
  }
  const draw = () => {
    if (!instance) return
    try {
      instance.setOption(chartOption(spec, fmt) as never, { notMerge: true })
    } catch {
      status.textContent = L.failed
      details.open = true
    }
  }

  const ready = (async () => {
    describe()
    try {
      const e = await load()
      if (dead) return
      instance = e.init(canvas, undefined, { renderer: 'canvas' })
      draw()
      status.remove()
      if (typeof ResizeObserver === 'function') {
        ro = new ResizeObserver(() => instance?.resize())
        ro.observe(el)
      }
      // the host changes theme through attributes of <html> (data-mode, data-preset, class); the OS can change too
      const redraw = () => requestAnimationFrame(draw)
      mo = new MutationObserver(redraw)
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-mode', 'data-preset', 'data-theme', 'class', 'style'] })
      mq = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null
      onTheme = redraw
      mq?.addEventListener?.('change', redraw)
    } catch {
      status.textContent = L.failed
      // the table stays: the numbers are never lost
      details.open = true
    }
  })()

  return {
    el,
    ready,
    update(next) {
      spec = next
      fmt = next.format ?? fmt
      describe()
      draw()
    },
    destroy() {
      dead = true
      ro?.disconnect()
      mo?.disconnect()
      if (onTheme) mq?.removeEventListener?.('change', onTheme)
      try {
        instance?.dispose()
      } catch {
        // a canvas that is already gone
      }
      instance = null
      el.remove()
    },
  }
}
