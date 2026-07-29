import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertCircle, Loader2 } from 'lucide-react'
import Logo from '../components/Logo'
import { auth } from '../api'
import { useAuth } from '../useAuth'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [setupNeeded, setSetupNeeded] = useState(false)
  const navigate = useNavigate()
  const { refresh } = useAuth()

  // on a fresh install nobody exists yet, so send the first person to set up
  useEffect(() => {
    auth.registrationStatus()
      .then((res) => setSetupNeeded(res.data.open))
      .catch(() => {})
  }, [])

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const res = await auth.login(email, password)
      localStorage.setItem('token', res.data.access_token)
      await refresh()
      navigate('/')
    } catch (err) {
      setError(err.response?.data?.detail || 'Login failed')
      setBusy(false)
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-box">
        <div className="brand-mark"><Logo size={26} /> Hub-Bro</div>
        <div className="card">
          <h1>Welcome back</h1>
          <p className="page-subtitle">Sign in to your workspace</p>
          <form onSubmit={submit}>
            <label>Email</label>
            <input type="email" placeholder="you@company.com" value={email}
              onChange={(e) => setEmail(e.target.value)} required autoFocus />
            <label>Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            {error && <div className="error"><AlertCircle size={14} />{error}</div>}
            <div style={{ marginTop: 20 }}>
              <button type="submit" disabled={busy} style={{ width: '100%', justifyContent: 'center' }}>
                {busy && <Loader2 size={15} className="spin" />}
                {busy ? 'Logging in…' : 'Log in'}
              </button>
            </div>
          </form>
          <p className="muted" style={{ textAlign: 'center', marginTop: 20 }}>
            {setupNeeded
              ? <>First time here? <Link to="/register">Set up the admin account</Link></>
              : 'Accounts are created by an administrator.'}
          </p>
        </div>
      </div>
    </div>
  )
}
