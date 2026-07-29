import { useEffect, useRef, useState } from 'react'
import { Download, FileText, Image, Loader2 } from 'lucide-react'

/**
 * Small dropdown of export actions. `actions` is
 * [{ key, label, Icon, run }] — `run` may be async.
 */
export default function ExportMenu({ actions, label = 'Export', compact = false }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
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
    <div className="export-menu no-export" ref={ref}>
      <button
        className={compact ? 'ghost small icon' : 'secondary small'}
        aria-haspopup="menu"
        aria-expanded={open}
        title={label}
        onClick={() => setOpen((v) => !v)}
      >
        <Download size={compact ? 13 : 13} />{!compact && ` ${label}`}
      </button>

      {open && (
        <div className="export-dropdown" role="menu">
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
        </div>
      )}
    </div>
  )
}

export { FileText, Image }
