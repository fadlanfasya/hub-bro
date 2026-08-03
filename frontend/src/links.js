/**
 * Linking out of a dashboard — to another dashboard, or to an external system.
 *
 * The main use is a table column that becomes clickable: give it a template
 * like `https://helpdesk/ticket/{ticket_id}` and each row links to its own
 * record. `{column}` placeholders are filled from the row and URL-encoded, so a
 * subject containing spaces or an ampersand can't break the link.
 *
 * Only http, https, mailto and same-app paths are allowed. `javascript:` and
 * `data:` are rejected outright — dashboards get shared publicly, and a widget
 * config is exactly the kind of place someone could hide a script.
 */

const SAFE_SCHEME = /^(https?:\/\/|mailto:)/i
const INTERNAL = /^\//

export function isInternalLink(url) {
  return typeof url === 'string' && INTERNAL.test(url)
}

export function isSafeUrl(url) {
  if (typeof url !== 'string') return false
  const trimmed = url.trim()
  if (!trimmed) return false
  return SAFE_SCHEME.test(trimmed) || INTERNAL.test(trimmed)
}

/** Which columns a template refers to, so the config UI can hint at typos. */
export function templateColumns(template) {
  if (typeof template !== 'string') return []
  return [...template.matchAll(/\{([^}]+)\}/g)].map((m) => m[1].trim())
}

/**
 * Fill a template from a row.
 * Returns null when the URL would be unsafe or a placeholder has no value —
 * better to render plain text than a link to `/ticket/undefined`.
 */
export function buildLinkUrl(template, row = {}) {
  if (typeof template !== 'string' || !template.trim()) return null

  let missing = false
  const filled = template.replace(/\{([^}]+)\}/g, (_, name) => {
    const value = row[name.trim()]
    if (value === null || value === undefined || value === '') {
      missing = true
      return ''
    }
    return encodeURIComponent(String(value))
  })

  if (missing) return null
  return isSafeUrl(filled) ? filled : null
}

/** Props for an anchor, so callers don't repeat the rel/target dance. */
export function linkProps(url) {
  if (isInternalLink(url)) return { to: url, internal: true }
  return { href: url, target: '_blank', rel: 'noopener noreferrer', internal: false }
}
