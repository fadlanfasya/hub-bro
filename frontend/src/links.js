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

/**
 * Remember which dashboard a link was followed from.
 *
 * Drilling from an overview into a detail dashboard and then pressing back
 * should return to the overview, not dump you in the dashboard list — the
 * overview is where you were working. The origin rides in the URL rather than
 * in memory so it survives a refresh and a copied link.
 *
 * Only same-app dashboard links get it: an external ticket URL has no business
 * carrying our dashboard ids, and adding a parameter to someone else's URL can
 * change what it does.
 */
const DASHBOARD_PATH = /^\/dashboards\/[^/?#]+/

export function isDashboardLink(url) {
  return typeof url === 'string' && DASHBOARD_PATH.test(url.trim())
}

export function withOrigin(url, fromId) {
  if (!isDashboardLink(url) || fromId === null || fromId === undefined || fromId === '') {
    return url
  }
  // don't overwrite an origin the author set deliberately
  const [path, hash = ''] = String(url).split('#')
  if (/[?&]from=/.test(path)) return url
  const joiner = path.includes('?') ? '&' : '?'
  return `${path}${joiner}from=${encodeURIComponent(fromId)}${hash ? `#${hash}` : ''}`
}

/**
 * Text to seed a table's search box with, taken from `?q=` in the URL.
 *
 * This is what makes a drill-down link land on the row it named: a ticket table
 * links to a detail page with `?q={ticket_id}`, and the detail page opens
 * already narrowed to that ticket instead of showing five thousand rows and
 * expecting you to find it.
 *
 * It filters rows the browser already has — it does not change what the server
 * sends. That keeps a public link from being able to steer a query, which is
 * the whole reason the public route reads its options from the stored dashboard
 * rather than from the request.
 */
export function searchFromUrl(search) {
  const q = new URLSearchParams(search || '').get('q')
  return typeof q === 'string' ? q.trim() : ''
}

/** Where the back button should go, given the current query string. */
export function backTarget(search) {
  const from = new URLSearchParams(search || '').get('from')
  // an id we can't recognise is ignored rather than trusted into a bad route
  if (!from || !/^\d+$/.test(from)) return { to: '/', fromId: null }
  return { to: `/dashboards/${from}`, fromId: Number(from) }
}
