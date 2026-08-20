/**
 * Client-side table behaviour: sorting and conditional colouring.
 *
 * Colour rules live on the widget as:
 *   color_rules: [{ column: "status", op: "eq", value: "Failed", tone: "bad" }]
 * tone is one of good | bad | warn | muted, mapped to CSS classes so both
 * themes stay consistent.
 */
import { formatStatValue } from './format'

/**
 * Available cell tones. Each has a matching `td.tone-X` rule in styles.css,
 * with light and dark variants chosen to keep text readable on its own fill.
 * `warn` is kept as an alias of the amber tone so rules saved earlier still work.
 */
export const TONES = [
  { key: 'good', label: 'Green' },
  { key: 'yellow', label: 'Yellow' },
  { key: 'warn', label: 'Amber' },
  { key: 'orange', label: 'Orange' },
  { key: 'bad', label: 'Red' },
  { key: 'blue', label: 'Blue' },
  { key: 'purple', label: 'Purple' },
  { key: 'muted', label: 'Grey' },
]

export const TONE_KEYS = TONES.map((t) => t.key)

export function isNumeric(value) {
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'string' || !value.trim()) return false
  return Number.isFinite(Number(value))
}

/** Sort rows by a column, numerically when the whole column is numeric. */
export function sortRows(rows, column, direction = 'asc') {
  if (!column) return rows
  const numeric = rows.length > 0 && rows.every((r) => r[column] == null || isNumeric(r[column]))
  const factor = direction === 'desc' ? -1 : 1

  return [...rows].sort((a, b) => {
    const av = a[column]
    const bv = b[column]
    // blanks always sink, whichever way the column is sorted
    if (av == null || av === '') return bv == null || bv === '' ? 0 : 1
    if (bv == null || bv === '') return -1

    if (numeric) return (Number(av) - Number(bv)) * factor
    return String(av).localeCompare(String(bv), undefined, { numeric: true }) * factor
  })
}

/** Next state for a header click: asc -> desc -> off. */
export function nextSort(current, column) {
  if (current?.column !== column) return { column, direction: 'asc' }
  if (current.direction === 'asc') return { column, direction: 'desc' }
  return null
}

/**
 * Interactive table filtering — the search box and column pickers inside the
 * widget, as opposed to the fixed filters set in the widget config.
 *
 * These run on rows already fetched, so they're instant and cost nothing
 * upstream. They're also transient: reloading clears them, which is what you
 * want for a quick look rather than a saved view.
 */

/** Does any visible cell contain the search text? */
export function matchesSearch(row, columns, query) {
  const needle = String(query || '').trim().toLowerCase()
  if (!needle) return true
  return columns.some((c) => String(row[c] ?? '').toLowerCase().includes(needle))
}

/**
 * Apply the search box and per-column selections.
 * `columnFilters` is { column: [selected values] } — an empty or missing
 * array means that column isn't filtering anything.
 */
export function applyTableFilters(rows, columns, { search = '', columnFilters = {} } = {}) {
  const active = Object.entries(columnFilters).filter(([, values]) => values?.length)
  if (!String(search).trim() && !active.length) return rows

  return rows.filter((row) => {
    if (!matchesSearch(row, columns, search)) return false
    return active.every(([column, values]) =>
      values.some((v) => String(row[column] ?? '') === String(v)))
  })
}

/**
 * Distinct values in a column, for the picker. Sorted numerically when the
 * column is numeric, alphabetically otherwise, and capped so a high-cardinality
 * column doesn't render thousands of checkboxes.
 */
export function distinctValues(rows, column, limit = 200) {
  const seen = new Map()
  for (const row of rows) {
    const raw = row[column]
    const key = raw === null || raw === undefined || raw === '' ? '' : String(raw)
    if (!seen.has(key)) seen.set(key, 0)
    seen.set(key, seen.get(key) + 1)
    if (seen.size > limit) break
  }
  const values = [...seen.entries()].map(([value, count]) => ({ value, count }))
  const numeric = values.every((v) => v.value === '' || isNumeric(v.value))
  values.sort((a, b) => {
    if (a.value === '') return 1
    if (b.value === '') return -1
    return numeric
      ? Number(a.value) - Number(b.value)
      : a.value.localeCompare(b.value, undefined, { numeric: true })
  })
  return { values, truncated: seen.size > limit }
}

/** How many column filters are currently doing something. */
export function activeFilterCount(columnFilters = {}) {
  return Object.values(columnFilters).filter((v) => v?.length).length
}

/**
 * In-cell bar gauges.
 *
 * A number in a table tells you the value; a bar behind it tells you the value
 * relative to its neighbours, which is what you actually scan a device list
 * for. The scale matters more than it looks: a CPU column belongs on a fixed
 * 0–100 so 4% stays visibly small, while a "Virtual Servers" column has no
 * natural ceiling and is only meaningful against the busiest row.
 */

/** Columns configured to show a bar, as a Set. */
export function barColumnSet(spec) {
  if (Array.isArray(spec)) return new Set(spec.filter(Boolean).map(String))
  if (typeof spec === 'string') {
    return new Set(spec.split(',').map((s) => s.trim()).filter(Boolean))
  }
  return new Set()
}

/**
 * Upper bound for a column's bars.
 *
 * An explicit max wins. Otherwise the largest value in the column is used, so
 * the busiest row fills the bar — except when every value looks like a
 * percentage, where 100 is the honest ceiling. Without that exception a rack
 * of idle devices would each show a full bar at 5% CPU.
 */
export function barMaxFor(rows, column, explicit) {
  if (isNumeric(explicit)) return Number(explicit)

  const values = rows.map((r) => r[column]).filter(isNumeric).map(Number)
  if (!values.length) return 0

  const max = Math.max(...values)
  const min = Math.min(...values)
  if (min >= 0 && max <= 100) return 100
  return max
}

/** How full a bar should be, 0–1. Out-of-range values clamp instead of overflowing. */
export function barFraction(value, max) {
  if (!isNumeric(value) || !isNumeric(max) || Number(max) <= 0) return null
  const fraction = Number(value) / Number(max)
  if (!Number.isFinite(fraction)) return null
  return Math.min(1, Math.max(0, fraction))
}

/**
 * Per-column number formatting.
 *
 * A PromQL division answers with everything it has — 2.385722420266237 — which
 * is true and unreadable. Rounding in the query would work, but then the raw
 * number is gone from the data too; rounding here keeps the value intact and
 * only changes what the cell shows.
 *
 * column_format: [{ column: "Memory", decimals: 1, unit: "%" }]
 */
export function formatSpecFor(specs, column) {
  if (!specs?.length) return null
  return specs.find((s) => s?.column === column) || null
}

export function formatCell(value, spec) {
  if (!spec || typeof value !== 'number' || !Number.isFinite(value)) {
    return value === null || value === undefined ? '' : String(value)
  }
  return formatStatValue(value, {
    decimals: spec.decimals,
    suffix: spec.unit || '',
    thousands: spec.thousands !== false,
  })
}

function matches(cellValue, rule) {
  const op = rule.op || 'eq'
  const target = rule.value

  if (op === 'not_empty') return cellValue != null && cellValue !== ''
  if (op === 'contains') {
    return String(cellValue ?? '').toLowerCase().includes(String(target).toLowerCase())
  }
  if (['gt', 'gte', 'lt', 'lte'].includes(op)) {
    if (!isNumeric(cellValue) || !isNumeric(target)) return false
    const a = Number(cellValue)
    const b = Number(target)
    return { gt: a > b, gte: a >= b, lt: a < b, lte: a <= b }[op]
  }
  const equal = String(cellValue ?? '') === String(target)
  return op === 'ne' ? !equal : equal
}

/**
 * Tone for one cell, or null. The first matching rule wins, so put the most
 * specific rule first.
 */
export function toneForCell(row, column, rules) {
  if (!rules?.length) return null
  for (const rule of rules) {
    if (!rule.column || !rule.tone) continue
    // a rule on another column still colours this cell when it's set to
    // highlight the whole row
    const source = rule.whole_row ? rule.column : column
    if (!rule.whole_row && rule.column !== column) continue
    if (matches(row[source], rule)) return rule.tone
  }
  return null
}
