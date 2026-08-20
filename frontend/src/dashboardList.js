/**
 * Arranging the dashboard list: folders, and pins inside them.
 *
 * Folders are a plain string on each dashboard rather than a structure of
 * their own, so this file is the only place that knows how they behave. The
 * rules are deliberately boring, because a list that reorders itself in ways
 * you can't predict is worse than one that never reorders at all.
 */

/** Shown for dashboards that aren't in a folder. Not a real folder name. */
export const UNFILED = 'Ungrouped'

/** A folder name as stored: trimmed, or null when there isn't one. */
export function normaliseFolder(value) {
  if (value === null || value === undefined) return null
  const name = String(value).split(/\s+/).filter(Boolean).join(' ')
  return name || null
}

const byName = (a, b) =>
  String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true })

/**
 * Group dashboards into folders.
 *
 * Folders come out alphabetically with the unfiled ones last — last rather
 * than first because that section grows as people forget to file things, and
 * an ever-growing pile at the top would push the organised part off screen.
 *
 * Inside a folder, pinned dashboards lead, then the rest by name. Pinning is
 * scoped to the folder on purpose: a pin means "first in this group", not
 * "first in the whole app", so filing something never quietly demotes it.
 */
export function groupByFolder(items = []) {
  const groups = new Map()

  for (const item of items) {
    const folder = normaliseFolder(item.folder)
    const key = folder || UNFILED
    if (!groups.has(key)) groups.set(key, { name: key, filed: Boolean(folder), items: [] })
    groups.get(key).items.push(item)
  }

  for (const group of groups.values()) {
    group.items.sort((a, b) => {
      if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1
      return byName(a, b)
    })
  }

  return [...groups.values()].sort((a, b) => {
    if (a.filed !== b.filed) return a.filed ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { numeric: true })
  })
}

/** Existing folder names, for the "move to" picker. */
export function folderNames(items = []) {
  const names = new Set()
  for (const item of items) {
    const folder = normaliseFolder(item.folder)
    if (folder) names.add(folder)
  }
  return [...names].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
}
