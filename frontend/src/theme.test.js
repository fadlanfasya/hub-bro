import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PRESET, PRESETS, contrastRatio, ensureReadable, isDefaultTheme,
  isValidHex, luminance, normaliseHex, onColor, resolveTheme, shift, themeToCssVars,
  widgetAccentVars, withAlpha,
} from './theme'

const LIGHT_SURFACE = '#ffffff'
const DARK_SURFACE = '#161b22'

describe('isValidHex / normaliseHex', () => {
  it('accepts 3 and 6 digit hex', () => {
    expect(isValidHex('#abc')).toBe(true)
    expect(isValidHex('#00694A')).toBe(true)
  })

  it('rejects anything else', () => {
    expect(isValidHex('red')).toBe(false)
    expect(isValidHex('#12345')).toBe(false)
    expect(isValidHex('')).toBe(false)
    expect(isValidHex(null)).toBe(false)
    expect(isValidHex('#gggggg')).toBe(false)
  })

  it('expands shorthand and lowercases', () => {
    expect(normaliseHex('#ABC')).toBe('#aabbcc')
    expect(normaliseHex('#00694A')).toBe('#00694a')
  })

  it('returns null for invalid input', () => {
    expect(normaliseHex('nope')).toBeNull()
  })
})

describe('contrastRatio', () => {
  it('gives 21 for black on white', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBe(21)
  })

  it('gives 1 for identical colours', () => {
    expect(contrastRatio('#123456', '#123456')).toBe(1)
  })

  it('is order independent', () => {
    expect(contrastRatio('#00694a', '#ffffff')).toBe(contrastRatio('#ffffff', '#00694a'))
  })

  it('rates the brand green as readable on white', () => {
    expect(contrastRatio('#00694a', LIGHT_SURFACE)).toBeGreaterThan(4.5)
  })
})

describe('luminance', () => {
  it('runs from 0 for black to 1 for white', () => {
    expect(luminance('#000000')).toBe(0)
    expect(luminance('#ffffff')).toBeCloseTo(1)
  })
})

describe('shift', () => {
  it('lightens toward white and darkens toward black', () => {
    expect(luminance(shift('#808080', 0.5))).toBeGreaterThan(luminance('#808080'))
    expect(luminance(shift('#808080', -0.5))).toBeLessThan(luminance('#808080'))
  })

  it('clamps at the extremes', () => {
    expect(shift('#ffffff', 1)).toBe('#ffffff')
    expect(shift('#000000', -1)).toBe('#000000')
  })

  it('leaves invalid colours alone', () => {
    expect(shift('nope', 0.2)).toBe('nope')
  })
})

describe('withAlpha', () => {
  it('produces an rgba string', () => {
    expect(withAlpha('#00694a', 0.12)).toBe('rgba(0, 105, 74, 0.12)')
  })
})

describe('ensureReadable', () => {
  it('leaves an already-readable colour untouched', () => {
    expect(ensureReadable('#00694a', LIGHT_SURFACE)).toBe('#00694a')
  })

  it('darkens a pale colour until it passes on white', () => {
    const fixed = ensureReadable('#ffe680', LIGHT_SURFACE)
    expect(contrastRatio(fixed, LIGHT_SURFACE)).toBeGreaterThanOrEqual(4.5)
  })

  it('lightens a dark colour until it passes on a dark surface', () => {
    const fixed = ensureReadable('#0a2a1e', DARK_SURFACE)
    expect(contrastRatio(fixed, DARK_SURFACE)).toBeGreaterThanOrEqual(4.5)
  })

  it('handles pure white on white without looping forever', () => {
    const fixed = ensureReadable('#ffffff', LIGHT_SURFACE)
    expect(isValidHex(fixed)).toBe(true)
  })
})

describe('resolveTheme', () => {
  it('falls back to the default preset', () => {
    expect(resolveTheme(undefined, 'light').accent).toBe(PRESETS[DEFAULT_PRESET].accent)
    expect(resolveTheme({ preset: 'nonexistent' }, 'light').accent)
      .toBe(PRESETS[DEFAULT_PRESET].accent)
  })

  it('uses the dark variant in dark mode', () => {
    expect(resolveTheme({ preset: 'ocean' }, 'dark').accent).toBe(PRESETS.ocean.accentDark)
  })

  it('lets a custom accent override the preset', () => {
    expect(resolveTheme({ preset: 'ocean', accent: '#6d28d9' }, 'light').accent).toBe('#6d28d9')
  })

  it('ignores an invalid custom accent', () => {
    expect(resolveTheme({ accent: 'blurple' }, 'light').accent).toBe(PRESETS[DEFAULT_PRESET].accent)
  })

  it('always returns a readable accent', () => {
    const light = resolveTheme({ accent: '#fffbe0' }, 'light')
    expect(contrastRatio(light.accent, LIGHT_SURFACE)).toBeGreaterThanOrEqual(4.5)
    const dark = resolveTheme({ accent: '#050505' }, 'dark')
    expect(contrastRatio(dark.accent, DARK_SURFACE)).toBeGreaterThanOrEqual(4.5)
  })

  it('derives strong and soft variants', () => {
    const t = resolveTheme({ preset: 'violet' }, 'light')
    expect(isValidHex(t.accentStrong)).toBe(true)
    expect(t.accentSoft).toContain('rgba(')
  })

  it('provides six chart colours for every preset', () => {
    for (const key of Object.keys(PRESETS)) {
      expect(resolveTheme({ preset: key }, 'light').charts).toHaveLength(6)
      expect(resolveTheme({ preset: key }, 'dark').charts).toHaveLength(6)
    }
  })

  it('accepts a custom chart palette', () => {
    const t = resolveTheme({ charts: ['#111111', '#222222'] }, 'light')
    expect(t.charts).toEqual(['#111111', '#222222'])
  })

  it('drops invalid entries from a custom palette', () => {
    expect(resolveTheme({ charts: ['#111111', 'oops'] }, 'light').charts).toEqual(['#111111'])
  })
})

describe('themeToCssVars', () => {
  it('maps onto the variables the app already uses', () => {
    const vars = themeToCssVars({ preset: 'ocean' }, 'light')
    expect(vars['--primary']).toBe(PRESETS.ocean.accent)
    expect(vars['--chart-1']).toBe(PRESETS.ocean.charts[0])
    expect(vars['--chart-6']).toBe(PRESETS.ocean.charts[5])
  })

  it('includes the soft and strong variants', () => {
    const vars = themeToCssVars({}, 'light')
    expect(vars).toHaveProperty('--primary-strong')
    expect(vars).toHaveProperty('--primary-soft')
  })
})

describe('widgetAccentVars', () => {
  it('returns undefined when no accent is set, so style is left alone', () => {
    expect(widgetAccentVars(undefined)).toBeUndefined()
    expect(widgetAccentVars('')).toBeUndefined()
    expect(widgetAccentVars('not-a-colour')).toBeUndefined()
  })

  it('overrides the primary and the first chart colour', () => {
    const vars = widgetAccentVars('#db2777', 'light')
    expect(vars['--primary']).toBe('#db2777')
    expect(vars['--chart-1']).toBe('#db2777')
  })

  it('keeps a widget accent readable too', () => {
    const vars = widgetAccentVars('#fffde0', 'light')
    expect(contrastRatio(vars['--primary'], LIGHT_SURFACE)).toBeGreaterThanOrEqual(4.5)
  })
})

describe('onColor', () => {
  it('picks white on dark fills and black on light ones', () => {
    expect(onColor('#00694a')).toBe('#ffffff')
    expect(onColor('#111418')).toBe('#ffffff')
    expect(onColor('#fde047')).toBe('#111418')
    expect(onColor('#ffffff')).toBe('#111418')
  })

  it('always returns a readable pairing', () => {
    for (const fill of ['#00694a', '#e9b452', '#6d28d9', '#fde047', '#334155', '#f85149']) {
      expect(contrastRatio(onColor(fill), fill), fill).toBeGreaterThanOrEqual(4.5)
    }
  })
})

describe('widgetAccentVars backgrounds', () => {
  it('sets no background by default', () => {
    const vars = widgetAccentVars('#00694a', 'light')
    expect(vars).not.toHaveProperty('--widget-bg')
  })

  it('tints the card in soft mode', () => {
    const vars = widgetAccentVars('#00694a', 'light', 'soft')
    expect(vars['--widget-bg']).toContain('rgba')
    expect(vars).not.toHaveProperty('--widget-ink')   // text stays as normal
  })

  it('fills the card and flips the text in solid mode', () => {
    const vars = widgetAccentVars('#00694a', 'light', 'solid')
    expect(vars['--widget-bg']).toBe('#00694a')
    expect(vars['--widget-ink']).toBe('#ffffff')
  })

  it('uses dark text on a pale solid fill', () => {
    const vars = widgetAccentVars('#fde047', 'light', 'solid')
    expect(vars['--widget-ink']).toBe('#111418')
    expect(contrastRatio(vars['--widget-ink'], vars['--widget-bg']))
      .toBeGreaterThanOrEqual(4.5)
  })

  it('honours the chosen colour on a solid fill rather than correcting it', () => {
    // on a filled card it's the text that adapts, so a pale accent stays pale
    expect(widgetAccentVars('#fde047', 'light', 'solid')['--widget-bg']).toBe('#fde047')
    // but as a value colour on white it still gets darkened to stay readable
    expect(widgetAccentVars('#fde047', 'light')['--primary']).not.toBe('#fde047')
  })

  it('returns undefined without an accent, whatever the background', () => {
    expect(widgetAccentVars('', 'light', 'solid')).toBeUndefined()
  })
})

describe('isDefaultTheme', () => {
  it('treats missing and default-preset themes as default', () => {
    expect(isDefaultTheme(undefined)).toBe(true)
    expect(isDefaultTheme({})).toBe(true)
    expect(isDefaultTheme({ preset: DEFAULT_PRESET })).toBe(true)
  })

  it('detects a customised theme', () => {
    expect(isDefaultTheme({ preset: 'ocean' })).toBe(false)
    expect(isDefaultTheme({ accent: '#123456' })).toBe(false)
    expect(isDefaultTheme({ charts: ['#123456'] })).toBe(false)
  })
})

describe('preset integrity', () => {
  it('every preset accent is readable in its own mode', () => {
    for (const [key, preset] of Object.entries(PRESETS)) {
      expect(contrastRatio(preset.accent, LIGHT_SURFACE),
        `${key} light accent`).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(preset.accentDark, DARK_SURFACE),
        `${key} dark accent`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('every preset colour is valid hex', () => {
    for (const preset of Object.values(PRESETS)) {
      for (const c of [...preset.charts, ...preset.chartsDark, preset.accent, preset.accentDark]) {
        expect(isValidHex(c)).toBe(true)
      }
    }
  })

  it('chart colours within a preset are distinct', () => {
    for (const [key, preset] of Object.entries(PRESETS)) {
      expect(new Set(preset.charts).size, `${key} light`).toBe(preset.charts.length)
      expect(new Set(preset.chartsDark).size, `${key} dark`).toBe(preset.chartsDark.length)
    }
  })
})
