import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Download, FileText, Image, Loader2 } from 'lucide-react'

const MENU_WIDTH = 190
const EDGE_GAP = 8

/**
 * Small dropdown of export actions. `actions` is
 * [{ key, label, Icon, run }] — `run` may be async.
 *
 * Renders into a portal rather than inside the widget card: a widget is
 * overflow:hidden (so its own content can't spill past its border), and a
 * dropdown nested inside gets clipped the moment the card is shorter than
 * the menu. Fixed positioning against the button's own rect — the same
 * approach ColumnFilter already uses — keeps it visible regardless of card
 * size, and flips upward when there isn't room below.
 */
export default function ExportMenu({ actions, label = 'Export', compact = false }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [position, setPosition] = useState(null)
  const buttonRef = useRef(null)
  const menuRef = useRef(null)

  // place the menu next to the button, flipping when there isn't room below
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const rect = buttonRef.current?.getBoundingClientRect()
      if (!rect) return
      let left = rect.right - MENU_WIDTH
      left = Math.min(left, window.innerWidth - MENU_WIDTH - EDGE_GAP)
      left = Math.max(EDGE_GAP, left)

      const below = window.innerHeight - rect.bottom
      const openUp = below < 160 && rect.top > below
      setPosition({
        left,
        top: openUp ? undefined : rect.bottom + 6,
        bottom: openUp ? window.innerHeight - rect.top + 6 : undefined,
      })
    }
    place()
    // the widget (and the page) can scroll under the menu, so follow the
    // button or close
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

  const run = async (action) => {
    setBusy(action.key)
    setError('')
    try {
      await action.run()
      setOpen(false)
    } catch (e) {
      setError(e?.message || 'Export failed')
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="export-menu no-export">
      <button
        ref={buttonRef}
        className={compact ? 'ghost small icon' : 'secondary small'}
        aria-haspopup="menu"
        aria-expanded={open}
        title={label}
        onClick={() => setOpen((v) => !v)}
      >
        <Download size={compact ? 13 : 13} />{!compact && ` ${label}`}
      </button>

      {open && position && createPortal(
        <div ref={menuRef} className="export-dropdown" role="menu"
          style={{ left: position.left, top: position.top, bottom: position.bottom, width: MENU_WIDTH }}>
          {actions.map((a) => (
            <button key={a.key} role="menuitem" className="export-item"
              disabled={Boolean(busy)} onClick={() => run(a)}>
              {busy === a.key
                ? <Loader2 size={13} className="spin" />
                : <a.Icon size={13} />}
              {a.label}
            </button>
          ))}
          {error && <div className="export-error">{error}</div>}
        </div>,
        document.body
      )}
    </div>
  )
}

export { FileText, Image }
