/**
 * Client-side table behaviour: sorting and conditional colouring.
 *
 * Colour rules live on the widget as:
 *   color_rules: [{ column: "status", op: "eq", value: "Failed", tone: "bad" }]
 * tone is one of good | bad | warn | muted, mapped to CSS classes so both
 * themes stay consistent.
 */

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
