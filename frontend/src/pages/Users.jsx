import { useEffect, useState } from 'react'
import {
  UserPlus, Trash2, KeyRound, ShieldCheck, Check, X, AlertCircle, Users as UsersIcon,
} from 'lucide-react'
import { users as usersApi } from '../api'
import { useAuth } from '../useAuth'

const CAPABILITY_LABELS = {
  'dashboard.view': 'View dashboards',
  'dashboard.export': 'Export data',
  'dashboard.edit': 'Create and edit dashboards',
  'dashboard.share': 'Create share links',
  'datasource.view': 'View data sources',
  'datasource.edit': 'Add and edit data sources',
  'user.manage': 'Manage users',
}

export default function Users() {
  const { user: me, refresh } = useAuth()
  const [items, setItems] = useState([])
  const [matrix, setMatrix] = useState(null)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ email: '', password: '', role: 'viewer' })
  const [resetting, setResetting] = useState(null)   // user id
  const [newPassword, setNewPassword] = useState('')

  const load = () => usersApi.list().then((res) => setItems(res.data))

  useEffect(() => {
    load()
    usersApi.roles().then((res) => setMatrix(res.data))
  }, [])

  const act = async (fn) => {
    setError('')
    try {
      await fn()
      await load()
      await refresh()      // your own role may have changed
    } catch (err) {
      setError(err.response?.data?.detail || 'Something went wrong')
    }
  }

  const create = (e) => {
    e.preventDefault()
    act(async () => {
      await usersApi.create(form)
      setForm({ email: '', password: '', role: 'viewer' })
      setCreating(false)
    })
  }

  const resetPassword = (id) => act(async () => {
    await usersApi.update(id, { password: newPassword })
    setResetting(null)
    setNewPassword('')
  })

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Users</h1>
          <p className="page-subtitle">
            {items.length} account{items.length === 1 ? '' : 's'} · only admins can add people
          </p>
        </div>
        <span className="spacer" />
        <button onClick={() => setCreating((v) => !v)}>
          <UserPlus size={15} /> Add user
        </button>
      </div>

      {error && <div className="error" style={{ marginBottom: 16 }}><AlertCircle size={14} />{error}</div>}

      {creating && (
        <form className="card" style={{ marginBottom: 20, maxWidth: 560 }} onSubmit={create}>
          <h2>New user</h2>
          <label>Email</label>
          <input type="email" required value={form.email} autoFocus
            onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <label>Temporary password</label>
          <input type="text" required minLength={8} value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            placeholder="At least 8 characters" />
          <p className="hint">Share this with them; they can change it from Account.</p>
          <label>Role</label>
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            {matrix?.roles.map((r) => (
              <option key={r.key} value={r.key}>{r.label} — {r.description}</option>
            ))}
          </select>
          <div className="modal-footer">
            <button type="button" className="secondary" onClick={() => setCreating(false)}>Cancel</button>
            <button type="submit">Create user</button>
          </div>
        </form>
      )}

      {items.length === 0 ? (
        <div className="empty-state"><UsersIcon size={32} /><p>No users yet.</p></div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="data users-table">
            <thead>
              <tr>
                <th>Email</th><th>Role</th><th>Status</th><th>Last login</th><th />
              </tr>
            </thead>
            <tbody>
              {items.map((u) => (
                <tr key={u.id} className={u.is_active ? '' : 'inactive'}>
                  <td>
                    {u.email}
                    {u.id === me?.id && <span className="you-badge">you</span>}
                  </td>
                  <td>
                    <select className="role-select" value={u.role}
                      onChange={(e) => act(() => usersApi.update(u.id, { role: e.target.value }))}>
                      {matrix?.roles.map((r) => (
                        <option key={r.key} value={r.key}>{r.label}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <span className={u.is_active ? 'status-pill ok' : 'status-pill'}>
                      {u.is_active ? <Check size={11} /> : <X size={11} />}
                      {u.is_active ? 'Active' : 'Disabled'}
                    </span>
                  </td>
                  <td className="muted">
                    {u.last_login_at ? new Date(u.last_login_at).toLocaleString() : 'Never'}
                  </td>
                  <td>
                    <div className="row-actions">
                      <button className="secondary small icon" title="Reset password"
                        onClick={() => { setResetting(u.id); setNewPassword('') }}>
                        <KeyRound size={13} />
                      </button>
                      <button className="secondary small"
                        title={u.is_active ? 'Disable this account' : 'Enable this account'}
                        onClick={() => act(() => usersApi.update(u.id, { is_active: !u.is_active }))}>
                        {u.is_active ? 'Disable' : 'Enable'}
                      </button>
                      <button className="danger ghost small icon" title="Delete user"
                        onClick={() => {
                          if (confirm(`Delete ${u.email}? Their dashboards stay in the workspace.`)) {
                            act(() => usersApi.remove(u.id))
                          }
                        }}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                    {resetting === u.id && (
                      <div className="field-row" style={{ marginTop: 8 }}>
                        <input type="text" autoFocus placeholder="New password (8+ chars)"
                          value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
                        <button className="small" disabled={newPassword.length < 8}
                          onClick={() => resetPassword(u.id)}>Set</button>
                        <button className="secondary small" onClick={() => setResetting(null)}>Cancel</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {matrix && (
        <div className="card" style={{ marginTop: 24 }}>
          <h2><ShieldCheck size={16} style={{ verticalAlign: '-3px', marginRight: 6 }} />
            What each role can do</h2>
          <table className="data matrix-table">
            <thead>
              <tr>
                <th>Capability</th>
                {matrix.roles.map((r) => <th key={r.key}>{r.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {matrix.capabilities.map((cap) => (
                <tr key={cap.key}>
                  <td>{CAPABILITY_LABELS[cap.key] || cap.key}</td>
                  {matrix.roles.map((r) => (
                    <td key={r.key} className="matrix-cell">
                      {cap.roles.includes(r.key)
                        ? <Check size={14} className="yes" />
                        : <span className="no">—</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
