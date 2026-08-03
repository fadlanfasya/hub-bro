import { useCallback, useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { AlertCircle, RefreshCw } from 'lucide-react'
import Logo from '../components/Logo'
import DashboardGrid from '../components/DashboardGrid'
import ThemeScope from '../components/ThemeScope'
import WidgetLink from '../components/WidgetLink'
import { widgetAccentVars } from '../theme'
import { useTheme } from '../useTheme'
import WidgetRenderer, { DataBadge } from '../components/WidgetRenderer'
import { publicApi } from '../api'
import { toGridItems, widgetClass } from '../layout'

/**
 * Read-only view of a shared dashboard. No auth, no editing.
 * `?kiosk=1` drops all chrome for wall displays and auto-refreshes.
 */
export default function PublicDashboard() {
  const { token } = useParams()
  const [params] = useSearchParams()
  const kiosk = params.get('kiosk') === '1'
  const kioskRefresh = Number(params.get('refresh')) || 60

  const [dashboard, setDashboard] = useState(null)
  const [error, setError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const [statuses, setStatuses] = useState({})   // widgetId -> { meta, stale }
  const [mode] = useTheme()

  const captureStatus = useCallback((widgetId, result, status = {}) => {
    setStatuses((prev) => {
      const next = { meta: result?.meta, stale: Boolean(status.stale) }
      const old = prev[widgetId]
      if (old?.stale === next.stale && old?.meta?.partial === next.meta?.partial
        && old?.meta?.fetched === next.meta?.fetched) return prev
      return { ...prev, [widgetId]: next }
    })
  }, [])

  useEffect(() => {
    publicApi.get(token)
      .then((res) => setDashboard(res.data))
      .catch((err) => setError(err.response?.data?.detail || 'This dashboard is not available'))
  }, [token])

  // kiosk displays sit unattended, so refresh everything on a timer
  useEffect(() => {
    if (!kiosk) return
    const id = setInterval(() => setRefreshKey((k) => k + 1), kioskRefresh * 1000)
    return () => clearInterval(id)
  }, [kiosk, kioskRefresh])

  if (error) {
    return (
      <div className="auth-shell">
        <div className="empty-state" style={{ maxWidth: 420 }}>
          <AlertCircle size={32} />
          <p>{error}</p>
        </div>
      </div>
    )
  }
  if (!dashboard) return <div className="page muted">Loading…</div>

  const { widgets = [], layout = [] } = dashboard.definition

  return (
    <div className={kiosk ? 'public-view kiosk' : 'public-view'}>
      {!kiosk && (
        <div className="editor-bar">
          <span className="brand"><Logo size={22} /> Hub-Bro</span>
          <h1>{dashboard.name}</h1>
          <span className="status-pill">Read-only</span>
          <span className="spacer" />
          <button className="secondary small" onClick={() => setRefreshKey((k) => k + 1)}>
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
      )}

      <div className={kiosk ? 'editor-body kiosk-body' : 'editor-body'}>
        {kiosk && <h1 className="kiosk-title">{dashboard.name}</h1>}
        <ThemeScope theme={dashboard.definition?.theme}>
        <DashboardGrid
          items={toGridItems(widgets, layout)}
          readOnly
          renderItem={(item) => (
            <div className={widgetClass(item.widget, false)}
              style={widgetAccentVars(item.widget.options?.accent, mode,
                item.widget.options?.widget_bg)}>
              <div className="widget-header static">
                <span className="title">{item.widget.title}</span>
                <WidgetLink url={item.widget.options?.link}
                  label={item.widget.options?.link_label} />
                <DataBadge meta={statuses[item.widget.id]?.meta}
                  stale={statuses[item.widget.id]?.stale} />
              </div>
              <div className="widget-body">
                <WidgetRenderer widget={item.widget} refreshKey={refreshKey}
                  publicToken={token} onData={captureStatus} />
              </div>
            </div>
          )}
        />
        </ThemeScope>
      </div>
    </div>
  )
}
