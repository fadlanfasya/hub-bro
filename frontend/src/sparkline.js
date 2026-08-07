/**
 * Geometry for the little trend line on a stat widget.
 *
 * Kept separate from the component so the maths can be checked numerically —
 * the failure mode here is silent. A divide-by-zero produces `NaN` in the
 * points attribute, and the browser draws nothing at all rather than
 * complaining, so a flat metric would look like a missing chart.
 */

/**
 * Numeric values for one column, in row order. Non-numbers are dropped.
 *
 * A NULL is dropped, not read as zero. `Number(null)` is 0, so a bucket with no
 * data would otherwise draw a plunge to the axis — indistinguishable from the
 * metric genuinely collapsing, which is the worst possible confusion on a
 * trend line.
 */
export function seriesFor(rows, field) {
  if (!Array.isArray(rows) || !field) return []
  return rows
    .map((r) => {
      const v = r?.[field]
      if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null
      const n = typeof v === 'number' ? v : Number(v)
      return Number.isFinite(n) ? n : null
    })
    .filter((n) => n !== null)
}

/**
 * Map values to points inside a width x height box.
 *
 * `pad` keeps the stroke from being clipped at the top and bottom edges.
 * Returns [] for fewer than two points — one point is not a trend, and a
 * single dot on a tile reads as a rendering glitch.
 */
export function sparkPoints(values, width = 74, height = 20, pad = 1.5) {
  if (!Array.isArray(values) || values.length < 2) return []
  if (!(width > 0) || !(height > pad * 2)) return []

  const max = Math.max(...values)
  const min = Math.min(...values)
  const span = max - min
  const usable = height - pad * 2

  return values.map((v, i) => {
    const x = (i / (values.length - 1)) * width
    // A flat series has no span to scale against, so centre it rather than
    // dividing by zero. A line through the middle is the honest picture.
    const y = span === 0 ? height / 2 : height - pad - ((v - min) / span) * usable
    return [x, y]
  })
}

/** "0.0,14.5 24.7,3.2 …" for an SVG polyline. */
export function pointsAttr(points) {
  return points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
}

/**
 * Whether the last value is the highest, lowest, or neither — used to mark the
 * final point, which is the one people actually read.
 */
export function lastPointTone(values, higherIsBetter = true) {
  if (!Array.isArray(values) || values.length < 2) return 'flat'
  const last = values[values.length - 1]
  const prev = values[values.length - 2]
  if (last === prev) return 'flat'
  return (last > prev) === higherIsBetter ? 'good' : 'bad'
}
