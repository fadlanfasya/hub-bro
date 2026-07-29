import { useState } from 'react'
import { AlertCircle, Check, Loader2 } from 'lucide-react'
import { auth } from '../api'
import { useAuth, ROLE_LABELS } from '../useAuth'

export default function Account() {
  const { user } = useAuth()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setError(''); setDone(false)

    if (next !== confirm) return setError('The new passwords do not match')
    if (next.length < 8) return setError('New password must be at least 8 characters')

    setBusy(true)
    try {
      await auth.changePassword(current, next)
      setDone(true)
      setCurrent(''); setNext(''); setConfirm('')
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not change the password')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Account</h1>
          <p className="page-subtitle">{user?.email}</p>
        </div>
      </div>

      <div className="card" style={{ maxWidth: 520 }}>
        <h2>Your role</h2>
        <p className="muted">
          You are {ROLE_LABELS[user?.role] === 'Admin' ? 'an' : 'a'}{' '}
          <strong>{ROLE_LABELS[user?.role] || user?.role}</strong>.
          {user?.role === 'viewer' && ' You can view dashboards and export data.'}
          {user?.role === 'editor' && ' You can build dashboards and widgets.'}
          {user?.role === 'admin' && ' You can manage users and data sources.'}
        </p>
        <p className="hint">Ask an admin if you need different access.</p>
      </div>

      <form className="card" style={{ maxWidth: 520, marginTop: 20 }} onSubmit={submit}>
        <h2>Change password</h2>
        <label>Current password</label>
        <input type="password" required value={current}
          onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
        <label>New password</label>
        <input type="password" required minLength={8} value={next}
          onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
        <p className="hint">At least 8 characters.</p>
        <label>Confirm new password</label>
        <input type="password" required value={confirm}
          onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />

        {error && <div className="error"><AlertCircle size={14} />{error}</div>}
        {done && (
          <div className="status-pill ok" style={{ marginTop: 12 }}>
            <Check size={12} /> Password updated
          </div>
        )}

        <div style={{ marginTop: 20 }}>
          <button type="submit" disabled={busy}>
            {busy && <Loader2 size={14} className="spin" />}
            {busy ? 'Saving…' : 'Change password'}
          </button>
        </div>
      </form>
    </div>
  )
}
