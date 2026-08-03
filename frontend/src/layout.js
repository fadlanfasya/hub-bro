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
    const width = numberOr(l.w, DEFAULTS.w)
    const height = numberOr(l.h, DEFAULTS.h)
    const min = minSizeFor(w.type)

    return {
      id: String(w.id),
      x: numberOr(l.x, 0),
      y: numberOr(l.y, index * DEFAULTS.h),
      w: width,
      h: height,
      // Never let the type minimum enlarge a widget that was deliberately
      // saved smaller. gridstack applies minW/minH when loading, so a bare
      // `min.w` would silently grow small widgets every time the dashboard
      // opened. Clamping to the stored size keeps the floor for new widgets
      // while leaving existing layouts exactly as saved.
      minW: Math.min(min.w, width),
      minH: Math.min(min.h, height),
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

/**
 * Class list for a widget card, covering lock state and any coloured
 * background. Shared by the editor and the public view so a shared dashboard
 * looks identical to the one you built.
 */
export function widgetClass(widget, locked) {
  const bg = widget?.options?.widget_bg
  return [
    'widget',
    locked ? 'locked' : '',
    bg === 'soft' || bg === 'solid' ? 'has-bg' : '',
    bg === 'solid' ? 'bg-solid' : '',
  ].filter(Boolean).join(' ')
}

/**
 * Starting minimum size for a newly added widget — a hint, not a rule.
 * Kept deliberately small: it's your dashboard, and a cramped chart is your
 * call to make. `toGridItems` clamps these to any smaller saved size.
 */
export function minSizeFor(type) {
  if (type === 'stat' || type === 'text') return { w: 1, h: 2 }
  return { w: 2, h: 2 }
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
