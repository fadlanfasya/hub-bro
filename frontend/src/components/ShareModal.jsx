import { useState } from 'react'
import { X, Copy, Check, Monitor, Link2, AlertTriangle } from 'lucide-react'
import { dashboards } from '../api'

export default function ShareModal({ dashboard, onChange, onClose }) {
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState('')
  const token = dashboard.share_token

  const shareUrl = token ? `${window.location.origin}/shared/${token}` : ''
  const kioskUrl = token ? `${shareUrl}?kiosk=1&refresh=60` : ''

  const enable = async () => {
    setBusy(true)
    const res = await dashboards.share(dashboard.id)
    onChange(res.data)
    setBusy(false)
  }

  const disable = async () => {
    if (!confirm('Revoke the link? Anyone using it will lose access immediately.')) return
    setBusy(true)
    const res = await dashboards.unshare(dashboard.id)
    onChange(res.data)
    setBusy(false)
  }

  const copy = async (value, which) => {
    await navigator.clipboard.writeText(value)
    setCopied(which)
    setTimeout(() => setCopied(''), 1800)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="card modal" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h3 style={{ margin: 0, flex: 1 }}>Share “{dashboard.name}”</h3>
          <button className="ghost icon" aria-label="Close" onClick={onClose}><X size={16} /></button>
        </div>

        {!token ? (
          <>
            <p className="muted" style={{ marginTop: 12 }}>
              Create a link that shows this dashboard read-only — no login required.
              Viewers see the data but cannot edit anything or reach your other sources.
            </p>
            <div className="notice">
              <AlertTriangle size={14} />
              <span>Anyone with the link can view it, so treat it as public.</span>
            </div>
            <div className="modal-footer">
              <button className="secondary" onClick={onClose}>Cancel</button>
              <button onClick={enable} disabled={busy}>
                <Link2 size={14} /> Create link
              </button>
            </div>
          </>
        ) : (
          <>
            <label>Read-only link</label>
            <div className="field-row">
              <input readOnly value={shareUrl} onFocus={(e) => e.target.select()} />
              <button className="secondary" onClick={() => copy(shareUrl, 'share')}>
                {copied === 'share' ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>

            <label>Kiosk / TV link <span className="optional">— no chrome, refreshes every 60s</span></label>
            <div className="field-row">
              <input readOnly value={kioskUrl} onFocus={(e) => e.target.select()} />
              <button className="secondary" onClick={() => copy(kioskUrl, 'kiosk')}>
                {copied === 'kiosk' ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>
            <p className="hint">
              Change <code>refresh=60</code> to set a different interval in seconds.
            </p>

            <div className="modal-footer">
              <button className="danger secondary" onClick={disable} disabled={busy}>
                Revoke link
              </button>
              <a href={kioskUrl} target="_blank" rel="noreferrer">
                <button type="button" className="secondary"><Monitor size={14} /> Open kiosk view</button>
              </a>
              <button onClick={onClose}>Done</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
