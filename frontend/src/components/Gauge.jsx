import { formatStatValue } from '../format'

/**
 * Radial gauge for a single value.
 *
 * Hand-drawn SVG rather than a chart library: it's a 270° arc with a fill
 * proportional to the value. It inherits the widget's threshold colour so a
 * breach reads the same as it does on a stat card, and draws a tick where each
 * threshold sits — otherwise you can see that a number is amber but not how
 * close it is to going red.
 */

// Geometry is tuned so the arc, the value and the scale labels each get their
// own band and never overlap. A 240° sweep starting at 150° leaves a clear gap
// at the bottom for the min and max labels to sit under the arc's ends.
const START_ANGLE = 150
const SWEEP = 240

const VIEW_W = 200
const VIEW_H = 148
const CX = 100
const CY = 90
const RADIUS = 68
const STROKE = 13

const LEVEL_COLORS = {
  ok: 'var(--primary)',
  warn: '#b7791f',
  critical: 'var(--danger)',
}

export function gaugeFraction(value, min, max) {
  if (![value, min, max].every(Number.isFinite) || max === min) return 0
  return Math.min(1, Math.max(0, (value - min) / (max - min)))
}

function polar(cx, cy, r, degrees) {
  const rad = (degrees * Math.PI) / 180
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}

function arcPath(cx, cy, r, startDeg, sweepDeg) {
  const start = polar(cx, cy, r, startDeg)
  const end = polar(cx, cy, r, startDeg + sweepDeg)
  const largeArc = sweepDeg > 180 ? 1 : 0
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`
}

export default function Gauge({
  value, min = 0, max = 100, label, level, unit = '', thresholds, format = {},
}) {
  const numeric = Number(value)
  const hasValue = Number.isFinite(numeric)
  const lo = Number(min)
  const hi = Number(max)
  const fraction = hasValue ? gaugeFraction(numeric, lo, hi) : 0
  const color = LEVEL_COLORS[level] || 'var(--primary)'

  const display = hasValue
    ? formatStatValue(numeric, { ...format, suffix: unit || format.suffix || '' })
    : '—'

  // ticks for the configured thresholds, so you can see how much headroom is left
  const marks = ['warn', 'critical']
    .map((key) => ({ key, at: Number(thresholds?.[key]) }))
    .filter((m) => Number.isFinite(m.at) && m.at > lo && m.at < hi)
    .map((m) => {
      const angle = START_ANGLE + SWEEP * gaugeFraction(m.at, lo, hi)
      return {
        ...m,
        inner: polar(CX, CY, RADIUS - STROKE / 2 - 1, angle),
        outer: polar(CX, CY, RADIUS + STROKE / 2 + 1, angle),
      }
    })

  const startPoint = polar(CX, CY, RADIUS, START_ANGLE)
  const endPoint = polar(CX, CY, RADIUS, START_ANGLE + SWEEP)

  return (
    <div className="gauge">
      <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} role="img"
        aria-label={`${label || 'value'}: ${display}`}>
        <path d={arcPath(CX, CY, RADIUS, START_ANGLE, SWEEP)}
          fill="none" stroke="var(--surface-2)" strokeWidth={STROKE} strokeLinecap="round" />

        {fraction > 0 && (
          <path d={arcPath(CX, CY, RADIUS, START_ANGLE, SWEEP * fraction)}
            fill="none" stroke={color} strokeWidth={STROKE} strokeLinecap="round" />
        )}

        {marks.map((m) => (
          <line key={m.key}
            x1={m.inner.x} y1={m.inner.y} x2={m.outer.x} y2={m.outer.y}
            stroke={LEVEL_COLORS[m.key === 'critical' ? 'critical' : 'warn']}
            strokeWidth="2.5" strokeLinecap="round" opacity="0.9">
            <title>{`${m.key} at ${m.at}`}</title>
          </line>
        ))}

        {/* value sits in the middle of the ring, label just under it */}
        <text x={CX} y={CY - 4} textAnchor="middle" dominantBaseline="middle"
          className="gauge-value" fill={color}>
          {display}
        </text>
        {label && (
          <text x={CX} y={CY + 18} textAnchor="middle" dominantBaseline="middle"
            className="gauge-label" fill="var(--muted)">{label}</text>
        )}

        {/* scale ends, below the arc so they never sit on top of it */}
        <text x={startPoint.x} y={VIEW_H - 6} textAnchor="middle"
          className="gauge-bound" fill="var(--faint)">
          {formatStatValue(lo, { compact: format.compact })}
        </text>
        <text x={endPoint.x} y={VIEW_H - 6} textAnchor="middle"
          className="gauge-bound" fill="var(--faint)">
          {formatStatValue(hi, { compact: format.compact })}
        </text>
      </svg>
    </div>
  )
}
