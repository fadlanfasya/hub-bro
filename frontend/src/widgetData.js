/**
 * Pure data-shaping helpers used by WidgetRenderer.
 *
 * Kept free of React and recharts so they can be unit tested directly —
 * these are the parts where a bug silently produces a wrong-looking chart.
 */

import { resolveRange } from './timeRange'

/**
 * Translate a widget's saved options into the payload the /data/fetch API expects.
 * `dashboardRange` is the toolbar range key; widgets opted into it inherit it.
 */
export function buildOptions(widget, dashboardRange, crossFilters) {
  const o = widget?.options || {}
  const opts = {}
  if (crossFilters?.length) opts.cross_filters = crossFilters

  if (o.data_path) opts.data_path = o.data_path
  if (o.rename) opts.rename = o.rename
  if (o.query) opts.query = o.query
  if (o.itemtype) opts.itemtype = o.itemtype
  if (o.max_rows) opts.max_rows = o.max_rows

  // transforms, applied server-side after the fetch
  if (o.unpivot?.columns?.length) opts.unpivot = o.unpivot
  // date_diff runs before filters server-side, so a filter can reference the
  // column it produces
  if (o.date_diff?.length) opts.date_diff = o.date_diff.filter((d) => d?.column)
  if (o.filters?.length) opts.filters = o.filters
  if (o.group_by) {
    opts.group_by = o.group_by
    if (o.aggregate) opts.aggregate = o.aggregate
    if (o.value_column) opts.value_column = o.value_column
  }
  if (o.sort?.column) opts.sort = o.sort
  if (o.limit) opts.limit = o.limit

  const range = resolveRange(widget, dashboardRange)
  if (range) opts.range = range

  return opts
}

/**
 * Pivot Prometheus-style {time, series, value} rows into one row per timestamp
 * with a column per series, so multi-series charts line up on a shared X axis.
 */
export function pivotSeries(rows) {
  if (!rows?.length) return { rows: [], seriesNames: [] }
  if (!rows.some((r) => 'series' in r)) return { rows, seriesNames: [] }

  const seriesNames = [...new Set(rows.map((r) => r.series))]
  const byTime = new Map()
  for (const r of rows) {
    if (!byTime.has(r.time)) byTime.set(r.time, { time: r.time })
    byTime.get(r.time)[r.series] = r.value
  }
  return { rows: [...byTime.values()], seriesNames }
}

/** Reduce rows to the single number a stat widget shows. */
export function computeStat(rows, columns, opts = {}) {
  const field = opts.value_field
    || columns.find((c) => typeof rows[0]?.[c] === 'number')
    || columns[0]

  if (!rows.length) return { field, value: '—' }

  const nums = rows.map((r) => r[field]).filter((v) => typeof v === 'number')
  const agg = opts.aggregate || 'last'

  let value
  if (agg === 'count') value = rows.length
  else if (agg === 'sum') value = nums.reduce((a, b) => a + b, 0)
  else if (agg === 'avg') value = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : '—'
  else value = nums.length ? nums[nums.length - 1] : rows[rows.length - 1][field]

  if (typeof value === 'number') value = Math.round(value * 100) / 100
  return { field, value }
}

/**
 * Fill a stat widget's supporting line from the same result row.
 *
 * `template` is free text with {column} placeholders, e.g.
 *   "{on_track} on track · {warning} warning"
 *
 * Each placeholder is reduced with the widget's own aggregate, so a detail line
 * next to a summed value shows summed siblings rather than one arbitrary row —
 * two numbers on the same tile counted different ways would be worse than no
 * detail at all.
 *
 * An unknown column renders as an em dash instead of leaving {braces} on
 * screen: a typo should look like missing data, not like broken markup.
 */
export function fillDetail(template, rows, columns, opts = {}, format = String) {
  if (typeof template !== 'string' || !template.trim()) return ''
  return template.replace(/\{([^}]+)\}/g, (_, raw) => {
    const name = raw.trim()
    if (!columns.includes(name)) return '—'
    if (!rows.length) return '—'

    // Only numbers get aggregated. Summing a text column ("gagal", "today")
    // yields 0, which reads as a real measurement rather than a mistake — so
    // text is taken from the last row instead.
    const isNumeric = rows.some((r) => typeof r[name] === 'number')
    if (!isNumeric) {
      const last = rows[rows.length - 1][name]
      return last === null || last === undefined || last === '' ? '—' : String(last)
    }

    const { value } = computeStat(rows, columns, { ...opts, value_field: name })
    return typeof value === 'number' ? format(value) : String(value ?? '—')
  })
}

/** Columns a table widget should render, honouring an explicit selection. */
export function visibleColumns(columns, selected) {
  if (!selected?.length) return columns
  return columns.filter((c) => selected.includes(c))
}

/** Decide what to plot: which key is the X axis and which keys are series. */
export function resolveChartFields(columns, rows, opts = {}) {
  const isPrometheus = columns.join(',') === 'time,series,value'

  if (isPrometheus) {
    const pivoted = pivotSeries(rows)
    return {
      xKey: 'time',
      yKeys: pivoted.seriesNames,
      rows: pivoted.rows.map((r) => ({ ...r, time: formatEpoch(r.time) })),
    }
  }

  const xKey = opts.x_field || columns[0]
  const yField = opts.y_field || columns.find((c) => typeof rows[0]?.[c] === 'number')
  return { xKey, yKeys: yField ? [yField] : [], rows }
}

export function formatEpoch(seconds) {
  return new Date(seconds * 1000).toLocaleTimeString()
}
