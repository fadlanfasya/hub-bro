/**
 * Dashboard-level time range, applied to time-series widgets.
 *
 * A dashboard stores `definition.time_range` (e.g. "1h"). Widgets inherit it
 * unless they set their own `options.range_minutes`, which always wins — some
 * panels genuinely want a fixed window regardless of the toolbar.
 */

export const RANGES = [
  { key: '15m', label: 'Last 15 minutes', minutes: 15, step: '15s' },
  { key: '1h', label: 'Last hour', minutes: 60, step: '60s' },
  { key: '6h', label: 'Last 6 hours', minutes: 360, step: '5m' },
  { key: '24h', label: 'Last 24 hours', minutes: 1440, step: '15m' },
  { key: '7d', label: 'Last 7 days', minutes: 10080, step: '1h' },
  { key: '30d', label: 'Last 30 days', minutes: 43200, step: '6h' },
]

export const DEFAULT_RANGE = '1h'

export function findRange(key) {
  return RANGES.find((r) => r.key === key) || null
}

/**
 * Work out the window a widget should query.
 * Returns { minutes, step } or null when the widget isn't time-based.
 */
export function resolveRange(widget, dashboardRange) {
  const own = widget?.options?.range_minutes
  if (own) {
    const minutes = Number(own)
    if (!Number.isFinite(minutes) || minutes <= 0) return null
    return { minutes, step: widget.options.step || stepFor(minutes) }
  }

  if (!widget?.options?.follow_dashboard_range) return null
  const range = findRange(dashboardRange)
  if (!range) return null
  return { minutes: range.minutes, step: range.step }
}

/** A sensible resolution: roughly 60–120 points across the window. */
export function stepFor(minutes) {
  if (minutes <= 15) return '15s'
  if (minutes <= 60) return '60s'
  if (minutes <= 360) return '5m'
  if (minutes <= 1440) return '15m'
  if (minutes <= 10080) return '1h'
  return '6h'
}

/** True when a widget can meaningfully follow a time range. */
export function isTimeSeries(widget, sourceType) {
  if (sourceType !== 'prometheus') return false
  return widget?.type === 'line' || widget?.type === 'bar'
}
