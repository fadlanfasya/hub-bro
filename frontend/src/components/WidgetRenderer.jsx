import { useEffect, useRef, useState } from 'react'
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, CartesianGrid,
  ResponsiveContainer, Legend,
} from 'recharts'
import { Link } from 'react-router-dom'
import { AlertCircle, TrendingUp, TrendingDown, Minus, Search, ExternalLink } from 'lucide-react'
import { buildLinkUrl, linkProps } from '../links'
import { data as dataApi, publicApi } from '../api'
import { describeThreshold, evaluateThreshold } from '../thresholds'
import { computeTrend, formatStatValue, formatTrend } from '../format'

import { seriesFor } from '../sparkline'
import {
  buildOptions, computeStat, fillDetail, resolveChartFields, visibleColumns,
} from '../widgetData'
import Sparkline from './Sparkline'
import Gauge from './Gauge'
import Markdown from './Markdown'
import {
  activeFilterCount, applyTableFilters, isNumeric, nextSort, sortRows, toneForCell,
} from '../tableRules'
import ColumnFilter from './ColumnFilter'
import { canEmitSelection, crossFiltersFor, isSelected } from '../selection'

const COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--chart-6)']

export default function WidgetRenderer(props) {
  const { widget } = props
  // a text widget has no data source, so it never touches the fetch machinery
  if (widget.type === 'text') {
    return (
      <Markdown source={widget.options?.text} size={widget.options?.font_size}
        align={widget.options?.align} valign={widget.options?.valign} />
    )
  }
  return <WidgetData {...props} />
}

function WidgetData({
  widget, refreshKey, publicToken, onData, dashboardRange, dashboardId, readOnly,
  selection, onSelect,
}) {
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)
  const onDataRef = useRef(onData)
  useEffect(() => { onDataRef.current = onData }, [onData])

  // per-widget auto refresh
  const intervalSec = Number(widget.options?.refresh_seconds) || 0
  useEffect(() => {
    if (!intervalSec) return
    const id = setInterval(() => setTick((t) => t + 1), intervalSec * 1000)
    return () => clearInterval(id)
  }, [intervalSec])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    // Viewers (and public visitors) fetch through the widget-scoped endpoint:
    // the server reads the query from the stored dashboard, so they can see the
    // data without being able to compose a query of their own.
    const request = publicToken
      ? publicApi.fetch(publicToken, widget.id)
      : readOnly && dashboardId
        ? dataApi.forWidget(dashboardId, widget.id)
        : dataApi.fetch(widget.datasource_id,
          buildOptions(widget, dashboardRange, crossFiltersFor(widget, selection)))
    request
      .then((res) => {
        if (cancelled) return
        setResult(res.data)
        // hand the result to the parent for CSV export and the header badge
        onDataRef.current?.(widget.id, res.data, { stale: false })
      })
      .catch((err) => {
        if (cancelled) return
        setError(err.response?.data?.detail || 'Failed to load')
        onDataRef.current?.(widget.id, null, { stale: true })
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [widget, refreshKey, tick, publicToken, dashboardRange, readOnly, dashboardId,
    selection?.column, selection?.value])

  // only show the loading placeholder on first load; on auto-refresh keep showing current data
  if (loading && !result) return <div className="muted" style={{ padding: 12 }}>Loading…</div>
  // show error only when there's no data to keep displaying (stale data beats a blank error on auto-refresh)
  if (error && !result) return <div className="error" style={{ padding: 12 }}><AlertCircle size={14} />{error}</div>
  if (!result) return null

  // The truncated/stale warning is reported upward and drawn in the widget
  // header, so it never steals height from the chart or table.
  return (
    <WidgetPlot widget={widget} result={result} selection={selection} onSelect={onSelect} />
  )
}

/**
 * Compact badge for the widget header: shown only when the data is truncated
 * or stale, so a wrong-looking number is never silently wrong.
 */
export function DataBadge({ meta, stale }) {
  const partial = meta?.partial
  if (!partial && !stale) return null

  const parts = []
  if (partial) {
    parts.push(`Showing ${Number(meta.fetched).toLocaleString()} of `
      + `${Number(meta.total).toLocaleString()} rows — totals cover only the rows fetched. `
      + `Raise "Max rows" in the widget config to include everything.`)
  }
  if (stale) parts.push('Last refresh failed — showing the previous data.')

  return (
    <span className="data-badge" title={parts.join(' ')}>
      <AlertCircle size={12} />
      {partial && (
        <span className="data-badge-text">
          {Number(meta.fetched).toLocaleString()}/{Number(meta.total).toLocaleString()}
        </span>
      )}
    </span>
  )
}

/**
 * Slice label drawn outside the ring, so values are readable without hovering.
 * Recharts hands us the geometry; we place the text just beyond the arc and
 * anchor it left or right depending on which half of the circle it sits in.
 */
function renderSliceLabel({ cx, cy, midAngle, outerRadius, name, value, percent },
                          mode, total, opts) {
  const share = total ? value / total : (percent || 0)
  // hide labels for slices too thin to read, they just collide with each other
  if (share < 0.03) return null

  const RAD = Math.PI / 180
  const radius = outerRadius + 16
  const x = cx + radius * Math.cos(-midAngle * RAD)
  const y = cy + radius * Math.sin(-midAngle * RAD)
  const onRight = x > cx

  const valueText = formatStatValue(value, opts)
  const pctText = `${(share * 100).toFixed(share < 0.1 ? 1 : 0)}%`
  const text = mode === 'percent' ? pctText
    : mode === 'both' ? `${valueText} · ${pctText}`
      : valueText

  return (
    <text x={x} y={y} textAnchor={onRight ? 'start' : 'end'} dominantBaseline="central"
      style={{ fontSize: 12, fill: 'var(--ink)' }}>
      <tspan style={{ fill: 'var(--muted)' }}>{name} </tspan>
      <tspan style={{ fontWeight: 600 }}>{text}</tspan>
    </text>
  )
}

/**
 * A linked table cell. Internal paths route without a page reload; external
 * ones open in a new tab so the dashboard stays put — usually on a wall screen.
 * The click is stopped so it doesn't also trigger the row's cross-filter.
 */
function CellLink({ href, text }) {
  const props = linkProps(href)
  const stop = (e) => e.stopPropagation()
  if (props.internal) {
    return <Link to={props.to} className="cell-link" onClick={stop}>{text}</Link>
  }
  return (
    <a href={props.href} target={props.target} rel={props.rel}
      className="cell-link" onClick={stop}>
      {text}<ExternalLink size={10} />
    </a>
  )
}

/** Table with click-to-sort headers and per-cell colour rules. */
function DataTable({ columns, rows, opts, selection, onSelect }) {
  const [sort, setSort] = useState(
    opts.sort_column ? { column: opts.sort_column, direction: opts.sort_dir || 'asc' } : null
  )
  // interactive filters, deliberately not persisted — see tableRules.js
  const [search, setSearch] = useState('')
  const [columnFilters, setColumnFilters] = useState({})

  const shown = visibleColumns(columns, opts.columns)
  const rules = opts.color_rules
  const limit = Number(opts.max_display_rows) || 200
  const showFilters = opts.show_filters !== false

  const filtered = showFilters
    ? applyTableFilters(rows, shown, { search, columnFilters })
    : rows
  const sorted = sort ? sortRows(filtered, sort.column, sort.direction) : filtered
  const visible = sorted.slice(0, limit)
  const numericColumns = new Set(
    shown.filter((c) => rows.length && rows.every((r) => r[c] == null || isNumeric(r[c])))
  )

  const filterCount = activeFilterCount(columnFilters)
  const isFiltering = Boolean(search.trim()) || filterCount > 0
  const clearAll = () => { setSearch(''); setColumnFilters({}) }

  const table = (
    <table className="data sortable">
      <thead>
        <tr>
          {shown.map((c) => {
            const active = sort?.column === c
            return (
              <th key={c} className={numericColumns.has(c) ? 'num' : undefined}>
                <span className="th-inner">
                  <button type="button" className="th-sort"
                    aria-label={`Sort by ${c}`}
                    onClick={() => setSort((s) => nextSort(s, c))}>
                    {c}
                    <span className={active ? 'sort-icon on' : 'sort-icon'}>
                      {active ? (sort.direction === 'asc' ? '↑' : '↓') : '↕'}
                    </span>
                  </button>
                  {showFilters && (
                    <ColumnFilter column={c} rows={rows}
                      selected={columnFilters[c] || []}
                      onChange={(values) => setColumnFilters((f) => ({ ...f, [c]: values }))} />
                  )}
                </span>
              </th>
            )
          })}
        </tr>
      </thead>
      <tbody>
        {visible.map((r, i) => {
          // clicking a row selects on the first non-numeric column, which is
          // almost always the category you'd want to filter by
          const keyColumn = opts.select_column
            || shown.find((c) => !numericColumns.has(c)) || shown[0]
          const rowSelected = isSelected(selection, keyColumn, r[keyColumn])
          return (
            <tr key={i}
              className={[onSelect ? 'clickable' : '', rowSelected ? 'selected' : '']
                .filter(Boolean).join(' ') || undefined}
              onClick={onSelect ? () => onSelect(keyColumn, r[keyColumn]) : undefined}>
              {shown.map((c) => {
                const tone = toneForCell(r, c, rules)
                const href = buildLinkUrl(opts.column_links?.[c], r)
                const text = String(r[c] ?? '')
                return (
                  <td key={c}
                    className={[numericColumns.has(c) ? 'num' : '', tone ? `tone-${tone}` : '']
                      .filter(Boolean).join(' ')}>
                    {href ? <CellLink href={href} text={text} /> : text}
                  </td>
                )
              })}
            </tr>
          )
        })}
      </tbody>
    </table>
  )

  if (!showFilters) return table

  return (
    <div className="table-wrap">
      <div className="table-toolbar no-export">
        <Search size={13} />
        <input className="table-search" value={search} placeholder="Search rows"
          onChange={(e) => setSearch(e.target.value)} />
        {isFiltering && (
          <>
            <span className="table-count">
              {sorted.length.toLocaleString()} of {rows.length.toLocaleString()}
            </span>
            <button className="ghost small" onClick={clearAll}>Clear</button>
          </>
        )}
      </div>
      <div className="table-scroll">{table}</div>
    </div>
  )
}

function WidgetPlot({ widget, result, selection, onSelect }) {
  const { rows, columns } = result
  const opts = widget.options || {}
  // only pie/bar/table can raise a selection, and only when the parent is listening
  const emits = Boolean(onSelect) && canEmitSelection(widget)
  const select = (column, value) => {
    if (emits) onSelect({ column, value, sourceId: widget.id })
  }

  if (widget.type === 'stat') {
    const { field, value } = computeStat(rows, columns, opts)
    const display = formatStatValue(value, opts)
    const level = evaluateThreshold(value, opts.thresholds)
    const reason = describeThreshold(display, opts.thresholds, level)
    const label = opts.label ?? `${field}${opts.aggregate ? ` · ${opts.aggregate}` : ''}`
    return (
      <div className={`stat-wrap align-${opts.align || 'left'} v-${opts.valign || 'middle'}`}>
        {label && <div className="stat-label">{label}</div>}
        <div className={level ? `stat-value level-${level}` : 'stat-value'}
          style={opts.value_size ? { fontSize: `${opts.value_size}px` } : undefined}
          title={reason}>
          {display}
        </div>
        {(() => {
          const trend = computeTrend(rows, field, opts)
          if (!trend) return null
          const Arrow = trend.direction === 'up' ? TrendingUp
            : trend.direction === 'down' ? TrendingDown : Minus
          return (
            <div className={`stat-trend tone-${trend.tone}`}
              title={`${formatStatValue(trend.current, opts)} vs `
                + `${formatStatValue(trend.baseline, opts)} — a change of `
                + `${formatStatValue(trend.delta, opts)}`}>
              <Arrow size={13} />
              <span>{formatTrend(trend, opts)}</span>
              {opts.compare_label && <span className="stat-trend-label">{opts.compare_label}</span>}
            </div>
          )
        })()}
        {opts.sparkline && (() => {
          // One query serves both: the last bucket is the headline number, the
          // whole series is the shape. Needs a time-ordered, multi-row result.
          const series = seriesFor(rows, opts.spark_field || field)
          return series.length > 1 ? (
            <Sparkline values={series} higherIsBetter={opts.higher_is_better !== false} />
          ) : null
        })()}
        {(() => {
          // supporting numbers from the same query — "13 on track · 0 warning"
          const detail = fillDetail(opts.detail, rows, columns, opts,
                                    (v) => formatStatValue(v, opts))
          return detail ? <div className="stat-detail">{detail}</div> : null
        })()}
        {level && level !== 'ok' && (
          <div className={`status-pill ${level === 'critical' ? 'error' : 'warn'}`} title={reason}>
            <AlertCircle size={11} />
            {level === 'critical' ? 'Critical' : 'Warning'}
          </div>
        )}
      </div>
    )
  }

  if (widget.type === 'gauge') {
    const { field, value } = computeStat(rows, columns, opts)
    const level = evaluateThreshold(value, opts.thresholds)
    return (
      <Gauge
        value={value}
        min={Number(opts.gauge_min ?? 0)}
        max={Number(opts.gauge_max ?? 100)}
        unit={opts.unit || ''}
        label={opts.label ?? (opts.hide_label ? '' : field)}
        level={level}
        thresholds={opts.thresholds}
        format={{
          decimals: opts.decimals, thousands: opts.thousands,
          compact: opts.compact, prefix: opts.prefix,
        }}
      />
    )
  }

  if (widget.type === 'table') {
    return (
      <DataTable columns={columns} rows={rows} opts={opts}
        selection={selection} onSelect={emits ? select : undefined} />
    )
  }

  if (widget.type === 'pie') {
    const catField = opts.x_field || columns.find((c) => typeof rows[0]?.[c] !== 'number') || columns[0]
    const valField = opts.y_field || columns.find((c) => typeof rows[0]?.[c] === 'number')
    if (!valField) return <div className="muted" style={{ padding: 12, textAlign: 'center' }}>No numeric field to plot.</div>
    const pieData = rows.map((r) => ({ name: String(r[catField]), value: Number(r[valField]) }))
    const total = pieData.reduce((sum, d) => sum + (Number.isFinite(d.value) ? d.value : 0), 0)

    const labelMode = opts.pie_labels || 'value'      // value | percent | both | none
    const donut = opts.pie_style !== 'pie'            // donut unless a full pie is asked for
    const showTotal = donut && opts.pie_center !== false

    return (
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={pieData} dataKey="value" nameKey="name"
            innerRadius={donut ? '52%' : 0} outerRadius="76%" paddingAngle={2}
            isAnimationActive={false}
            label={labelMode === 'none' ? false : (p) => renderSliceLabel(p, labelMode, total, opts)}
            labelLine={labelMode !== 'none'}
            onClick={emits ? (entry) => select(catField, entry?.name) : undefined}
            style={emits ? { cursor: 'pointer' } : undefined}
          >
            {pieData.map((d, i) => {
              const active = isSelected(selection, catField, d.name)
              const dim = selection?.column === catField && !active
              return (
                <Cell key={i} fill={COLORS[i % COLORS.length]} stroke="var(--surface)"
                  opacity={dim ? 0.3 : 1}
                  strokeWidth={active ? 3 : 1} />
              )
            })}
          </Pie>

          {showTotal && (
            <>
              <text x="50%" y="50%" textAnchor="middle" dy={-4}
                style={{ fontSize: 20, fontWeight: 600, fill: 'var(--ink)' }}>
                {formatStatValue(total, opts)}
              </text>
              <text x="50%" y="50%" textAnchor="middle" dy={14}
                style={{ fontSize: 11, fill: 'var(--muted)' }}>
                {opts.pie_center_label || 'Total'}
              </text>
            </>
          )}

          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Tooltip formatter={(v, n) => [formatStatValue(Number(v), opts), n]} contentStyle={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 8, fontSize: 13, fontFamily: 'var(--font-ui)',
          }} labelStyle={{ color: 'var(--ink)' }} />
        </PieChart>
      </ResponsiveContainer>
    )
  }

  // line / bar charts
  const { xKey, yKeys, rows: chartRows } = resolveChartFields(columns, rows, opts)

  if (!yKeys.length) return <div className="muted" style={{ padding: 12, textAlign: 'center' }}>No numeric field to plot.</div>

  const ChartComp = widget.type === 'bar' ? BarChart : LineChart
  const barsClickable = emits && widget.type === 'bar'

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ChartComp data={chartRows}
        onClick={barsClickable
          ? (e) => select(xKey, e?.activeLabel ?? e?.activePayload?.[0]?.payload?.[xKey])
          : undefined}
        style={barsClickable ? { cursor: 'pointer' } : undefined}>
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
        <XAxis dataKey={xKey} stroke="var(--muted)" fontSize={11} tickLine={false} />
        <YAxis stroke="var(--muted)" fontSize={11} tickLine={false} />
        <Tooltip contentStyle={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 8, fontSize: 13, fontFamily: 'var(--font-ui)',
        }} labelStyle={{ color: 'var(--ink)' }} />
        {yKeys.length > 1 && <Legend />}
        {yKeys.map((k, i) =>
          widget.type === 'bar'
            ? (
              <Bar key={k} dataKey={k} fill={COLORS[i % COLORS.length]}>
                {barsClickable && chartRows.map((row, j) => {
                  const active = isSelected(selection, xKey, row[xKey])
                  const dim = selection?.column === xKey && !active
                  return <Cell key={j} opacity={dim ? 0.35 : 1} />
                })}
              </Bar>
            )
            : <Line key={k} dataKey={k} stroke={COLORS[i % COLORS.length]} dot={false} strokeWidth={2} />
        )}
      </ChartComp>
    </ResponsiveContainer>
  )
}
