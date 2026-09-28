import { Users } from 'lucide-react'

const AVATAR_COLORS = ['#00694A', '#B45309', '#2563EB', '#9333EA', '#BE123C', '#0F766E']

function initials(email) {
  const name = String(email || '?').split('@')[0].replace(/[._-]+/g, ' ').trim()
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?'
}

function colorFor(id) {
  return AVATAR_COLORS[Math.abs(Number(id) || 0) % AVATAR_COLORS.length]
}

export default function Collaborators({ users = [] }) {
  if (!users.length) return null

  const visible = users.slice(0, 5)
  const remaining = users.length - visible.length
  return (
    <div className="collaborators" aria-label={`${users.length} people viewing this dashboard`}>
      <div className="collaborator-avatars">
        {visible.map((user) => (
          <span key={user.id} className="collaborator-avatar"
            style={{ backgroundColor: colorFor(user.id) }} title={user.email}>
            {initials(user.email)}
          </span>
        ))}
        {remaining > 0 && <span className="collaborator-more">+{remaining}</span>}
      </div>
      <span className="collaborator-label"><Users size={13} /> {users.length} viewing</span>
    </div>
  )
}
