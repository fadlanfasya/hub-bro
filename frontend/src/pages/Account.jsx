import { useEffect, useState } from 'react'
import { AlertCircle, Check, Loader2, ShieldCheck, ShieldOff, Copy } from 'lucide-react'
import { auth } from '../api'
import { useAuth, ROLE_LABELS } from '../useAuth'

/**
 * Turn a failed request into something a person can act on.
 *
 * A bare "That did not work" hides the difference between a wrong password and
 * a 500, which is exactly the case that costs an afternoon: the server said
 * nothing useful, so the message must at least say the server broke.
 */
function describeError(err) {
  const detail = err.response?.data?.detail
  if (typeof detail === 'string' && detail) return detail
  if (detail?.message) return detail.message
  const status = err.response?.status
  if (status >= 500) return `The server failed (${status}). Check the server log.`
  if (status) return `Request failed (${status}).`
  return 'Could not reach the server.'
}

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
      setError(describeError(err))
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

      <div className="card">
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

      <div className="account-columns">
      <form className="card" onSubmit={submit}>
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

      <TwoFactor />
      </div>
    </div>
  )
}

/** Opt-in second factor. Nobody is enrolled unless they choose to be. */
function TwoFactor() {
  const [status, setStatus] = useState(null)
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [setup, setSetup] = useState(null)      // {secret, uri} while enrolling
  const [codes, setCodes] = useState(null)      // recovery codes, shown once
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = () => auth.totpStatus().then((r) => setStatus(r.data)).catch(() => {})
  useEffect(() => { load() }, [])

  const run = async (fn) => {
    setError(''); setBusy(true)
    try { await fn() } catch (err) {
      setError(describeError(err))
    } finally { setBusy(false) }
  }

  const start = () => run(async () => {
    const r = await auth.totpSetup(password)
    setSetup(r.data); setPassword('')
  })

  const enable = () => run(async () => {
    const r = await auth.totpEnable(code)
    setCodes(r.data.recovery_codes); setSetup(null); setCode('')
    await load()
  })

  const disable = () => run(async () => {
    await auth.totpDisable(password, code)
    setPassword(''); setCode(''); setCodes(null)
    await load()
  })

  if (!status) return null

  return (
    <div className="card">
      <h2>Two-factor sign-in</h2>
      <p className="page-subtitle">
        {status.enabled
          ? 'On for your account. Nobody else is affected.'
          : 'Optional. Adds a six-digit code from an authenticator app to your sign-in.'}
      </p>

      {codes && (
        <>
          <div className="status-pill ok" style={{ marginBottom: 10 }}>
            <Check size={12} /> Two-factor is on
          </div>
          <label>Recovery codes</label>
          <pre style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>{codes.join('\n')}</pre>
          <p className="hint">
            Save these somewhere other than your phone. Each works once, and this
            is the only time they can be shown — they are stored hashed, so
            nobody can produce them again.
          </p>
          <button type="button" className="secondary small"
            onClick={() => navigator.clipboard?.writeText(codes.join('\n'))}>
            <Copy size={13} /> Copy
          </button>
        </>
      )}

      {!status.enabled && !setup && !codes && (
        <>
          <label>Confirm your password</label>
          <input type="password" value={password} autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)} />
          <p className="hint">
            Asked again so a stolen session can't attach someone else's authenticator.
          </p>
          <button type="button" disabled={busy || !password} onClick={start}>
            <ShieldCheck size={14} /> Set up
          </button>
        </>
      )}

      {setup && (
        <>
          <label>1. Add this to your authenticator app</label>
          {setup.qr_svg
            ? <div className="totp-qr" dangerouslySetInnerHTML={{ __html: setup.qr_svg }} />
            : <a href={setup.uri} className="link">Open in your authenticator app</a>}
          <p className="hint">
            {setup.qr_svg
              ? "Scan it with Google Authenticator, Authy, 1Password — any of them. Can't scan? Type this key in instead:"
              : 'Or type this key in by hand:'}
          </p>
          <pre style={{ fontFamily: 'var(--font-mono)', fontSize: 12, wordBreak: 'break-all' }}>
            {setup.secret}
          </pre>

          <label style={{ marginTop: 14 }}>2. Enter the code it shows</label>
          <input value={code} inputMode="numeric" placeholder="123456"
            style={{ letterSpacing: '.18em' }}
            onChange={(e) => setCode(e.target.value)} />
          <p className="hint">
            Nothing changes until this matches — a mis-scanned code is how people
            lock themselves out.
          </p>
          <button type="button" disabled={busy || code.length < 6} onClick={enable}>
            Turn it on
          </button>
        </>
      )}

      {status.enabled && !codes && (
        <>
          <div className="status-pill ok" style={{ marginBottom: 12 }}>
            <ShieldCheck size={12} /> On · {status.recovery_codes_left} recovery codes left
          </div>
          <label>Password</label>
          <input type="password" value={password} autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)} />
          <label>Current code</label>
          <input value={code} inputMode="numeric" placeholder="123456"
            onChange={(e) => setCode(e.target.value)} />
          <p className="hint">A recovery code works here too.</p>
          <button type="button" className="danger" disabled={busy || !password || !code}
            onClick={disable}>
            <ShieldOff size={14} /> Turn off two-factor
          </button>
        </>
      )}

      {error && <div className="error" style={{ marginTop: 12 }}>
        <AlertCircle size={14} />{error}
      </div>}
    </div>
  )
}
