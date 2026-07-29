/**
 * Per-dashboard theming.
 *
 * A theme only sets the accent and the chart series colours. Surfaces and text
 * stay on the app's tuned tokens, so a theme can't produce unreadable contrast
 * — the one thing users reliably get wrong when handed a colour picker.
 *
 * Stored on the dashboard as `definition.theme`:
 *   { preset: "ocean" }                      a named palette
 *   { accent: "#7c3aed", charts: [...] }     custom colours
 */

export const PRESETS = {
  default: {
    label: 'Hub-Bro green',
    accent: '#00694a',
    accentDark: '#2ea884',
    charts: ['#00694a', '#e9b452', '#2563eb', '#db2777', '#0891b2', '#7c3aed'],
    chartsDark: ['#2ea884', '#e9b452', '#58a6ff', '#f778ba', '#39c5cf', '#a371f7'],
  },
  ocean: {
    label: 'Ocean',
    accent: '#0b6bcb',
    accentDark: '#58a6ff',
    charts: ['#0b6bcb', '#0891b2', '#7c3aed', '#0f766e', '#c2410c', '#4338ca'],
    chartsDark: ['#58a6ff', '#39c5cf', '#a371f7', '#2dd4bf', '#fb923c', '#818cf8'],
  },
  violet: {
    label: 'Violet',
    accent: '#6d28d9',
    accentDark: '#a371f7',
    charts: ['#6d28d9', '#db2777', '#0891b2', '#ca8a04', '#059669', '#dc2626'],
    chartsDark: ['#a371f7', '#f778ba', '#39c5cf', '#e9b452', '#34d399', '#f85149'],
  },
  slate: {
    label: 'Slate',
    accent: '#334155',
    accentDark: '#94a3b8',
    charts: ['#334155', '#64748b', '#0891b2', '#b45309', '#4d7c0f', '#9f1239'],
    chartsDark: ['#94a3b8', '#cbd5e1', '#39c5cf', '#e9b452', '#a3e635', '#fb7185'],
  },
  sunset: {
    label: 'Sunset',
    accent: '#c2410c',
    accentDark: '#fb923c',
    charts: ['#c2410c', '#b45309', '#be123c', '#7c2d12', '#a16207', '#9f1239'],
    chartsDark: ['#fb923c', '#e9b452', '#fb7185', '#fdba74', '#facc15', '#f472b6'],
  },
}

export const DEFAULT_PRESET = 'default'
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

export function isValidHex(value) {
  return typeof value === 'string' && HEX.test(value.trim())
}

/** Expand #abc to #aabbcc so parsing is uniform. */
export function normaliseHex(value) {
  if (!isValidHex(value)) return null
  let hex = value.trim().toLowerCase()
  if (hex.length === 4) {
    hex = `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
  }
  return hex
}

function toRgb(hex) {
  const h = normaliseHex(hex)
  if (!h) return null
  return {
    r: parseInt(h.slice(1, 3), 16),
    g: parseInt(h.slice(3, 5), 16),
    b: parseInt(h.slice(5, 7), 16),
  }
}

/** WCAG relative luminance. */
export function luminance(hex) {
  const rgb = toRgb(hex)
  if (!rgb) return 0
  const channel = (v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b)
}

/** WCAG contrast ratio between two colours, 1 to 21. */
export function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100
}

/** Lighten or darken toward white/black by `amount` (0..1). */
export function shift(hex, amount) {
  const rgb = toRgb(hex)
  if (!rgb) return hex
  const target = amount > 0 ? 255 : 0
  const t = Math.abs(amount)
  const mix = (v) => Math.round(v + (target - v) * t)
  return `#${[mix(rgb.r), mix(rgb.g), mix(rgb.b)]
    .map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

/** Translucent version of a colour, for soft badge backgrounds. */
export function withAlpha(hex, alpha) {
  const rgb = toRgb(hex)
  if (!rgb) return hex
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`
}

/**
 * An accent needs to stay readable on the surface behind it. If a user picks
 * something too pale for light mode (or too dark for dark mode), nudge it
 * until it passes rather than rejecting their choice.
 */
export function ensureReadable(hex, background, minRatio = 4.5) {
  let colour = normaliseHex(hex)
  if (!colour) return hex
  const darkenTowards = luminance(background) > 0.5 ? -1 : 1

  for (let i = 0; i < 20; i += 1) {
    if (contrastRatio(colour, background) >= minRatio) return colour
    colour = shift(colour, darkenTowards * 0.05)
  }
  return colour
}

/** Resolve a stored theme into the concrete colours for one mode. */
export function resolveTheme(theme, mode = 'light') {
  const dark = mode === 'dark'
  const preset = PRESETS[theme?.preset] || PRESETS[DEFAULT_PRESET]

  const rawAccent = isValidHex(theme?.accent)
    ? normaliseHex(theme.accent)
    : (dark ? preset.accentDark : preset.accent)

  const surface = dark ? '#161b22' : '#ffffff'
  const accent = ensureReadable(rawAccent, surface)

  const charts = Array.isArray(theme?.charts) && theme.charts.length
    ? theme.charts.filter(isValidHex).map(normaliseHex)
    : (dark ? preset.chartsDark : preset.charts)

  return {
    accent,
    accentStrong: shift(accent, dark ? 0.15 : -0.18),
    accentSoft: withAlpha(accent, dark ? 0.16 : 0.12),
    charts: charts.length ? charts : preset.charts,
  }
}

/** CSS custom properties to apply on the dashboard container. */
export function themeToCssVars(theme, mode = 'light') {
  const resolved = resolveTheme(theme, mode)
  const vars = {
    '--primary': resolved.accent,
    '--primary-strong': resolved.accentStrong,
    '--primary-soft': resolved.accentSoft,
  }
  resolved.charts.forEach((colour, i) => { vars[`--chart-${i + 1}`] = colour })
  return vars
}

/**
 * Per-widget accent override. Returns the CSS variables to set on a widget, or
 * undefined so React leaves the element's style alone when nothing is set.
 *
 * A widget accent recolours that widget's charts and value, letting one
 * critical KPI stand apart from the rest of the dashboard.
 */
export function widgetAccentVars(accent, mode = 'light') {
  if (!isValidHex(accent)) return undefined
  const dark = mode === 'dark'
  const surface = dark ? '#161b22' : '#ffffff'
  const readable = ensureReadable(normaliseHex(accent), surface)

  return {
    '--primary': readable,
    '--primary-strong': shift(readable, dark ? 0.15 : -0.18),
    '--primary-soft': withAlpha(readable, dark ? 0.16 : 0.12),
    // charts in this widget lead with the override, then fall back to the
    // dashboard palette for any additional series
    '--chart-1': readable,
  }
}

/** True when the theme is just the default — used to hide a "reset" button. */
export function isDefaultTheme(theme) {
  if (!theme) return true
  return (!theme.preset || theme.preset === DEFAULT_PRESET)
    && !theme.accent && !theme.charts?.length
}
