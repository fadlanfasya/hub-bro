/**
 * Dashboard cross-filtering.
 *
 * Clicking a pie slice, bar, or table row selects a value. Every other widget
 * then filters to it — but only if it actually has that column, so a selection
 * on `status` leaves an unrelated widget alone rather than emptying it.
 *
 * Selections are transient: they live in component state, never in the saved
 * dashboard, so nobody comes back tomorrow to a dashboard stuck on one filter.
 *
 * They're also sent as `cross_filters`, which the backend treats as a transform.
 * That keeps them out of the cache key, so clicking a slice re-filters cached
 * data instead of re-querying the database.
 */

/** Toggle a selection: clicking the same value again clears it. */
export function toggleSelection(current, next) {
  if (!next?.column) return null
  if (current && current.column === next.column && String(current.value) === String(next.value)) {
    return null
  }
  return { column: next.column, value: next.value, sourceId: next.sourceId }
}

/** The `cross_filters` payload for a widget, or undefined when it shouldn't filter. */
export function crossFiltersFor(widget, selection) {
  if (!selection?.column) return undefined
  // the widget that raised the selection keeps showing every category, so you
  // can still see the whole breakdown and click a different slice
  if (selection.sourceId && selection.sourceId === widget?.id) return undefined
  if (widget?.options?.ignore_cross_filter) return undefined
  return [{ column: selection.column, op: 'eq', value: selection.value }]
}

/** True when this widget can raise selections. */
export function canEmitSelection(widget) {
  if (widget?.options?.emit_selection === false) return false
  return ['pie', 'bar', 'table'].includes(widget?.type)
}

/** Is this the currently selected value, for highlighting? */
export function isSelected(selection, column, value) {
  if (!selection?.column) return false
  return selection.column === column && String(selection.value) === String(value)
}

/** Human-readable chip label. */
export function describeSelection(selection) {
  if (!selection?.column) return ''
  return `${selection.column} = ${selection.value}`
}
