import { describe, expect, it } from 'vitest'
import { lastPointTone, pointsAttr, seriesFor, sparkPoints } from './sparkline'

describe('seriesFor', () => {
  const rows = [{ v: 1 }, { v: 2 }, { v: 3 }]

  it('pulls a column in row order', () => {
    expect(seriesFor(rows, 'v')).toEqual([1, 2, 3])
  })

  it('coerces numeric strings, which is what SQL drivers often return', () => {
    expect(seriesFor([{ v: '1' }, { v: '2.5' }], 'v')).toEqual([1, 2.5])
  })

  it('drops non-numeric values rather than plotting NaN', () => {
    expect(seriesFor([{ v: 1 }, { v: 'n/a' }, { v: 3 }], 'v')).toEqual([1, 3])
  })

  it('drops nulls instead of reading them as zero', () => {
    // Number(null) is 0, which would draw a plunge to the axis and look
    // identical to the metric actually collapsing
    expect(seriesFor([{ v: 1 }, { v: null }, { v: 3 }], 'v')).toEqual([1, 3])
    expect(seriesFor([{ v: 1 }, {}, { v: 3 }], 'v')).toEqual([1, 3])
    expect(seriesFor([{ v: 1 }, { v: '' }, { v: 3 }], 'v')).toEqual([1, 3])
  })

  it('does not treat booleans as numbers', () => {
    expect(seriesFor([{ v: true }, { v: 2 }], 'v')).toEqual([2])
  })

  it('keeps zero, which is a real measurement', () => {
    expect(seriesFor([{ v: 0 }, { v: 5 }], 'v')).toEqual([0, 5])
  })

  it('keeps negatives', () => {
    expect(seriesFor([{ v: -4 }, { v: 2 }], 'v')).toEqual([-4, 2])
  })

  it('handles missing input safely', () => {
    expect(seriesFor(null, 'v')).toEqual([])
    expect(seriesFor(rows, undefined)).toEqual([])
    expect(seriesFor([], 'v')).toEqual([])
  })
})

describe('sparkPoints geometry', () => {
  const W = 100
  const H = 20
  const PAD = 1.5

  it('needs at least two points — one is not a trend', () => {
    expect(sparkPoints([5], W, H)).toEqual([])
    expect(sparkPoints([], W, H)).toEqual([])
  })

  it('spans the full width, first to last', () => {
    const p = sparkPoints([1, 2, 3], W, H)
    expect(p[0][0]).toBe(0)
    expect(p[p.length - 1][0]).toBe(W)
  })

  it('spaces points evenly', () => {
    const xs = sparkPoints([1, 2, 3, 4, 5], W, H).map(([x]) => x)
    expect(xs).toEqual([0, 25, 50, 75, 100])
  })

  it('puts the highest value at the top and the lowest at the bottom', () => {
    const p = sparkPoints([10, 30, 20], W, H)
    const ys = p.map(([, y]) => y)
    // SVG y grows downward, so the max value has the smallest y
    expect(ys[1]).toBeLessThan(ys[2])
    expect(ys[2]).toBeLessThan(ys[0])
  })

  it('keeps every point inside the box, allowing for the stroke', () => {
    for (const values of [[0, 100], [5, 5, 5], [-50, 0, 50], [1, 1000, 2]]) {
      for (const [x, y] of sparkPoints(values, W, H)) {
        expect(x).toBeGreaterThanOrEqual(0)
        expect(x).toBeLessThanOrEqual(W)
        expect(y).toBeGreaterThanOrEqual(PAD)
        expect(y).toBeLessThanOrEqual(H - PAD)
      }
    }
  })

  it('centres a flat series instead of dividing by zero', () => {
    // this is the silent failure: NaN in the points attribute draws nothing,
    // so a steady metric would look like a broken widget
    const p = sparkPoints([7, 7, 7, 7], W, H)
    expect(p.every(([, y]) => y === H / 2)).toBe(true)
    expect(p.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))).toBe(true)
  })

  it('handles a flat series of zeroes', () => {
    const p = sparkPoints([0, 0, 0], W, H)
    expect(p.every(([, y]) => Number.isFinite(y))).toBe(true)
  })

  it('never emits a non-finite coordinate', () => {
    const cases = [[1, 2], [0, 0], [-1, -1], [1e9, 1], [0.0001, 0.0002], [5, 5, 5]]
    for (const values of cases) {
      for (const [x, y] of sparkPoints(values, W, H)) {
        expect(Number.isFinite(x)).toBe(true)
        expect(Number.isFinite(y)).toBe(true)
      }
    }
  })

  it('refuses a box too short to draw in', () => {
    expect(sparkPoints([1, 2], W, 2)).toEqual([])
    expect(sparkPoints([1, 2], 0, H)).toEqual([])
  })

  it('scales monotonically — a bigger value is never lower on screen', () => {
    const values = [3, 9, 1, 7, 5]
    const p = sparkPoints(values, W, H)
    const pairs = values.map((v, i) => [v, p[i][1]]).sort((a, b) => a[0] - b[0])
    for (let i = 1; i < pairs.length; i++) {
      expect(pairs[i][1]).toBeLessThanOrEqual(pairs[i - 1][1])
    }
  })
})

describe('pointsAttr', () => {
  it('formats for an SVG polyline', () => {
    expect(pointsAttr([[0, 10], [50, 2.25]])).toBe('0.0,10.0 50.0,2.3')
  })

  it('produces nothing for no points', () => {
    expect(pointsAttr([])).toBe('')
  })

  it('never emits NaN into the attribute', () => {
    const attr = pointsAttr(sparkPoints([4, 4, 4], 80, 20))
    expect(attr).not.toContain('NaN')
  })
})

describe('lastPointTone', () => {
  it('a rise is good when higher is better', () => {
    expect(lastPointTone([1, 2], true)).toBe('good')
  })

  it('a rise is bad for a failure count', () => {
    expect(lastPointTone([1, 2], false)).toBe('bad')
  })

  it('a fall is good for a failure count', () => {
    expect(lastPointTone([5, 2], false)).toBe('good')
  })

  it('no change is flat', () => {
    expect(lastPointTone([3, 3], true)).toBe('flat')
  })

  it('too little data is flat, not a guess', () => {
    expect(lastPointTone([3], true)).toBe('flat')
    expect(lastPointTone([], true)).toBe('flat')
  })
})
