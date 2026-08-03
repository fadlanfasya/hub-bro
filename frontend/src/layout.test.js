import { describe, expect, it } from 'vitest'
import {
  layoutsEqual, minSizeFor, nextSlot, toGridItems, toStoredLayout, widgetClass,
} from './layout'

describe('toGridItems', () => {
  const widgets = [
    { id: 'w1', type: 'line', title: 'CPU' },
    { id: 'w2', type: 'stat', title: 'Uptime', locked: true },
  ]
  const layout = [
    { i: 'w1', x: 0, y: 0, w: 6, h: 4 },
    { i: 'w2', x: 6, y: 0, w: 3, h: 2 },
  ]

  it('merges widgets with their layout entries', () => {
    const items = toGridItems(widgets, layout)
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ id: 'w1', x: 0, y: 0, w: 6, h: 4, locked: false })
    expect(items[1]).toMatchObject({ id: 'w2', x: 6, y: 0, w: 3, h: 2, locked: true })
  })

  it('keeps a reference to the original widget for rendering', () => {
    expect(toGridItems(widgets, layout)[0].widget).toBe(widgets[0])
  })

  it('never lets the type minimum enlarge a smaller saved widget', () => {
    // gridstack applies minW/minH on load, so a minimum above the saved size
    // would grow the widget every time the dashboard opened
    const tiny = toGridItems(
      [{ id: 'w1', type: 'line', title: 'Chart' }],
      [{ i: 'w1', x: 0, y: 0, w: 1, h: 1 }]
    )[0]
    expect(tiny.w).toBe(1)
    expect(tiny.h).toBe(1)
    expect(tiny.minW).toBeLessThanOrEqual(1)
    expect(tiny.minH).toBeLessThanOrEqual(1)
  })

  it('keeps a sensible floor for widgets at or above the minimum', () => {
    const roomy = toGridItems(
      [{ id: 'w1', type: 'line', title: 'Chart' }],
      [{ i: 'w1', x: 0, y: 0, w: 6, h: 4 }]
    )[0]
    expect(roomy.minW).toBe(minSizeFor('line').w)
    expect(roomy.minH).toBe(minSizeFor('line').h)
  })

  it('gives widgets with no layout entry a stacked position', () => {
    const items = toGridItems([{ id: 'a', type: 'stat' }, { id: 'b', type: 'stat' }], [])
    expect(items[0].y).toBe(0)
    expect(items[1].y).toBeGreaterThan(0)   // not all piled at 0,0
    expect(items[0].w).toBe(6)
  })

  it('matches ids across number/string types', () => {
    const items = toGridItems([{ id: 1, type: 'stat' }], [{ i: '1', x: 2, y: 3, w: 4, h: 5 }])
    expect(items[0]).toMatchObject({ x: 2, y: 3, w: 4, h: 5 })
  })

  it('survives a missing or malformed layout', () => {
    expect(() => toGridItems(widgets, undefined)).not.toThrow()
    expect(toGridItems(widgets, [{ i: 'w1' }])[0].w).toBe(6)  // falls back to defaults
  })

  it('handles empty input', () => {
    expect(toGridItems([], [])).toEqual([])
    expect(toGridItems()).toEqual([])
  })
})

describe('toStoredLayout', () => {
  it('converts gridstack geometry back to the stored shape', () => {
    expect(toStoredLayout([{ i: 'w1', x: 1, y: 2, w: 3, h: 4 }]))
      .toEqual([{ i: 'w1', x: 1, y: 2, w: 3, h: 4 }])
  })

  it('accepts gridstack\'s `id` key as well as `i`', () => {
    expect(toStoredLayout([{ id: 'w9', x: 0, y: 0, w: 2, h: 2 }])[0].i).toBe('w9')
  })

  it('round-trips through toGridItems without drift', () => {
    const widgets = [{ id: 'w1', type: 'bar', title: 'x' }]
    const layout = [{ i: 'w1', x: 3, y: 5, w: 4, h: 6 }]
    expect(toStoredLayout(toGridItems(widgets, layout))).toEqual(layout)
  })
})

describe('nextSlot', () => {
  it('places the first widget at the top', () => {
    expect(nextSlot([])).toMatchObject({ x: 0, y: 0 })
  })

  it('places a new widget below everything else', () => {
    const layout = [{ i: 'a', x: 0, y: 0, w: 6, h: 4 }, { i: 'b', x: 6, y: 2, w: 6, h: 3 }]
    expect(nextSlot(layout).y).toBe(5)   // max(0+4, 2+3)
  })

  it('tolerates entries missing geometry', () => {
    expect(nextSlot([{ i: 'a' }]).y).toBe(0)
  })
})

describe('minSizeFor', () => {
  it('lets stat and text widgets go narrower than charts', () => {
    expect(minSizeFor('stat').w).toBeLessThan(minSizeFor('line').w)
    expect(minSizeFor('text').w).toBeLessThan(minSizeFor('table').w)
  })

  it('stays small enough not to fight the user', () => {
    for (const type of ['stat', 'text', 'line', 'bar', 'pie', 'table', 'gauge']) {
      expect(minSizeFor(type).w, type).toBeLessThanOrEqual(2)
      expect(minSizeFor(type).h, type).toBeLessThanOrEqual(2)
    }
  })

  it('has a sensible default for unknown types', () => {
    expect(minSizeFor('something-new')).toEqual({ w: 2, h: 2 })
  })
})

describe('widgetClass', () => {
  it('is a plain widget by default', () => {
    expect(widgetClass({ options: {} }, false)).toBe('widget')
  })

  it('marks a locked widget', () => {
    expect(widgetClass({ options: {} }, true)).toBe('widget locked')
  })

  it('adds the background classes', () => {
    expect(widgetClass({ options: { widget_bg: 'soft' } }, false)).toBe('widget has-bg')
    expect(widgetClass({ options: { widget_bg: 'solid' } }, false))
      .toBe('widget has-bg bg-solid')
  })

  it('ignores an unknown background value', () => {
    expect(widgetClass({ options: { widget_bg: 'rainbow' } }, false)).toBe('widget')
  })

  it('survives a widget with no options', () => {
    expect(widgetClass({}, false)).toBe('widget')
    expect(widgetClass(undefined, false)).toBe('widget')
  })
})

describe('layoutsEqual', () => {
  const a = [{ i: 'w1', x: 0, y: 0, w: 6, h: 4 }]

  it('detects identical layouts regardless of order', () => {
    const two = [{ i: 'a', x: 0, y: 0, w: 1, h: 1 }, { i: 'b', x: 1, y: 0, w: 1, h: 1 }]
    expect(layoutsEqual(two, [two[1], two[0]])).toBe(true)
  })

  it('detects a moved widget', () => {
    expect(layoutsEqual(a, [{ i: 'w1', x: 1, y: 0, w: 6, h: 4 }])).toBe(false)
  })

  it('detects a resized widget', () => {
    expect(layoutsEqual(a, [{ i: 'w1', x: 0, y: 0, w: 6, h: 5 }])).toBe(false)
  })

  it('detects added or removed widgets', () => {
    expect(layoutsEqual(a, [])).toBe(false)
    expect(layoutsEqual(a, [...a, { i: 'w2', x: 0, y: 4, w: 6, h: 4 }])).toBe(false)
  })

  it('treats undefined as empty', () => {
    expect(layoutsEqual(undefined, [])).toBe(true)
  })
})
