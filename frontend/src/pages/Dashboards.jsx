import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  LayoutDashboard, Plus, Trash2, ArrowRight, Copy, Share2, Lock, Users, X,
} from 'lucide-react'
import { dashboards } from '../api'
import { useAuth } from '../useAuth'
import EditableTitle from '../components/EditableTitle'
import SharePanel from '../components/SharePanel'

export default function Dashboards() {
  const { can, user } = useAuth()
  const canEdit = can('dashboard.edit')
  const [items, setItems] = useState([])
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [sharing, setSharing] = useState(null)
  const [newVisibility, setNewVisibility] = useState('workspace')

  // Only the owner (or an admin) may change who a dashboard is shared with —
  // an invited editor shouldn't be able to widen access behind your back.
  const canManage = (d) => user?.role === 'admin' || d.owner_id === user?.id

  const setVisibility = async (id, visibility) => {
    setError('')
    try {
      await dashboards.setVisibility(id, visibility)
      const res = await dashboards.list()
      setItems(res.data)
      setSharing((s) => (s && s.id === id ? { ...s, visibility } : s))
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not change visibility')
    }
  }

  const load = () => dashboards.list().then((res) => setItems(res.data))
  useEffect(() => { load() }, [])

  const create = async (e) => {
    e.preventDefault()
    if (!name.trim()) return
    setError('')
    try {
      // "invite" is private plus people — the same visibility, so we create it
      // private and open the share panel straight away rather than making them
      // hunt for it afterwards
      const wantsInvite = newVisibility === 'invite'
      const res = await dashboards.create(
        name.trim(), wantsInvite ? 'private' : newVisibility,
      )
      setName('')
      setNewVisibility('workspace')
      await load()
      if (wantsInvite) setSharing(res.data)
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not create the dashboard')
    }
  }

  const rename = async (id, name) => {
    setError('')
    try {
      await dashboards.update(id, { name })
      load()
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not rename')
    }
  }

  const duplicate = async (id) => {
    await dashboards.duplicate(id)
    load()
  }

  const remove = async (id) => {
    if (!confirm('Delete this dashboard?')) return
    await dashboards.remove(id)
    load()
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Dashboards</h1>
          <p className="page-subtitle">
            {items.length === 0 ? 'No dashboards yet' : `${items.length} dashboard${items.length === 1 ? '' : 's'}`}
          </p>
        </div>
        <span className="spacer" />
        {canEdit && (
          <form onSubmit={create} className="field-row" style={{ maxWidth: 560 }}>
            <input placeholder="New dashboard name" value={name}
              onChange={(e) => setName(e.target.value)} style={{ flex: 2 }} />
            <select value={newVisibility} onChange={(e) => setNewVisibility(e.target.value)}
              style={{ flex: 1.4 }} aria-label="Who can see it">
              <option value="workspace">Whole workspace</option>
              <option value="private">Private</option>
              <option value="invite">Private — pick people…</option>
            </select>
            <button type="submit"><Plus size={15} /> Create</button>
          </form>
        )}
      </div>

      {error && <div className="error" style={{ marginBottom: 16 }}>{error}</div>}

      {items.length === 0 ? (
        <div className="empty-state">
          <LayoutDashboard size={32} />
          <p>{canEdit
            ? 'No dashboards yet — create one above to start pulling in data.'
            : 'No dashboards have been created yet.'}</p>
        </div>
      ) : (
        <div className="grid-cards">
          {items.map((d) => (
            <div className="card dashboard-card" key={d.id}>
              <h3>
                {canEdit ? (
                  <EditableTitle value={d.name} onSave={(name) => rename(d.id, name)} />
                ) : (
                  <Link to={`/dashboards/${d.id}`}>{d.name}</Link>
                )}
              </h3>
              <div className="muted">
                {d.definition.widgets?.length || 0} widgets
                {d.visibility === 'private' && (
                  <span className="status-pill" style={{ marginLeft: 8 }} title="Only you, people you invite, and admins">
                    <Lock size={11} /> Private
                  </span>
                )}
                {d.share_token && (
                  <span className="status-pill ok" style={{ marginLeft: 8 }} title="Anyone with the public link can view it">
                    <Share2 size={11} /> Public link
                  </span>
                )}
              </div>
              <div className="actions">
                <Link to={`/dashboards/${d.id}`}>
                  <button className="secondary small">
                    {canEdit ? 'Open' : 'View'} <ArrowRight size={13} />
                  </button>
                </Link>
                {canEdit && (
                  <>
                    {canManage(d) && (
                      <button className="secondary small icon" aria-label="Sharing"
                        title="Who can see this" onClick={() => setSharing(d)}>
                        <Users size={13} />
                      </button>
                    )}
                    <button className="secondary small icon" aria-label="Duplicate dashboard" title="Duplicate dashboard"
                      onClick={() => duplicate(d.id)}>
                      <Copy size={13} />
                    </button>
                    {canManage(d) && (
                      <button className="danger ghost small icon" aria-label="Delete dashboard" title="Delete dashboard" onClick={() => remove(d.id)}>
                        <Trash2 size={13} />
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {sharing && (
        <div className="modal-overlay" onClick={() => setSharing(null)}>
          <div className="card modal" onClick={(e) => e.stopPropagation()}>
            <div className="page-header" style={{ marginBottom: 14 }}>
              <h3 style={{ margin: 0 }}>Share “{sharing.name}”</h3>
              <span className="spacer" />
              <button className="secondary small icon" aria-label="Close"
                onClick={() => setSharing(null)}>
                <X size={14} />
              </button>
            </div>
            <SharePanel
              kind="dashboard"
              api={dashboards}
              id={sharing.id}
              visibility={sharing.visibility || 'workspace'}
              onVisibility={(v) => setVisibility(sharing.id, v)}
            />
          </div>
        </div>
      )}
    </div>
  )
}
