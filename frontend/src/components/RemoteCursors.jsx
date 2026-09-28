import { MousePointer2 } from 'lucide-react'

const COLORS = ['#00694A', '#B45309', '#2563EB', '#9333EA', '#BE123C', '#0F766E']

function colorFor(id) {
  return COLORS[Math.abs(Number(id) || 0) % COLORS.length]
}

export default function RemoteCursors({ cursors = [], collaborators = [], currentUserId }) {
  return (
    <div className="remote-cursors" aria-hidden="true">
      {cursors.filter((cursor) => cursor.user_id !== currentUserId).map((cursor) => (
        <div key={cursor.user_id} className="remote-cursor"
          style={{ left: cursor.x, top: cursor.y, '--cursor-color': colorFor(cursor.user_id) }}>
          <MousePointer2 size={18} fill="var(--cursor-color)" />
          <span>{collaborators.find((user) => user.id === cursor.user_id)?.email || 'Collaborator'}</span>
        </div>
      ))}
    </div>
  )
}
