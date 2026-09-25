import { useEffect, useRef, useState } from 'react'
import { Eye, RefreshCw, X } from 'lucide-react'
import { data as dataApi } from '../api'
import { buildOptions } from '../widgetData'
import WidgetRenderer from './WidgetRenderer'
import { useModalMotion } from '../useModalMotion'

/**
 * Dedicated large preview for the widget being configured.
 *
 * Fetches the draft widget's data once on open (manual refresh after that) and
 * renders through the real WidgetRenderer — so what you see is exactly what the
 * dashboard will show. The draft is passed live from the config modal, so edits
 * made between previews are picked up on the next open.
 *
 * `docked` puts the panel beside the config form as a sibling flex item rather
 * than over it. Configuring a widget is a loop of change-a-field, look-at-the-
 * result; a preview that covers the field you just changed makes you close it to
 * take the next step. Undocked it still works as a standalone slide-in.
 */
export default function WidgetPreviewModal({ widget, sources, onClose, docked = false }) {
  const { overlayRef, boxRef, requestClose } = useModalMotion(onClose, 'slide')
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const seq = useRef(0)

  const source = sources.find((s) => s.id === Number(widget.datasource_id))
  const canFetch = Boolean(widget.datasource_id) && (
    ['rest', 'glpi', 'truewatch'].includes(source?.type)
    || (source?.type === 'sql' && widget.options?.query?.trim())
    || (source?.type === 'prometheus'
      && (widget.options?.query?.trim() || widget.options?.queries?.some((q) => q.query?.trim())))
  )

  const fetchNow = () => {
    const seqAtStart = ++seq.current
    setLoading(true)
    dataApi.fetch(widget.datasource_id, buildOptions(widget, undefined, undefined))
      .then((res) => {
        if (seq.current !== seqAtStart) return   // a newer fetch superseded this one
        setResult(res.data)
        setError('')
        setLoading(false)
      })
      .catch((err) => {
        if (seq.current !== seqAtStart) return
        // Surface the server's message — a bad SQL query or wrong itemtype
        // should say so here, not only after the widget is saved.
        setError(err.response?.data?.detail || 'Failed to load preview')
        setResult(null)
        setLoading(false)
      })
  }

  // Fetch once on open.
  useEffect(() => {
    if (canFetch) fetchNow()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Escape closes; nothing else — the config modal underneath stays untouched.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') requestClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [requestClose])

  let body
  if (!source) {
    body = <p className="muted" style={{ padding: 24 }}>Select a data source in the widget form first.</p>
  } else if (!canFetch) {
    body = <p className="muted" style={{ padding: 24 }}>Enter a query in the widget form first — then open the preview again.</p>
  } else if (error) {
    body = <div className="widget-preview-error">{error}</div>
  } else if (result) {
    body = <div className="widget-preview-body"><WidgetRenderer widget={widget} data={result} /></div>
  } else {
    body = <div className="widget-preview-body muted" style={{ padding: 24 }}>Loading…</div>
  }

  const panel = (
    <section
      className={docked ? 'preview-panel docked' : 'preview-panel'}
      ref={boxRef}
      style={{ animation: 'none' }}
      onClick={(e) => e.stopPropagation()}
      role="dialog"
      // Docked, it sits alongside the form rather than trapping focus over it,
      // so claiming to be modal would tell a screen reader the opposite of what
      // is true — the form behind is still reachable, and should be.
      aria-modal={docked ? undefined : 'true'}
      aria-label={`Preview of ${widget.title || 'widget'}`}
    >
      <header className="preview-panel-head">
        <div className="preview-panel-title">
          <Eye size={16} />
          <strong>{widget.title || 'Untitled'}</strong>
          <span className="preview-panel-meta">
            {source ? `${source.name} · ${source.type}` : 'no data source yet'}
            {widget.type ? ` · ${widget.type}` : ''}
          </span>
        </div>
        {canFetch && (
          <button type="button" className="secondary small" onClick={fetchNow}>
            <RefreshCw size={13} /> Refresh
          </button>
        )}
        <button type="button" className="ghost icon" aria-label="Close preview" onClick={requestClose}>
          <X size={16} />
        </button>
      </header>
      <div className="preview-panel-body">{body}</div>
      <footer className="preview-panel-foot">
        <span className="hint" style={{ margin: 0 }}>
          This is exactly how the widget will render on the dashboard.
        </span>
      </footer>
    </section>
  )

  // The wrapper carries overlayRef either way, so the motion hook always has
  // both of its targets — docked it is a transparent flex item, undocked it is
  // the dimming backdrop.
  if (docked) {
    return (
      <div className="preview-dock" ref={overlayRef} onClick={(e) => e.stopPropagation()}>
        {panel}
      </div>
    )
  }

  return (
    <div className="preview-overlay" ref={overlayRef} style={{ animation: 'none' }} onClick={requestClose}>
      {panel}
    </div>
  )
}
