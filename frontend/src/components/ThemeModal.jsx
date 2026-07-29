import { useState } from 'react'
import { X, Check, RotateCcw, AlertCircle } from 'lucide-react'
import {
  DEFAULT_PRESET, PRESETS, contrastRatio, isDefaultTheme, isValidHex,
  normaliseHex, resolveTheme,
} from '../theme'
import { useTheme } from '../useTheme'

export default function ThemeModal({ theme, onChange, onClose }) {
  const [mode] = useTheme()
  const [draft, setDraft] = useState(theme || { preset: DEFAULT_PRESET })
  const isDark = mode === 'dark'

  const resolved = resolveTheme(draft, isDark ? 'dark' : 'light')
  const surface = isDark ? '#161b22' : '#ffffff'
  // warn when the raw pick was poor; resolveTheme has already nudged it
  const rawRatio = isValidHex(draft.accent)
    ? contrastRatio(normaliseHex(draft.accent), surface) : null
  const wasAdjusted = rawRatio !== null && rawRatio < 4.5

  const pickPreset = (key) => setDraft({ preset: key })
  const pickAccent = (value) => setDraft((d) => ({ ...d, accent: value }))

  const apply = () => {
    onChange(isDefaultTheme(draft) ? undefined : draft)
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="card modal" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h3 style={{ margin: 0, flex: 1 }}>Dashboard theme</h3>
          <button className="ghost icon" aria-label="Close" onClick={onClose}><X size={16} /></button>
        </div>
        <p className="muted" style={{ marginTop: 4 }}>
          Applies to this dashboard only, including its share and kiosk links.
        </p>

        <label>Palette</label>
        <div className="preset-grid">
          {Object.entries(PRESETS).map(([key, preset]) => {
            const active = !draft.accent && (draft.preset || DEFAULT_PRESET) === key
            return (
              <button key={key} type="button"
                className={active ? 'preset on' : 'preset'}
                onClick={() => pickPreset(key)}>
                <span className="preset-swatches">
                  {(isDark ? preset.chartsDark : preset.charts).slice(0, 4).map((c) => (
                    <span key={c} style={{ background: c }} />
                  ))}
                </span>
                <span className="preset-label">
                  {preset.label}
                  {active && <Check size={13} />}
                </span>
              </button>
            )
          })}
        </div>

        <label>Custom accent <span className="optional">(overrides the palette's accent)</span></label>
        <div className="field-row">
          <input type="color" style={{ width: 52, padding: 3, height: 38 }}
            value={isValidHex(draft.accent) ? normaliseHex(draft.accent) : resolved.accent}
            onChange={(e) => pickAccent(e.target.value)} />
          <input value={draft.accent || ''} placeholder="#00694A"
            onChange={(e) => pickAccent(e.target.value)} />
          {draft.accent && (
            <button className="secondary" onClick={() => setDraft((d) => {
              const { accent, ...rest } = d
              return rest
            })}>Clear</button>
          )}
        </div>
        {draft.accent && !isValidHex(draft.accent) && (
          <p className="hint">Enter a hex colour like #0b6bcb.</p>
        )}
        {wasAdjusted && (
          <div className="notice">
            <AlertCircle size={14} />
            <span>
              That colour scored {rawRatio}:1 against the card background, below the
              4.5:1 needed to stay readable. It's been darkened slightly for {isDark ? 'dark' : 'light'} mode.
            </span>
          </div>
        )}

        <label>Preview</label>
        <div className="theme-preview" style={{
          '--primary': resolved.accent,
          '--primary-strong': resolved.accentStrong,
          '--primary-soft': resolved.accentSoft,
        }}>
          <div className="theme-preview-row">
            <button className="small">Primary</button>
            <button className="secondary small">Secondary</button>
            <span className="status-pill ok"><Check size={11} /> Badge</span>
          </div>
          <div className="theme-preview-bars">
            {resolved.charts.map((colour, i) => (
              <span key={i} style={{ background: colour, height: `${100 - i * 12}%` }} />
            ))}
          </div>
        </div>

        <div className="modal-footer">
          {!isDefaultTheme(draft) && (
            <button className="secondary" onClick={() => setDraft({ preset: DEFAULT_PRESET })}>
              <RotateCcw size={14} /> Reset
            </button>
          )}
          <button className="secondary" onClick={onClose}>Cancel</button>
          <button onClick={apply}>Apply theme</button>
        </div>
      </div>
    </div>
  )
}
