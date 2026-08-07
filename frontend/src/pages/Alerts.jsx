import { useEffect, useState } from 'react'
import {
  Bell, BellOff, Plus, Trash2, Pencil, Send, Play, X, CheckCircle2, AlertTriangle, HelpCircle,
} from 'lucide-react'
import { alerts as alertsApi, datasources } from '../api'
import SecretField from '../components/SecretField'
import { useAuth } from '../useAuth'

const MASK = '••••••••'

const STATE_LABELS = {
  ok: 'OK', warn: 'Warning', critical: 'Critical', error: 'Unreachable', unknown: 'Not yet checked',
}
const STATE_TONE = {
  ok: 'ok', warn: 'warn', critical: 'bad', error: 'bad', unknown: '',
}

const blank = {
  name: '',
  datasource_id: '',
  query: '',
  value_field: '',
  aggregate: 'first',
  direction: 'above',
  warn: '',
  critical: '',
  interval_seconds: 300,
  for_evaluations: 2,
  repeat_minutes: 0,
  notify_on_recovery: true,
  format: 'slack',
  enabled: true,
}

function timeAgo(iso) {
  if (!iso) return 'never'
  const secs = Math.max(0, (Date.now() - new Date(iso + (iso.endsWith('Z') ? '' : 'Z')).getTime()) / 1000)
  if (secs < 60) return 'just now'
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  return `${Math.floor(secs / 86400)}d ago`
}

export default function Alerts() {
  const { can } = useAuth()
  const canEdit = can('alert.edit')
  const [rules, setRules] = useState([])
  const [sources, setSources] = useState([])
  const [form, setForm] = useState(blank)
  const [webhookUrl, setWebhookUrl] = useState('')
  const [hasStoredUrl, setHasStoredUrl] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(null)
  const [expanded, setExpanded] = useState(null)
  const [history, setHistory] = useState([])

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const load = () => alertsApi.list().then((r) => setRules(r.data))
  useEffect(() => {
    load()
    if (canEdit) datasources.list().then((r) => setSources(r.data)).catch(() => {})
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, [canEdit])

  const reset = () => {
    setForm(blank); setWebhookUrl(''); setHasStoredUrl(false)
    setEditingId(null); setShowForm(false); setError('')
  }

  const startEdit = (rule) => {
    setEditingId(rule.id)
    setForm({
      name: rule.name,
      datasource_id: rule.datasource_id,
      query: rule.options?.query || '',
      value_field: rule.value_field || '',
      aggregate: rule.aggregate || 'first',
      direction: rule.thresholds?.direction || 'above',
      warn: rule.thresholds?.warn ?? '',
      critical: rule.thresholds?.critical ?? '',
      interval_seconds: rule.interval_seconds,
      for_evaluations: rule.for_evaluations,
      repeat_minutes: rule.repeat_minutes,
      notify_on_recovery: rule.notify_on_recovery,
      format: rule.webhook?.format || 'slack',
      enabled: rule.enabled,
    })
    // the URL is a credential and comes back masked — untouched means keep it
    setHasStoredUrl(Boolean(rule.webhook?.url))
    setWebhookUrl(rule.webhook?.url ? null : '')
    setShowForm(true)
    setError('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const payload = () => ({
    name: form.name,
    datasource_id: Number(form.datasource_id),
    options: form.query ? { query: form.query } : {},
    value_field: form.value_field || null,
    aggregate: form.aggregate,
    thresholds: {
      direction: form.direction,
      warn: form.warn === '' ? null : Number(form.warn),
      critical: form.critical === '' ? null : Number(form.critical),
    },
    interval_seconds: Number(form.interval_seconds),
    for_evaluations: Number(form.for_evaluations),
    repeat_minutes: Number(form.repeat_minutes),
    notify_on_recovery: form.notify_on_recovery,
    webhook: { url: webhookUrl === null ? MASK : webhookUrl, format: form.format },
    enabled: form.enabled,
  })

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    try {
      if (editingId) await alertsApi.update(editingId, payload())
      else await alertsApi.create(payload())
      reset()
      load()
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not save the rule')
    }
  }

  const act = async (id, fn, label) => {
    setBusy({ id, label })
    setError('')
    try {
      await fn(id)
      load()
    } catch (err) {
      setError(err.response?.data?.detail || `${label} failed`)
    } finally {
      setBusy(null)
    }
  }

  const remove = async (id) => {
    if (!confirm('Delete this alert rule?')) return
    await alertsApi.remove(id)
    if (expanded === id) setExpanded(null)
    load()
  }

  const toggleHistory = async (id) => {
    if (expanded === id) return setExpanded(null)
    setExpanded(id)
    const res = await alertsApi.history(id)
    setHistory(res.data)
  }

  const firing = rules.filter((r) => ['warn', 'critical', 'error'].includes(r.state))

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Alerts</h1>
          <p className="page-subtitle">
            {rules.length === 0 ? 'No rules yet'
              : firing.length ? `${firing.length} of ${rules.length} firing`
              : `${rules.length} rule${rules.length === 1 ? '' : 's'}, all quiet`}
          </p>
        </div>
        <span className="spacer" />
        {canEdit && !showForm && (
          <button onClick={() => { reset(); setShowForm(true) }}>
            <Plus size={15} /> New rule
          </button>
        )}
      </div>

      {error && <div className="error" style={{ marginBottom: 16 }}>{error}</div>}

      {showForm && canEdit && (
        <form className="card" onSubmit={submit} style={{ marginBottom: 20 }}>
          <div className="page-header" style={{ marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>{editingId ? 'Edit rule' : 'New rule'}</h3>
            <span className="spacer" />
            <button type="button" className="secondary small icon" onClick={reset} aria-label="Cancel">
              <X size={14} />
            </button>
          </div>

          <label>Name</label>
          <input value={form.name} onChange={(e) => set('name', e.target.value)} required
            placeholder="SLA breaches on open tickets" />

          <label>Data source</label>
          <select value={form.datasource_id} onChange={(e) => set('datasource_id', e.target.value)} required>
            <option value="">Choose a source…</option>
            {sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>

          <label>Query</label>
          <textarea rows={4} value={form.query} onChange={(e) => set('query', e.target.value)}
            placeholder="SELECT COUNT(*) AS breach FROM …" />
          <p className="hint">
            Same query you would put in a widget. It should return one number — or set
            an aggregate below to reduce many rows to one.
          </p>

          <div className="field-row">
            <div style={{ flex: 2 }}>
              <label>Value column <span className="optional">— blank for the first numeric one</span></label>
              <input value={form.value_field} onChange={(e) => set('value_field', e.target.value)}
                placeholder="breach" />
            </div>
            <div style={{ flex: 1 }}>
              <label>Reduce with</label>
              <select value={form.aggregate} onChange={(e) => set('aggregate', e.target.value)}>
                <option value="first">First row</option>
                <option value="sum">Sum</option>
                <option value="avg">Average</option>
                <option value="min">Minimum</option>
                <option value="max">Maximum</option>
                <option value="count">Row count</option>
              </select>
            </div>
          </div>

          <div className="field-row">
            <div style={{ flex: 1 }}>
              <label>Alert when the value is</label>
              <select value={form.direction} onChange={(e) => set('direction', e.target.value)}>
                <option value="above">At or above</option>
                <option value="below">At or below</option>
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label>Warning at</label>
              <input type="number" step="any" value={form.warn}
                onChange={(e) => set('warn', e.target.value)} placeholder="1" />
            </div>
            <div style={{ flex: 1 }}>
              <label>Critical at</label>
              <input type="number" step="any" value={form.critical}
                onChange={(e) => set('critical', e.target.value)} placeholder="5" />
            </div>
          </div>

          <div className="field-row">
            <div style={{ flex: 1 }}>
              <label>Check every (seconds)</label>
              <input type="number" min="30" value={form.interval_seconds}
                onChange={(e) => set('interval_seconds', e.target.value)} />
            </div>
            <div style={{ flex: 1 }}>
              <label>Fire after N checks</label>
              <input type="number" min="1" value={form.for_evaluations}
                onChange={(e) => set('for_evaluations', e.target.value)} />
            </div>
            <div style={{ flex: 1 }}>
              <label>Remind every (minutes)</label>
              <input type="number" min="0" value={form.repeat_minutes}
                onChange={(e) => set('repeat_minutes', e.target.value)} placeholder="0 = never" />
            </div>
          </div>
          <p className="hint">
            &quot;Fire after N checks&quot; is the flap guard: with 2, a single bad reading
            stays quiet and only a sustained breach pages you. Recovery is always
            reported immediately.
          </p>

          <label>Send to</label>
          <select value={form.format} onChange={(e) => set('format', e.target.value)}>
            <option value="slack">Slack (or Mattermost / Rocket.Chat)</option>
            <option value="teams">Microsoft Teams</option>
            <option value="generic">Generic JSON</option>
          </select>
          <SecretField label="Webhook URL" required
            value={webhookUrl} hasStored={hasStoredUrl}
            onChange={setWebhookUrl}
            placeholder="https://hooks.slack.com/services/…"
            hint="Stored encrypted and never shown again — anyone holding this URL can post to your channel." />

          <label style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer' }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={form.notify_on_recovery}
              onChange={(e) => set('notify_on_recovery', e.target.checked)} />
            <span>Send a message when it recovers</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer' }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={form.enabled}
              onChange={(e) => set('enabled', e.target.checked)} />
            <span>Enabled</span>
          </label>

          <div className="actions" style={{ marginTop: 14 }}>
            <button type="submit">{editingId ? 'Save rule' : 'Create rule'}</button>
            <button type="button" className="secondary" onClick={reset}>Cancel</button>
          </div>
        </form>
      )}

      {rules.length === 0 ? (
        <div className="empty-state">
          <Bell size={32} />
          <p>{canEdit
            ? 'No alert rules yet. A dashboard only helps while someone is watching it — a rule tells you when they are not.'
            : 'No alert rules have been set up yet.'}</p>
        </div>
      ) : (
        <div className="grid-cards">
          {rules.map((rule) => (
            <div className="card" key={rule.id}>
              <div className="page-header" style={{ marginBottom: 6 }}>
                <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 7 }}>
                  {rule.enabled ? <Bell size={15} /> : <BellOff size={15} className="muted" />}
                  {rule.name}
                </h3>
                <span className="spacer" />
                <span className={`status-pill ${STATE_TONE[rule.state] || ''}`}>
                  {rule.state === 'ok' && <CheckCircle2 size={11} />}
                  {(rule.state === 'warn' || rule.state === 'critical' || rule.state === 'error')
                    && <AlertTriangle size={11} />}
                  {rule.state === 'unknown' && <HelpCircle size={11} />}
                  {STATE_LABELS[rule.state] || rule.state}
                </span>
              </div>

              <div className="muted" style={{ fontSize: 13 }}>
                {rule.datasource_name || `source #${rule.datasource_id}`}
                {' · '}
                {rule.last_value !== null && rule.last_value !== undefined
                  ? <>last value <strong>{rule.last_value}</strong></>
                  : 'no value yet'}
                {' · checked '}{timeAgo(rule.last_checked_at)}
              </div>
              {rule.last_error && (
                <div className="error" style={{ marginTop: 8, fontSize: 12 }}>{rule.last_error}</div>
              )}
              <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                {rule.thresholds?.direction === 'below' ? 'Alerts at or below' : 'Alerts at or above'}
                {rule.thresholds?.warn != null && ` — warn ${rule.thresholds.warn}`}
                {rule.thresholds?.critical != null && `, critical ${rule.thresholds.critical}`}
                {` · every ${rule.interval_seconds}s`}
              </div>

              <div className="actions" style={{ marginTop: 12 }}>
                <button className="secondary small" onClick={() => toggleHistory(rule.id)}>
                  {expanded === rule.id ? 'Hide history' : 'History'}
                </button>
                {canEdit && (
                  <>
                    <button className="secondary small" disabled={busy?.id === rule.id}
                      onClick={() => act(rule.id, alertsApi.run, 'Check now')}>
                      <Play size={12} /> Check now
                    </button>
                    <button className="secondary small" disabled={busy?.id === rule.id}
                      onClick={() => act(rule.id, alertsApi.test, 'Test message')}>
                      <Send size={12} /> Test
                    </button>
                    <button className="secondary small icon" aria-label="Edit rule"
                      onClick={() => startEdit(rule)}>
                      <Pencil size={13} />
                    </button>
                    <button className="danger ghost small icon" aria-label="Delete rule"
                      onClick={() => remove(rule.id)}>
                      <Trash2 size={13} />
                    </button>
                  </>
                )}
              </div>

              {expanded === rule.id && (
                <div style={{ marginTop: 12 }}>
                  {history.length === 0 ? (
                    <p className="muted" style={{ fontSize: 13 }}>
                      Nothing sent yet. Press Test to check the webhook works before you need it.
                    </p>
                  ) : (
                    <table className="mini-table">
                      <tbody>
                        {history.map((n) => (
                          <tr key={n.id}>
                            <td className="muted" style={{ whiteSpace: 'nowrap' }}>{timeAgo(n.created_at)}</td>
                            <td>
                              <span className={`status-pill ${STATE_TONE[n.level] || ''}`}>{n.reason}</span>
                            </td>
                            <td>{n.message}</td>
                            <td>{n.delivered
                              ? <span className="muted">sent</span>
                              : <span className="danger-text" title={n.error}>failed</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
