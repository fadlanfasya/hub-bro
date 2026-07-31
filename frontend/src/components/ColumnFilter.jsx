import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Filter, Check } from 'lucide-react'
import { distinctValues } from '../tableRules'

const MENU_WIDTH = 230
const MENU_MAX_HEIGHT = 320
const EDGE_GAP = 8

/**
 * Per-column value picker, opened from a funnel icon in the table header.
 *
 * The menu renders into a portal rather than inside the cell: the table body
 * scrolls, and a dropdown nested in a scrolling container gets clipped at its
 * edges. Fixed positioning against the button's own rect also lets the menu
 * flip sides so it never runs off the widget or the viewport.
 *
 * Values come from the rows already on screen, so the list only ever offers
 * things that actually appear — no empty results from picking a value the
 * query never returned.
 */
export default function ColumnFilter({ column, rows, selected = [], onChange }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [position, setPosition] = useState(null)
  const buttonRef = useRef(null)
  const menuRef = useRef(null)

  const { values, truncated } = useMemo(() => distinctValues(rows, column), [rows, column])

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return values
    return values.filter((v) => v.value.toLowerCase().includes(needle))
  }, [values, search])

  // place the menu next to the button, flipping when there isn't room
  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return
    const place = () => {
      const rect = buttonRef.current?.getBoundingClientRect()
      if (!rect) return
      // prefer aligning the menu's right edge to the button, but fall back to
      // left-aligned when that would push it off the left of the screen
      let left = rect.right - MENU_WIDTH
      if (left < EDGE_GAP) left = rect.left
      left = Math.min(left, window.innerWidth - MENU_WIDTH - EDGE_GAP)
      left = Math.max(EDGE_GAP, left)

      // open upward if there isn't room below
      const below = window.innerHeight - rect.bottom
      const openUp = below < 200 && rect.top > below
      setPosition({
        left,
        top: openUp ? undefined : rect.bottom + 4,
        bottom: openUp ? window.innerHeight - rect.top + 4 : undefined,
        maxHeight: Math.min(MENU_MAX_HEIGHT, (openUp ? rect.top : below) - EDGE_GAP * 2),
      })
    }
    place()
    // the table scrolls under the menu, so follow the button or close
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const close = (e) => {
      if (buttonRef.current?.contains(e.target) || menuRef.current?.contains(e.target)) return
      setOpen(false)
    }
    const esc = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  const toggle = (value) => {
    onChange(selected.includes(value)
      ? selected.filter((v) => v !== value)
      : [...selected, value])
  }

  const active = selected.length > 0

  return (
    <span className="column-filter no-export">
      <button type="button" ref={buttonRef}
        className={active ? 'ghost small icon on' : 'ghost small icon'}
        aria-label={`Filter ${column}`}
        aria-expanded={open}
        title={active ? `${selected.length} selected` : `Filter ${column}`}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v) }}>
        <Filter size={11} />
      </button>

      {open && position && createPortal(
        <div ref={menuRef} className="column-filter-menu"
          style={{
            left: position.left,
            top: position.top,
            bottom: position.bottom,
            width: MENU_WIDTH,
          }}
          onClick={(e) => e.stopPropagation()}>
          <div className="column-filter-head">{column}</div>

          <input autoFocus value={search} placeholder="Search values"
            onChange={(e) => setSearch(e.target.value)} />

          <div className="column-filter-actions">
            <button type="button" className="link"
              onClick={() => onChange(shown.map((v) => v.value))}>
              Select all
            </button>
            {active && (
              <button type="button" className="link" onClick={() => onChange([])}>
                Clear
              </button>
            )}
          </div>

          <div className="column-filter-values"
            style={{ maxHeight: Math.max(120, (position.maxHeight || MENU_MAX_HEIGHT) - 130) }}>
            {shown.length === 0 && (
              <p className="muted" style={{ padding: '6px 8px', margin: 0 }}>No matches.</p>
            )}
            {shown.map(({ value, count }) => (
              <button type="button" key={value} className="column-filter-value"
                onClick={() => toggle(value)}>
                <span className={selected.includes(value) ? 'tick on' : 'tick'}>
                  {selected.includes(value) && <Check size={11} />}
                </span>
                <span className="column-filter-label" title={value || '(empty)'}>
                  {value === '' ? '(empty)' : value}
                </span>
                <span className="column-filter-count">{count}</span>
              </button>
            ))}
          </div>

          {truncated && (
            <p className="hint" style={{ padding: '4px 8px 0', margin: 0 }}>
              First 200 values — search to narrow.
            </p>
          )}
        </div>,
        document.body
      )}
    </span>
  )
}
