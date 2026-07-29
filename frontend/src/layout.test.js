import { describe, expect, it } from 'vitest'
import { layoutsEqual, minSizeFor, nextSlot, toGridItems, toStoredLayout } from './layout'

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

  it('applies a minimum size based on widget type', () => {
    const items = toGridItems(widgets, layout)
    expect(items[0].minW).toBe(3)   // chart
    expect(items[1].minW).toBe(2)   // stat card can go smaller
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
  it('lets stat cards be small but keeps charts readable', () => {
    expect(minSizeFor('stat').w).toBeLessThan(minSizeFor('line').w)
  })

  it('has a sensible default for unknown types', () => {
    expect(minSizeFor('something-new')).toEqual({ w: 3, h: 3 })
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
