import { useEffect, useRef, useState } from 'react'
import { Pencil } from 'lucide-react'

/**
 * Click-to-edit text. Enter or clicking away saves, Escape cancels.
 *
 * Saving is left to the caller so it can go through the same conflict-checked
 * path as any other change — a rename is a normal edit, not a special case.
 */
export default function EditableTitle({
  value, onSave, className = '', disabled = false, placeholder = 'Untitled',
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const inputRef = useRef(null)

  // pick up an external rename (a history restore, say) while not editing
  useEffect(() => { if (!editing) setDraft(value) }, [value, editing])

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  const commit = () => {
    const next = draft.trim()
    setEditing(false)
    if (!next || next === value) {
      setDraft(value)   // empty or unchanged: leave it alone
      return
    }
    onSave(next)
  }

  const cancel = () => {
    setDraft(value)
    setEditing(false)
  }

  if (disabled) return <span className={className}>{value}</span>

  if (editing) {
    return (
      <input
        ref={inputRef}
        className={`editable-title-input ${className}`}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit() }
          if (e.key === 'Escape') { e.preventDefault(); cancel() }
        }}
      />
    )
  }

  return (
    <button type="button" className={`editable-title ${className}`}
      title="Rename" onClick={() => setEditing(true)}>
      {value || placeholder}
      <Pencil size={13} />
    </button>
  )
}
