/**
 * Display formatting for stat values.
 *
 * options used here:
 *   decimals      fixed number of decimal places (blank = as-is)
 *   thousands     false to drop the grouping separators
 *   prefix/suffix text wrapped around the number, e.g. "Rp " or " ms"
 *   compact       1,200,000 -> 1.2M
 */

/**
 * Compare a stat against a baseline.
 *
 * Two ways to get the baseline without running a second query:
 *   compare_field — another column in the same row (e.g. a `yesterday` count
 *                   produced by a FILTER/CASE in the same SELECT)
 *   compare_mode: 'previous_row' — the same field one row back, for a
 *                   per-day/per-hour series
 *
 * `higher_is_better` decides whether an increase reads as good or bad; for a
 * failure count you want it false.
 */
export function computeTrend(rows, field, options = {}) {
  const mode = options.compare_field ? 'field'
    : options.compare_mode === 'previous_row' ? 'previous_row' : null
  if (!mode || !rows?.length) return null

  const current = Number(rows[rows.length - 1]?.[field])
  const baseline = mode === 'field'
    ? Number(rows[rows.length - 1]?.[options.compare_field])
    : Number(rows[rows.length - 2]?.[field])

  if (!Number.isFinite(current) || !Number.isFinite(baseline)) return null

  const delta = current - baseline
  // percentage is meaningless against a zero baseline — show the absolute move
  const percent = baseline === 0 ? null : (delta / Math.abs(baseline)) * 100

  const higherIsBetter = options.higher_is_better !== false
  const direction = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat'
  const tone = direction === 'flat' ? 'flat'
    : (direction === 'up') === higherIsBetter ? 'good' : 'bad'

  return { current, baseline, delta, percent, direction, tone }
}

/** "▲ 8.1%" or "▲ 1,204" when a percentage can't be computed. */
export function formatTrend(trend, options = {}) {
  if (!trend) return ''
  if (trend.percent === null) {
    return `${formatStatValue(Math.abs(trend.delta), options)}`
  }
  const digits = Math.abs(trend.percent) < 10 ? 1 : 0
  return `${Math.abs(trend.percent).toFixed(digits)}%`
}

export function formatStatValue(value, options = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return String(value)

  const {
    decimals, thousands = true, compact = false, prefix = '', suffix = '',
  } = options

  const places = decimals === '' || decimals === null || decimals === undefined
    ? undefined
    : Number(decimals)

  let text
  if (compact) {
    text = new Intl.NumberFormat(undefined, {
      notation: 'compact',
      maximumFractionDigits: Number.isFinite(places) ? places : 1,
    }).format(value)
  } else {
    text = new Intl.NumberFormat(undefined, {
      useGrouping: thousands,
      minimumFractionDigits: Number.isFinite(places) ? places : undefined,
      maximumFractionDigits: Number.isFinite(places) ? places : 2,
    }).format(value)
  }

  return `${prefix}${text}${suffix}`
}
