/**
 * Threshold evaluation for stat widgets.
 *
 * options.thresholds = {
 *   direction: 'above' | 'below',   // which side counts as bad
 *   warn: 80,
 *   critical: 95,
 * }
 *
 * Kept as a standalone module (no React) so it can be unit tested directly.
 */

export const LEVELS = ['ok', 'warn', 'critical']

/** Returns 'ok' | 'warn' | 'critical' | null (null = no thresholds configured). */
export function evaluateThreshold(value, thresholds) {
  if (!thresholds) return null

  const warn = numberOrNull(thresholds.warn)
  const critical = numberOrNull(thresholds.critical)
  if (warn === null && critical === null) return null

  const n = numberOrNull(value)
  if (n === null) return null

  const below = thresholds.direction === 'below'
  const breached = (limit) => (limit === null ? false : below ? n <= limit : n >= limit)

  if (breached(critical)) return 'critical'
  if (breached(warn)) return 'warn'
  return 'ok'
}

/** Human-readable reason, used for tooltips and webhook payloads. */
export function describeThreshold(value, thresholds, level) {
  if (!level || level === 'ok') return ''
  const limit = level === 'critical' ? thresholds.critical : thresholds.warn
  const comparator = thresholds.direction === 'below' ? 'at or below' : 'at or above'
  return `${value} is ${comparator} the ${level} threshold of ${limit}`
}

function numberOrNull(v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
