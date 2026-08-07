import { lastPointTone, pointsAttr, sparkPoints } from '../sparkline'

/**
 * A small trend line for a stat widget.
 *
 * Deliberately unlabelled and unaxed: it exists to show shape, not values. The
 * number above it carries the precision, and the title attribute carries the
 * range for anyone who hovers.
 */
export default function Sparkline({
  values, width = 78, height = 22, higherIsBetter = true, ariaLabel,
}) {
  const points = sparkPoints(values, width, height)
  if (!points.length) return null

  const last = points[points.length - 1]
  const tone = lastPointTone(values, higherIsBetter)
  const min = Math.min(...values)
  const max = Math.max(...values)

  return (
    <svg className="sparkline" width={width} height={height}
      viewBox={`0 0 ${width} ${height}`} role="img"
      aria-label={ariaLabel || `Trend across ${values.length} points, `
        + `from ${values[0]} to ${values[values.length - 1]}`}
      // the range is the context a bare line can't carry
      title={`${values.length} points · low ${min} · high ${max}`}>
      <polyline className="sparkline-path" points={pointsAttr(points)}
        fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle className={`sparkline-dot tone-${tone}`} cx={last[0]} cy={last[1]} r="2" />
    </svg>
  )
}
