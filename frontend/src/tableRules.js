/**
 * Client-side table behaviour: sorting and conditional colouring.
 *
 * Colour rules live on the widget as:
 *   color_rules: [{ column: "status", op: "eq", value: "Failed", tone: "bad" }]
 * tone is one of good | bad | warn | muted, mapped to CSS classes so both
 * themes stay consistent.
 */

export const TONES = ['good', 'warn', 'bad', 'muted']

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
