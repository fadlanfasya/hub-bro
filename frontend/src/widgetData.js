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

  // A table built from several PromQL queries sends the whole set plus the key
  // they join on. Everything else about the join — bar columns, colour rules —
  // is drawn in the browser and never leaves it.
  const queries = (o.queries || []).filter((q) => q?.query)
  if (queries.length && o.join?.on) {
    opts.queries = queries
    opts.join = o.join
  } else if (o.query) {
    opts.query = o.query
  }

  // series_field deliberately stays out: it only renames a legend in the
  // browser, and sending it would split the cache for identical data
  if (o.itemtype) opts.itemtype = o.itemtype
  if (o.max_rows) opts.max_rows = o.max_rows
  // GLPI: "search" returns the item type's default display columns, "list"
  // returns every stored field. Only send it when it differs from the default.
  if (o.mode === 'list') opts.mode = 'list'

  // transforms, applied server-side after the fetch
  if (o.unpivot?.columns?.length) opts.unpivot = o.unpivot
  // date_diff runs before filters server-side, so a filter can reference the
  // column it produces
  if (o.date_diff?.length) opts.date_diff = o.date_diff.filter((d) => d?.column)
  // count_by replaces every row with one summary row, so a single stat widget
  // can show several differently-bucketed counts at once
  if (o.count_by?.column && o.count_by?.buckets?.length) opts.count_by = o.count_by
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
export function pivotSeries(rows, key = 'series') {
  if (!rows?.length) return { rows: [], seriesNames: [] }
  if (!rows.some((r) => key in r)) return { rows, seriesNames: [] }

  const nameOf = (r) => String(r[key] ?? '')
  const seriesNames = [...new Set(rows.map(nameOf))]
  const byTime = new Map()
  for (const r of rows) {
    if (!byTime.has(r.time)) byTime.set(r.time, { time: r.time })
    byTime.get(r.time)[nameOf(r)] = r.value
  }
  return { rows: [...byTime.values()], seriesNames }
}

/**
 * Columns that are numbers but never the number you want on a tile.
 * A Prometheus result leads with `time`, a unix timestamp — picking it as the
 * value field turned every stat widget into a clock.
 */
const NOT_A_VALUE = new Set(['time', 'timestamp', 'series'])

/** Reduce rows to the single number a stat widget shows. */
export function computeStat(rows, columns, opts = {}) {
  const numeric = (c) => typeof rows[0]?.[c] === 'number'
  const field = opts.value_field
    || columns.find((c) => !NOT_A_VALUE.has(c) && numeric(c))
    // a table whose only number really is called "time" still gets an answer
    || columns.find(numeric)
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
  // Checked by presence, not by an exact column list: a Prometheus result also
  // carries a column per label now, so matching "time,series,value" exactly
  // silently stopped recognising it and every chart fell through to the
  // single-series branch.
  const isPrometheus = ['time', 'series', 'value'].every((c) => columns.includes(c))

  if (isPrometheus) {
    // one label usually makes a better legend than the whole label set —
    // "STL-L02-R10-ELTM01" reads better than "instance=…,job=f5ltm"
    const key = opts.series_field && columns.includes(opts.series_field)
      ? opts.series_field
      : 'series'
    const pivoted = pivotSeries(rows, key)
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
