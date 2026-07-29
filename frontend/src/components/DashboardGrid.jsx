import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { GridStack } from 'gridstack'
import 'gridstack/dist/gridstack.css'

/**
 * Dashboard grid built on gridstack.
 *
 * gridstack owns the item elements (it needs to create and position them), and
 * React renders each widget's content into that element through a portal. That
 * split avoids the two libraries fighting over the same DOM nodes.
 *
 * Props:
 *   items       [{ id, x, y, w, h, locked }]
 *   renderItem  (item) => ReactNode
 *   onChange    (items) => void   — fired after a drag/resize settles
 *   readOnly    disables all interaction (public + kiosk views)
 *   float       true = widgets stay where you drop them (no upward packing)
 */
export default function DashboardGrid({
  items = [],
  renderItem,
  onChange,
  readOnly = false,
  float = true,
  column = 12,
  cellHeight = 70,
  margin = 8,
  handle = '.widget-header',
}) {
  const containerRef = useRef(null)
  const gridRef = useRef(null)
  const nodesRef = useRef(new Map())      // id -> { el, contentEl }
  const onChangeRef = useRef(onChange)
  const [, forceRender] = useState(0)

  // keep the callback fresh without re-initialising the grid
  useEffect(() => { onChangeRef.current = onChange }, [onChange])

  // --- init once ---
  useLayoutEffect(() => {
    const grid = GridStack.init({
      column,
      cellHeight,
      margin,
      float,                       // no auto-compacting: things stay where you put them
      animate: true,
      handle,
      disableDrag: readOnly,
      disableResize: readOnly,
      staticGrid: readOnly,
      alwaysShowResizeHandle: 'mobile',
      resizable: { handles: 'se, sw, ne, nw, e, w, s, n' },
    }, containerRef.current)

    gridRef.current = grid

    const emit = () => {
      if (!onChangeRef.current) return
      // read positions straight from the engine so we never drift from what's shown
      const layout = grid.save(false).map((n) => ({
        i: n.id, x: n.x, y: n.y, w: n.w, h: n.h,
      }))
      onChangeRef.current(layout)
    }
    grid.on('change', emit)

    return () => {
      grid.off('change')
      grid.destroy(false)          // keep the DOM; React still owns the portals
      gridRef.current = null
      nodesRef.current.clear()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // --- add / remove items to match props ---
  useLayoutEffect(() => {
    const grid = gridRef.current
    if (!grid) return

    const wanted = new Map(items.map((it) => [String(it.id), it]))
    let changed = false

    grid.batchUpdate()

    // remove widgets that are gone
    for (const [id, node] of nodesRef.current) {
      if (!wanted.has(id)) {
        grid.removeWidget(node.el, true, false)
        nodesRef.current.delete(id)
        changed = true
      }
    }

    // add widgets that are new
    for (const [id, item] of wanted) {
      if (nodesRef.current.has(id)) continue
      const el = grid.addWidget({
        id,
        x: item.x, y: item.y, w: item.w, h: item.h,
        minW: item.minW ?? 2,
        minH: item.minH ?? 2,
        noMove: readOnly || Boolean(item.locked),
        noResize: readOnly || Boolean(item.locked),
        locked: Boolean(item.locked),
        content: '',
      })
      const contentEl = el.querySelector('.grid-stack-item-content')
      nodesRef.current.set(id, { el, contentEl })
      changed = true
    }

    grid.batchUpdate(false)
    if (changed) forceRender((n) => n + 1)   // mount/unmount the portals
  }, [items, readOnly])

  // --- keep lock state and externally-changed geometry in sync ---
  useLayoutEffect(() => {
    const grid = gridRef.current
    if (!grid) return

    grid.batchUpdate()
    for (const item of items) {
      const node = nodesRef.current.get(String(item.id))
      if (!node) continue
      const locked = Boolean(item.locked)
      grid.update(node.el, {
        locked,
        noMove: readOnly || locked,
        noResize: readOnly || locked,
      })
      node.el.classList.toggle('is-locked', locked)
    }
    grid.batchUpdate(false)
  }, [items, readOnly])

  return (
    <div ref={containerRef} className="grid-stack">
      {items.map((item) => {
        const node = nodesRef.current.get(String(item.id))
        return node?.contentEl
          ? createPortal(renderItem(item), node.contentEl, String(item.id))
          : null
      })}
    </div>
  )
}
