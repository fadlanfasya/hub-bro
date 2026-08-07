import { useEffect, useState } from 'react'
import { Lock, Globe2, UserPlus, X, Info } from 'lucide-react'

/**
 * Who can see this dashboard (or data source).
 *
 * Two independent things sit here on purpose, because people conflate them:
 *   - visibility: whole workspace, or private plus named people
 *   - the public link: anonymous read-only access for anyone holding the URL
 *
 * `kind` is 'dashboard' or 'source'. Sources have no per-person role — a grant
 * is a grant — and no public link.
 */
export default function SharePanel({ kind = 'dashboard', api, id, visibility, onVisibility }) {
  const [members, setMembers] = useState([])
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('viewer')
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const isPrivate = visibility === 'private'

  const load = () => api.members(id).then((r) => setMembers(r.data)).catch(() => setMembers([]))
  useEffect(() => { load() }, [id])

  const invite = async (e) => {
    e.preventDefault()
    setError(''); setNote('')
    if (!email.trim()) return
    try {
      const res = kind === 'dashboard'
        ? await api.addMember(id, email.trim(), role)
        : await api.addMember(id, email.trim())
      setEmail('')
      if (res.data?.note) setNote(res.data.note)
      load()
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not share')
    }
  }

  const revoke = async (userId) => {
    setError(''); setNote('')
    try {
      await api.removeMember(id, userId)
      load()
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not remove')
    }
  }

  return (
    <div>
      <label>Who can see this</label>
      <div className="visibility-choice">
        <button type="button" className={!isPrivate ? 'secondary active' : 'secondary'}
          onClick={() => onVisibility('workspace')}>
          <Globe2 size={14} /> Everyone in the workspace
        </button>
        <button type="button" className={isPrivate ? 'secondary active' : 'secondary'}
          onClick={() => onVisibility('private')}>
          <Lock size={14} /> Private
        </button>
      </div>
      <p className="hint">
        {isPrivate
          ? `Only you, anyone you invite below${kind === 'dashboard' ? ',' : ''} and admins.`
          : kind === 'dashboard'
            ? 'Anyone signed in can find it. Editors can change it.'
            : 'Anyone who can build widgets can query through it.'}
      </p>

      {error && <div className="error" style={{ marginTop: 10 }}>{error}</div>}
      {note && (
        <div className="hint" style={{ display: 'flex', gap: 7, alignItems: 'flex-start', marginTop: 10 }}>
          <Info size={13} style={{ flexShrink: 0, marginTop: 2 }} /> <span>{note}</span>
        </div>
      )}

      <label style={{ marginTop: 14 }}>Shared with</label>
      {members.length === 0 ? (
        <p className="muted" style={{ fontSize: 13 }}>Nobody yet.</p>
      ) : (
        <ul className="member-list">
          {members.map((m) => (
            <li key={m.user_id}>
              <span>{m.email}</span>
              {m.role && <span className="status-pill">{m.role}</span>}
              <span style={{ flex: 1 }} />
              <button type="button" className="danger ghost small icon"
                aria-label={`Remove ${m.email}`} onClick={() => revoke(m.user_id)}>
                <X size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={invite} className="field-row" style={{ marginTop: 10 }}>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
          placeholder="colleague@company.com" style={{ flex: 2 }} />
        {kind === 'dashboard' && (
          <select value={role} onChange={(e) => setRole(e.target.value)} style={{ flex: 1 }}>
            <option value="viewer">Can view</option>
            <option value="editor">Can edit</option>
          </select>
        )}
        <button type="submit"><UserPlus size={14} /> Invite</button>
      </form>
      <p className="hint">
        {kind === 'dashboard'
          ? 'They see this dashboard and its data, but gain no access to the data sources behind it.'
          : 'This grants running queries through the source — for a database, their own statements. Share a dashboard instead if they only need to read numbers.'}
      </p>
    </div>
  )
}
