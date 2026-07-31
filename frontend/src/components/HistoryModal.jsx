import { useEffect, useState } from 'react'
import { X, RotateCcw, History, Loader2, AlertCircle, User } from 'lucide-react'
import { dashboards } from '../api'

/** Relative time that stays readable without pulling in a date library. */
function timeAgo(iso) {
  if (!iso) return ''
  // timestamps come from the server as naive UTC
  const then = new Date(/[Zz+]|\d{2}:\d{2}$/.test(iso) ? iso : `${iso}Z`)
  const seconds = Math.max(0, (Date.now() - then.getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const units = [
    ['minute', 60], ['hour', 3600], ['day', 86400], ['week', 604800],
  ]
  let label = 'a while ago'
  for (let i = units.length - 1; i >= 0; i -= 1) {
    const [name, size] = units[i]
    if (seconds >= size) {
      const n = Math.floor(seconds / size)
      label = `${n} ${name}${n === 1 ? '' : 's'} ago`
      break
    }
  }
  return label
}

export default function HistoryModal({ dashboardId, onRestored, onClose }) {
  const [items, setItems] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(null)

  useEffect(() => {
    dashboards.history(dashboardId)
      .then((res) => setItems(res.data))
      .catch((err) => setError(err.response?.data?.detail || 'Could not load history'))
  }, [dashboardId])

  const restore = async (snapshot) => {
    const when = timeAgo(snapshot.created_at)
    if (!confirm(`Restore the version from ${when}? Your current layout is saved to history first, so this can be undone.`)) return
    setBusy(snapshot.id)
    setError('')
    try {
      const res = await dashboards.restore(dashboardId, snapshot.id)
      onRestored(res.data)
      onClose()
    } catch (err) {
      setError(err.response?.data?.detail || 'Restore failed')
      setBusy(null)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="card modal" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h3 style={{ margin: 0, flex: 1 }}>
            <History size={16} style={{ verticalAlign: '-3px', marginRight: 6 }} />
            Version history
          </h3>
          <button className="ghost icon" aria-label="Close" onClick={onClose}><X size={16} /></button>
        </div>
        <p className="muted" style={{ marginTop: 4 }}>
          A copy is kept before every change. Restoring is itself undoable.
        </p>

        {error && <div className="error"><AlertCircle size={14} />{error}</div>}

        {items === null && !error && <p className="muted">Loading…</p>}

        {items?.length === 0 && (
          <div className="empty-state" style={{ padding: 'var(--space-5)' }}>
            <History size={28} />
            <p>No earlier versions yet. One is saved the next time this dashboard changes.</p>
          </div>
        )}

        {items?.length > 0 && (
          <div className="history-list">
            {items.map((s) => (
              <div className="history-item" key={s.id}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="history-when">
                    {timeAgo(s.created_at)}
                    <span className="history-version">v{s.version}</span>
                  </div>
                  <div className="history-meta">
                    <User size={11} />
                    {s.author_email || 'unknown'} · {s.widget_count} widget{s.widget_count === 1 ? '' : 's'}
                    {s.note && ` · ${s.note}`}
                  </div>
                </div>
                <button className="secondary small" disabled={busy !== null}
                  onClick={() => restore(s)}>
                  {busy === s.id ? <Loader2 size={13} className="spin" /> : <RotateCcw size={13} />}
                  Restore
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="modal-footer">
          <button className="secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
