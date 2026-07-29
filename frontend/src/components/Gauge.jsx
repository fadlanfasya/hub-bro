/**
 * Radial gauge for a single value.
 *
 * Hand-drawn SVG rather than a chart library: it's a 270° arc with a fill
 * proportional to the value, and it inherits the widget's threshold colour so
 * a breach reads the same as it does on a stat card.
 */

const START_ANGLE = 135        // degrees, clockwise from 3 o'clock
const SWEEP = 270              // leaves a gap at the bottom

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

export default function Gauge({ value, min = 0, max = 100, label, level, unit = '' }) {
  const numeric = Number(value)
  const hasValue = Number.isFinite(numeric)
  const fraction = hasValue ? gaugeFraction(numeric, Number(min), Number(max)) : 0
  const color = LEVEL_COLORS[level] || 'var(--primary)'

  const size = 200
  const c = size / 2
  const r = 78
  const stroke = 16

  const display = hasValue
    ? `${Math.round(numeric * 100) / 100}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    : '—'

  return (
    <div className="gauge">
      <svg viewBox={`0 0 ${size} ${size * 0.78}`} role="img"
        aria-label={`${label || 'value'}: ${display}${unit}`}>
        {/* track */}
        <path d={arcPath(c, c, r, START_ANGLE, SWEEP)}
          fill="none" stroke="var(--surface-2)" strokeWidth={stroke} strokeLinecap="round" />
        {/* filled portion */}
        {fraction > 0 && (
          <path d={arcPath(c, c, r, START_ANGLE, SWEEP * fraction)}
            fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" />
        )}
        <text x={c} y={c + 4} textAnchor="middle" className="gauge-value" fill={color}>
          {display}{unit}
        </text>
        {label && (
          <text x={c} y={c + 26} textAnchor="middle" className="gauge-label"
            fill="var(--muted)">{label}</text>
        )}
        <text x={c - r} y={c + 34} textAnchor="middle" className="gauge-bound"
          fill="var(--faint)">{min}</text>
        <text x={c + r} y={c + 34} textAnchor="middle" className="gauge-bound"
          fill="var(--faint)">{max}</text>
      </svg>
    </div>
  )
}
