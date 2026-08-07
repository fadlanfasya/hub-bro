import { KeyRound, Pencil, X, Check } from 'lucide-react'

/**
 * Input for a stored credential.
 *
 * Once a secret is saved you never see it again and you never have to retype
 * it: the field collapses to a "saved" row with a Change button. Only when you
 * press Change does an input appear, so a routine edit (renaming a source,
 * changing a port) can't accidentally wipe the password.
 *
 * `value === null` means untouched — the caller then sends the mask back and
 * the server keeps whatever it already has.
 */
export default function SecretField({
  label, hint, value, onChange, hasStored, placeholder = '', required = false,
}) {
  const editing = value !== null

  if (hasStored && !editing) {
    return (
      <>
        <label>{label}</label>
        <div className="secret-saved">
          <KeyRound size={14} />
          <span className="secret-dots">••••••••</span>
          <span className="secret-note"><Check size={11} /> Saved</span>
          <span style={{ flex: 1 }} />
          <button type="button" className="secondary small" onClick={() => onChange('')}>
            <Pencil size={12} /> Change
          </button>
        </div>
        {hint && <p className="hint">{hint}</p>}
      </>
    )
  }

  return (
    <>
      <label>{label}</label>
      <div className="field-row">
        <input type="password" autoComplete="new-password"
          value={value ?? ''} placeholder={placeholder}
          required={required && !hasStored}
          onChange={(e) => onChange(e.target.value)} />
        {hasStored && (
          <button type="button" className="secondary" title="Keep the saved value"
            onClick={() => onChange(null)}>
            <X size={14} />
          </button>
        )}
      </div>
      {hint && <p className="hint">{hint}</p>}
      {hasStored && (
        <p className="hint">Leaving this blank keeps the saved value — it is never erased by an empty field.</p>
      )}
    </>
  )
}
