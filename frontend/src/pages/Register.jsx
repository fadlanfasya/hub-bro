import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertCircle, Loader2 } from 'lucide-react'
import Logo from '../components/Logo'
import { auth } from '../api'

export default function Register() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await auth.register(email, password)
      const res = await auth.login(email, password)
      localStorage.setItem('token', res.data.access_token)
      navigate('/')
    } catch (err) {
      setError(err.response?.data?.detail || 'Registration failed')
      setBusy(false)
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-box">
        <div className="brand-mark"><Logo size={26} /> Hub-Bro</div>
        <div className="card">
          <h1>Set up Hub-Bro</h1>
          <p className="page-subtitle">
            This first account becomes the administrator. Sign-up then closes —
            further accounts are created from the Users page.
          </p>
          <form onSubmit={submit}>
            <label>Email</label>
            <input type="email" placeholder="you@company.com" value={email}
              onChange={(e) => setEmail(e.target.value)} required autoFocus />
            <label>Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              required minLength={8} />
            <p className="hint">At least 8 characters.</p>
            {error && <div className="error"><AlertCircle size={14} />{error}</div>}
            <div style={{ marginTop: 20 }}>
              <button type="submit" disabled={busy} style={{ width: '100%', justifyContent: 'center' }}>
                {busy && <Loader2 size={15} className="spin" />}
                {busy ? 'Creating account…' : 'Create admin account'}
              </button>
            </div>
          </form>
          <p className="muted" style={{ textAlign: 'center', marginTop: 20 }}>
            Already set up? <Link to="/login">Log in</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
