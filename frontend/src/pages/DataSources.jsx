import { useEffect, useState } from 'react'
import { Globe, FileSpreadsheet, Activity, Server, Table2, X, Plus, Database, Loader2, CheckCircle2, XCircle, Pencil, Trash2, Info } from 'lucide-react'
import { datasources, data } from '../api'
import SecretField from '../components/SecretField'
import { useAuth } from '../useAuth'

const TYPE_LABELS = {
  rest: 'REST API', csv: 'CSV file', prometheus: 'Prometheus', glpi: 'GLPI', sql: 'SQL database',
}
const TYPE_ICONS = {
  rest: Globe, csv: FileSpreadsheet, prometheus: Activity, glpi: Server, sql: Table2,
}
const SOURCE_TYPES = [
  { key: 'rest', label: 'REST API' },
  { key: 'sql', label: 'SQL database (PostgreSQL / MySQL / SQLite)' },
  { key: 'glpi', label: 'GLPI' },
  { key: 'prometheus', label: 'Prometheus' },
  { key: 'csv', label: 'CSV upload' },
]
const MASK = '••••••••'
// mirrors DEFAULT_PORTS in backend/app/connectors/sql_db.py
const DEFAULT_PORTS = {
  postgresql: '5432', mysql: '3306', mariadb: '3306', doris: '9030', starrocks: '9030',
}

export default function DataSources() {
  const { can } = useAuth()
  const canEdit = can('datasource.edit')
  const [items, setItems] = useState([])
  const [type, setType] = useState('rest')
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [headerRows, setHeaderRows] = useState([{ key: '', value: '' }])
  const [baseUrl, setBaseUrl] = useState('')
  const [verifySsl, setVerifySsl] = useState(true)
  const [sql, setSql] = useState({ driver: 'postgresql', host: '', port: '', database: '', user: '' })
  // secrets: null means "untouched, keep whatever is stored"; a string is a new value
  const [secrets, setSecrets] = useState({ password: '', app_token: '', user_token: '' })
  const [stored, setStored] = useState({})
  const setSecret = (k, v) => setSecrets((s2) => ({ ...s2, [k]: v }))
  const [monitor, setMonitor] = useState(false)
  const setSqlField = (k, v) => setSql((s) => ({ ...s, [k]: v }))
  const [file, setFile] = useState(null)
  const [error, setError] = useState('')
  const [testResult, setTestResult] = useState(null)
  const [editingId, setEditingId] = useState(null)

  const TypeIcon = TYPE_ICONS[type]
  const load = () => datasources.list().then((res) => setItems(res.data))
  useEffect(() => { load() }, [])

  const resetForm = () => {
    setEditingId(null)
    setName(''); setUrl(''); setHeaderRows([{ key: '', value: '' }])
    setBaseUrl(''); setFile(null); setVerifySsl(true); setError('')
    setSql({ driver: 'postgresql', host: '', port: '', database: '', user: '' })
    setSecrets({ password: '', app_token: '', user_token: '' })
    setStored({})
    setMonitor(false)
  }

  const startEdit = (ds) => {
    setEditingId(ds.id)
    setType(ds.type)
    setName(ds.name)
    setUrl(ds.config.url || '')
    setBaseUrl(ds.config.base_url || '')
    setVerifySsl(ds.config.verify_ssl !== false)
    setSql({
      driver: ds.config.driver || 'postgresql',
      host: ds.config.host || '', port: ds.config.port || '',
      database: ds.config.database || '', user: ds.config.user || '',
    })
    // the API only ever sends a mask for secrets, so record which ones exist
    // and start them untouched — nothing to retype
    setStored({
      password: Boolean(ds.config.password),
      app_token: Boolean(ds.config.app_token),
      user_token: Boolean(ds.config.user_token),
    })
    setSecrets({ password: null, app_token: null, user_token: null })
    setMonitor(Boolean(ds.config.monitor))
    const rows = Object.entries(ds.config.headers || {}).map(([key, value]) => ({ key, value }))
    setHeaderRows(rows.length ? rows : [{ key: '', value: '' }])
    setFile(null)
    setError('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // an untouched secret is sent back as the mask, which tells the server to
  // keep the value it already has
  const secretValue = (key) => (secrets[key] === null ? MASK : secrets[key])

  const buildConfig = () => {
    if (type === 'rest') {
      const parsedHeaders = {}
      for (const row of headerRows) {
        if (row.key.trim()) parsedHeaders[row.key.trim()] = row.value
      }
      return { url, headers: parsedHeaders, verify_ssl: verifySsl, monitor }
    }
    if (type === 'prometheus') return { base_url: baseUrl, monitor }
    if (type === 'glpi') {
      return {
        base_url: baseUrl,
        app_token: secretValue('app_token'),
        user_token: secretValue('user_token'),
        verify_ssl: verifySsl, monitor,
      }
    }
    if (type === 'sql') return { ...sql, password: secretValue('password'), monitor }
    return {}
  }

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    try {
      if (editingId) {
        await datasources.update(editingId, {
          name,
          config: type === 'csv' ? undefined : buildConfig(),
        })
      } else if (type === 'csv') {
        if (!file) return setError('Choose a CSV file')
        await datasources.uploadCsv(name, file)
      } else {
        await datasources.create({ name, type, config: buildConfig() })
      }
      resetForm()
      load()
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to save')
    }
  }

  const test = async (ds) => {
    setTestResult({ id: ds.id, status: 'loading' })
    try {
      const options = ds.type === 'prometheus' ? { query: 'up' }
        : ds.type === 'glpi' ? { itemtype: 'Computer', max_rows: 5 }
        : ds.type === 'sql' ? { query: 'SELECT 1', limit: 1 } : {}
      const res = await data.fetch(ds.id, options)
      setTestResult({ id: ds.id, status: 'ok', rows: res.data.rows.length })
    } catch (err) {
      setTestResult({ id: ds.id, status: 'error', message: err.response?.data?.detail || String(err) })
    }
  }

  const remove = async (id) => {
    if (!confirm('Delete this data source?')) return
    await datasources.remove(id)
    load()
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Data sources</h1>
          <p className="page-subtitle">Connect APIs, CSVs and Prometheus to feed your dashboards</p>
        </div>
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: canEdit ? '380px 1fr' : '1fr',
        gap: 20, alignItems: 'start',
      }}>
        {canEdit && (
        <form className="card" onSubmit={submit}>
          <h2>{editingId ? 'Edit source' : 'Add source'}</h2>
          <label>Type</label>
          <div className="select-with-icon">
            <span className="select-icon">{TypeIcon && <TypeIcon size={15} />}</span>
            <select value={type} disabled={!!editingId} onChange={(e) => setType(e.target.value)}>
              {SOURCE_TYPES.map(({ key, label }) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>
          {editingId && <p className="hint">The type can't be changed — delete and re-add to switch.</p>}
          <label>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="My API" />
          {type === 'rest' && (
            <>
              <label>URL</label>
              <input value={url} onChange={(e) => setUrl(e.target.value)} required
                placeholder="https://api.example.com/metrics" />
              <label>Headers <span className="optional">(optional)</span></label>
              {headerRows.map((row, i) => (
                <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                  <input value={row.key} placeholder="Name  e.g. App-Token"
                    onChange={(e) => setHeaderRows((rows) =>
                      rows.map((r, j) => j === i ? { ...r, key: e.target.value } : r))} />
                  <input value={row.value} placeholder="Value"
                    onChange={(e) => setHeaderRows((rows) =>
                      rows.map((r, j) => j === i ? { ...r, value: e.target.value } : r))} />
                  <button type="button" className="ghost small icon" aria-label="Remove header"
                    onClick={() => setHeaderRows((rows) =>
                      rows.length > 1 ? rows.filter((_, j) => j !== i) : [{ key: '', value: '' }])}>
                    <X size={13} />
                  </button>
                </div>
              ))}
              <button type="button" className="link"
                onClick={() => setHeaderRows((rows) => [...rows, { key: '', value: '' }])}>
                <Plus size={13} /> Add header
              </button>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 9, cursor: 'pointer' }}>
                <input type="checkbox" style={{ width: 'auto', marginTop: 2 }} checked={verifySsl}
                  onChange={(e) => setVerifySsl(e.target.checked)} />
                <span>Verify SSL certificate <span className="optional">— uncheck for self-signed servers</span></span>
              </label>
            </>
          )}
          {type === 'prometheus' && (
            <>
              <label>Base URL</label>
              <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} required
                placeholder="http://localhost:9090" />
            </>
          )}
          {type === 'glpi' && (
            <>
              <label>API URL</label>
              <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} required
                placeholder="http://10.1.6.51/glpi/apirest.php" />
              <p className="hint">The apirest.php endpoint, not the web UI URL.</p>
              <SecretField label="App-Token"
                value={secrets.app_token} hasStored={stored.app_token}
                onChange={(v) => setSecret('app_token', v)}
                placeholder="Setup → General → API → API client" />
              <SecretField label="User API token" required
                value={secrets.user_token} hasStored={stored.user_token}
                onChange={(v) => setSecret('user_token', v)}
                placeholder="Preferences → Remote access keys"
                hint="Hub-Bro opens and refreshes the GLPI session for you." />
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 9, cursor: 'pointer' }}>
                <input type="checkbox" style={{ width: 'auto', marginTop: 2 }} checked={verifySsl}
                  onChange={(e) => setVerifySsl(e.target.checked)} />
                <span>Verify SSL certificate <span className="optional">— uncheck for self-signed servers</span></span>
              </label>
            </>
          )}
          {type === 'sql' && (
            <>
              <label>Database</label>
              <select value={sql.driver} onChange={(e) => setSqlField('driver', e.target.value)}>
                <option value="postgresql">PostgreSQL</option>
                <option value="mysql">MySQL / MariaDB</option>
                <option value="doris">Apache Doris</option>
                <option value="starrocks">StarRocks</option>
                <option value="sqlite">SQLite</option>
              </select>
              {(sql.driver === 'doris' || sql.driver === 'starrocks') && (
                <p className="hint">
                  Connects over the MySQL protocol to the FE query port (9030), not the HTTP port.
                </p>
              )}
              {sql.driver === 'sqlite' ? (
                <>
                  <label>File path</label>
                  <input value={sql.database} onChange={(e) => setSqlField('database', e.target.value)}
                    required placeholder="/var/data/app.db" />
                </>
              ) : (
                <>
                  <div className="field-row">
                    <div style={{ flex: 2 }}>
                      <label>Host</label>
                      <input value={sql.host} onChange={(e) => setSqlField('host', e.target.value)}
                        required placeholder="10.1.6.20" />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label>Port</label>
                      <input value={sql.port} onChange={(e) => setSqlField('port', e.target.value)}
                        placeholder={DEFAULT_PORTS[sql.driver] || ''} />
                    </div>
                  </div>
                  <label>Database name</label>
                  <input value={sql.database} onChange={(e) => setSqlField('database', e.target.value)}
                    required placeholder="inventory" />
                  <label>User</label>
                  <input value={sql.user} onChange={(e) => setSqlField('user', e.target.value)}
                    placeholder="readonly_user" />
                  <SecretField label="Password" required
                    value={secrets.password} hasStored={stored.password}
                    onChange={(v) => setSecret('password', v)}
                    hint="Stored encrypted. Use a read-only account — Hub-Bro rejects anything but SELECT, but least privilege is still the right call." />
                  )}
                  <p className="hint">
                    Stored encrypted. Use a read-only account — Hub-Bro rejects anything but SELECT,
                    but least privilege is still the right call.
                  </p>
                </>
              )}
            </>
          )}
          {type === 'csv' && !editingId && (
            <>
              <label>File</label>
              <input type="file" accept=".csv" onChange={(e) => setFile(e.target.files[0])} />
            </>
          )}
          {type === 'csv' && editingId && (
            <p className="muted">Only the name can be changed for CSV sources. To change the data, delete and re-upload.</p>
          )}
          {type !== 'csv' && (
            <>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 9, cursor: 'pointer' }}>
                <input type="checkbox" style={{ width: 'auto', marginTop: 2 }} checked={monitor}
                  onChange={(e) => setMonitor(e.target.checked)} />
                <span>
                  Check this source on a timer
                  <span className="optional"> — otherwise health is only known from real widget fetches</span>
                </span>
              </label>
            </>
          )}
          {error && <div className="error"><XCircle size={14} />{error}</div>}
          <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
            <button type="submit">{editingId ? 'Save changes' : 'Add source'}</button>
            {editingId && <button type="button" className="secondary" onClick={resetForm}>Cancel</button>}
          </div>
        </form>
        )}

        <div>
          {!canEdit && (
            <div className="notice" style={{ marginBottom: 16 }}>
              <Info size={14} />
              <span>You can see which sources exist, but only an admin can add or change them.</span>
            </div>
          )}
          {items.length === 0 ? (
            <div className="empty-state">
              <Database size={32} />
              <p>{canEdit
                ? 'No data sources yet — add one on the left to feed your dashboards.'
                : 'No data sources have been configured yet.'}</p>
            </div>
          ) : (
            <div className="grid-cards">
              {items.map((ds) => {
                const TypeIcon = TYPE_ICONS[ds.type]
                return (
                  <div className="card source-card" key={ds.id}>
                    <div className="head">
                      <span className="type-icon"><TypeIcon size={17} /></span>
                      <div style={{ minWidth: 0 }}>
                        <div className="name">{ds.name}</div>
                        <div className="type">{TYPE_LABELS[ds.type]}</div>
                      </div>
                    </div>
                    <div className="detail">
                      {ds.config.url || ds.config.base_url || ds.config.original_name ||
                        (ds.config.host && `${ds.config.host}/${ds.config.database}`) ||
                        ds.config.database}
                    </div>
                    <div className="actions">
                      <button className="secondary small" onClick={() => test(ds)}>Test</button>
                      {canEdit && (
                      <>
                      <button className="secondary small icon" aria-label="Edit source" title="Edit source" onClick={() => startEdit(ds)}>
                        <Pencil size={13} />
                      </button>
                      <button className="danger ghost small icon" aria-label="Delete source" title="Delete source" onClick={() => remove(ds.id)}>
                        <Trash2 size={13} />
                      </button>
                      </>
                      )}
                    </div>
                    {testResult?.id === ds.id && (
                      <div style={{ marginTop: 4 }}>
                        {testResult.status === 'loading' && (
                          <span className="status-pill loading"><Loader2 size={12} className="spin" /> Testing…</span>
                        )}
                        {testResult.status === 'ok' && (
                          <span className="status-pill ok"><CheckCircle2 size={12} /> OK — {testResult.rows} rows</span>
                        )}
                        {testResult.status === 'error' && (
                          <span className="error"><XCircle size={13} />{testResult.message}</span>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
