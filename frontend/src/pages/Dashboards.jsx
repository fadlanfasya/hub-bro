import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { LayoutDashboard, Plus, Trash2, ArrowRight, Copy, Share2 } from 'lucide-react'
import { dashboards } from '../api'
import { useAuth } from '../useAuth'

export default function Dashboards() {
  const { can } = useAuth()
  const canEdit = can('dashboard.edit')
  const [items, setItems] = useState([])
  const [name, setName] = useState('')

  const load = () => dashboards.list().then((res) => setItems(res.data))
  useEffect(() => { load() }, [])

  const create = async (e) => {
    e.preventDefault()
    if (!name.trim()) return
    await dashboards.create(name.trim())
    setName('')
    load()
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
          <form onSubmit={create} className="field-row" style={{ maxWidth: 340 }}>
            <input placeholder="New dashboard name" value={name} onChange={(e) => setName(e.target.value)} />
            <button type="submit"><Plus size={15} /> Create</button>
          </form>
        )}
      </div>

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
              <h3><Link to={`/dashboards/${d.id}`}>{d.name}</Link></h3>
              <div className="muted">
                {d.definition.widgets?.length || 0} widgets
                {d.share_token && (
                  <span className="status-pill ok" style={{ marginLeft: 8 }}>
                    <Share2 size={11} /> Shared
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
                    <button className="secondary small icon" aria-label="Duplicate dashboard" title="Duplicate dashboard"
                      onClick={() => duplicate(d.id)}>
                      <Copy size={13} />
                    </button>
                    <button className="danger ghost small icon" aria-label="Delete dashboard" title="Delete dashboard" onClick={() => remove(d.id)}>
                      <Trash2 size={13} />
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
