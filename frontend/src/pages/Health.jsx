import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Activity, RefreshCw, Loader2, AlertCircle, CheckCircle2, HelpCircle, Clock,
  Globe, FileSpreadsheet, Server, Table2,
} from 'lucide-react'
import { datasources } from '../api'

const TYPE_ICONS = {
  rest: Globe, csv: FileSpreadsheet, prometheus: Activity, glpi: Server, sql: Table2,
}

const STATUS = {
  ok: { label: 'Reachable', Icon: CheckCircle2, tone: 'ok' },
  failing: { label: 'Failing', Icon: AlertCircle, tone: 'error' },
  stale: { label: 'Not checked recently', Icon: Clock, tone: 'warn' },
  unknown: { label: 'Not checked yet', Icon: HelpCircle, tone: '' },
}

function timeAgo(iso) {
  if (!iso) return 'never'
  const then = new Date(/[Zz+]|\d{2}:\d{2}$/.test(iso) ? iso : `${iso}Z`)
  const seconds = Math.max(0, (Date.now() - then.getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const units = [['minute', 60], ['hour', 3600], ['day', 86400]]
  for (let i = units.length - 1; i >= 0; i -= 1) {
    const [name, size] = units[i]
    if (seconds >= size) {
      const n = Math.floor(seconds / size)
      return `${n} ${name}${n === 1 ? '' : 's'} ago`
    }
  }
  return 'just now'
}

/** Tiny bar chart of recent response times, green for ok and red for failed. */
function Sparkline({ recent }) {
  if (!recent?.length) return null
  const max = Math.max(...recent.map((r) => r.duration_ms || 0), 1)
  return (
    <div className="sparkline" title="Recent checks, oldest first">
      {recent.map((r, i) => (
        <span key={i}
          className={r.ok ? 'spark ok' : 'spark bad'}
          style={{ height: `${Math.max(12, ((r.duration_ms || 0) / max) * 100)}%` }}
          title={r.ok ? `${r.duration_ms} ms` : 'failed'} />
      ))}
    </div>
  )
}

export default function Health() {
  const [items, setItems] = useState(null)
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(null)

  const load = useCallback(() => datasources.health()
    .then((res) => setItems(res.data))
    .catch((err) => setError(err.response?.data?.detail || 'Could not load health')), [])

  useEffect(() => { load() }, [load])

  // the page is a status board, so keep it current without a manual refresh
  useEffect(() => {
    const id = setInterval(load, 30000)
    return () => clearInterval(id)
  }, [load])

  const checkOne = async (id) => {
    setChecking(id)
    try {
      await datasources.check(id)
      await load()
    } catch (err) {
      setError(err.response?.data?.detail || 'Check failed')
    } finally {
      setChecking(null)
    }
  }

  const failing = items?.filter((i) => i.status === 'failing').length || 0

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Data source health</h1>
          <p className="page-subtitle">
            {items === null ? 'Loading…'
              : failing > 0
                ? `${failing} source${failing === 1 ? '' : 's'} failing`
                : 'All sources reachable'}
          </p>
        </div>
        <span className="spacer" />
        <button className="secondary small" onClick={load}>
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {error && <div className="error" style={{ marginBottom: 16 }}><AlertCircle size={14} />{error}</div>}

      {items?.length === 0 && (
        <div className="empty-state">
          <Activity size={32} />
          <p>No data sources configured yet.</p>
        </div>
      )}

      <div className="grid-cards">
        {items?.map((s) => {
          const meta = STATUS[s.status] || STATUS.unknown
          const TypeIcon = TYPE_ICONS[s.type] || Globe
          return (
            <div className="card health-card" key={s.id}>
              <div className="head">
                <span className={`type-icon status-${s.status}`}><TypeIcon size={17} /></span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="name">{s.name}</div>
                  <div className="type">{s.type}</div>
                </div>
                <span className={`status-pill ${meta.tone}`}>
                  <meta.Icon size={11} /> {meta.label}
                </span>
              </div>

              <dl className="health-facts">
                <div>
                  <dt>Last success</dt>
                  <dd>{timeAgo(s.last_ok_at)}</dd>
                </div>
                <div>
                  <dt>Response</dt>
                  <dd>
                    {s.duration_ms != null ? `${s.duration_ms} ms` : '—'}
                    {s.avg_duration_ms != null && s.recent?.length > 2 && (
                      <span className="muted"> (avg {s.avg_duration_ms})</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Monitoring</dt>
                  <dd>{s.monitored ? 'On a timer' : 'On use only'}</dd>
                </div>
              </dl>

              <Sparkline recent={s.recent} />

              {s.last_error && s.status !== 'ok' && (
                <div className="health-error" title={s.last_error}>
                  <AlertCircle size={12} />
                  <span>{s.last_error}</span>
                </div>
              )}

              {s.dashboards?.length > 0 && (
                <div className="health-deps">
                  Used by{' '}
                  {s.dashboards.map((d, i) => (
                    <span key={d.dashboard_id}>
                      {i > 0 && ', '}
                      <Link to={`/dashboards/${d.dashboard_id}`}>{d.name}</Link>
                      <span className="muted"> ({d.widget_count})</span>
                    </span>
                  ))}
                </div>
              )}
              {s.dashboards?.length === 0 && (
                <div className="health-deps muted">Not used by any dashboard.</div>
              )}

              <div className="actions">
                <button className="secondary small" disabled={checking === s.id}
                  onClick={() => checkOne(s.id)}>
                  {checking === s.id ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />}
                  Check now
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
