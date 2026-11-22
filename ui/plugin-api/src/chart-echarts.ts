// The Apache ECharts part of `chart()`: only line, bar and pie, grid, tooltip and legend, canvas renderer. This file is
// loaded by a dynamic `import()` from chart.ts, so a plugin that never draws a chart never downloads it.
import { BarChart, LineChart, PieChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import { init, use as register, type ECharts, type EChartsCoreOption } from 'echarts/core'
import { LegacyGridContainLabel } from 'echarts/features'
import { CanvasRenderer } from 'echarts/renderers'

register([LegacyGridContainLabel, LineChart, BarChart, PieChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer])

export type { ECharts, EChartsCoreOption }
export { init }
