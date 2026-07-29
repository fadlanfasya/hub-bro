/**
 * Layout helpers shared by the dashboard editor and the public view.
 *
 * Stored dashboards keep layout as react-grid-layout-style entries
 * ({ i, x, y, w, h }) plus per-widget flags on the widget itself. gridstack
 * uses { id, x, y, w, h }, so these functions translate between the two and
 * keep old dashboards loading unchanged.
 */

const DEFAULTS = { w: 6, h: 4, minW: 2, minH: 2 }

/** Merge widgets with their layout entries into the items gridstack renders. */
export function toGridItems(widgets = [], layout = []) {
  const byId = new Map(layout.map((l) => [String(l.i), l]))
  return widgets.map((w, index) => {
    const l = byId.get(String(w.id)) || {}
    return {
      id: String(w.id),
      x: numberOr(l.x, 0),
      y: numberOr(l.y, index * DEFAULTS.h),
      w: numberOr(l.w, DEFAULTS.w),
      h: numberOr(l.h, DEFAULTS.h),
      minW: minSizeFor(w.type).w,
      minH: minSizeFor(w.type).h,
      locked: Boolean(w.locked),
      widget: w,
    }
  })
}

/** Convert gridstack's geometry back into the stored layout shape. */
export function toStoredLayout(gridItems = []) {
  return gridItems.map(({ i, id, x, y, w, h }) => ({
    i: String(i ?? id), x, y, w, h,
  }))
}

/** Where a new widget should go: a full-width-ish slot below everything else. */
export function nextSlot(layout = []) {
  const y = layout.reduce((max, l) => Math.max(max, (l.y || 0) + (l.h || 0)), 0)
  return { x: 0, y, w: DEFAULTS.w, h: DEFAULTS.h }
}

/** Minimum size per widget type, so charts can't be shrunk into illegibility. */
export function minSizeFor(type) {
  if (type === 'stat') return { w: 2, h: 2 }
  if (type === 'table') return { w: 3, h: 3 }
  return { w: 3, h: 3 }   // line / bar / pie need room for axes and a legend
}

/** True when a layout entry differs from the stored one — used to skip no-op saves. */
export function layoutsEqual(a = [], b = []) {
  if (a.length !== b.length) return false
  const key = (l) => `${l.i}:${l.x}:${l.y}:${l.w}:${l.h}`
  const setB = new Set(b.map(key))
  return a.every((l) => setB.has(key(l)))
}

function numberOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback
}
