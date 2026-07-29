import { describe, expect, it } from 'vitest'
import {
  buildOptions, computeStat, pivotSeries, resolveChartFields, visibleColumns,
} from './widgetData'
import { describeThreshold, evaluateThreshold } from './thresholds'

describe('buildOptions', () => {
  it('returns an empty payload for a bare widget', () => {
    expect(buildOptions({})).toEqual({})
    expect(buildOptions({ options: {} })).toEqual({})
  })

  it('passes through connector options', () => {
    expect(buildOptions({ options: { itemtype: 'Computer', max_rows: 500 } }))
      .toEqual({ itemtype: 'Computer', max_rows: 500 })
  })

  it('includes transform options so the server can apply them', () => {
    const opts = buildOptions({
      options: {
        group_by: 'status', aggregate: 'sum', value_column: 'cost',
        sort: { column: 'sum_cost', dir: 'desc' }, limit: 5,
        filters: [{ column: 'site', op: 'eq', value: 'Sentul' }],
      },
    })
    expect(opts.group_by).toBe('status')
    expect(opts.aggregate).toBe('sum')
    expect(opts.value_column).toBe('cost')
    expect(opts.sort).toEqual({ column: 'sum_cost', dir: 'desc' })
    expect(opts.limit).toBe(5)
    expect(opts.filters).toHaveLength(1)
  })

  it('omits an empty filter list and a sort with no column', () => {
    const opts = buildOptions({ options: { filters: [], sort: { dir: 'desc' } } })
    expect(opts).not.toHaveProperty('filters')
    expect(opts).not.toHaveProperty('sort')
  })

  it('drops aggregate when there is nothing to group by', () => {
    // stat widgets aggregate client-side; sending it alone would be meaningless
    expect(buildOptions({ options: { aggregate: 'sum' } })).toEqual({})
  })

  it('builds a prometheus range from minutes', () => {
    expect(buildOptions({ options: { range_minutes: '30' } }).range)
      .toEqual({ minutes: 30, step: '60s' })
  })
})

describe('computeStat', () => {
  const columns = ['name', 'value']
  const rows = [{ name: 'a', value: 10 }, { name: 'b', value: 20 }, { name: 'c', value: 30 }]

  it('defaults to the last value of the first numeric column', () => {
    expect(computeStat(rows, columns)).toEqual({ field: 'value', value: 30 })
  })

  it('sums, averages and counts', () => {
    expect(computeStat(rows, columns, { aggregate: 'sum' }).value).toBe(60)
    expect(computeStat(rows, columns, { aggregate: 'avg' }).value).toBe(20)
    expect(computeStat(rows, columns, { aggregate: 'count' }).value).toBe(3)
  })

  it('counts every row, including non-numeric ones', () => {
    const mixed = [{ v: 1 }, { v: null }, { v: 'x' }]
    expect(computeStat(mixed, ['v'], { aggregate: 'count' }).value).toBe(3)
  })

  it('rounds to two decimals', () => {
    expect(computeStat([{ v: 1 }, { v: 2 }], ['v'], { aggregate: 'avg' }).value).toBe(1.5)
    expect(computeStat([{ v: 1 }, { v: 1 }, { v: 2 }], ['v'], { aggregate: 'avg' }).value).toBe(1.33)
  })

  it('shows a dash rather than 0 when there are no rows', () => {
    expect(computeStat([], columns).value).toBe('—')
  })

  it('honours an explicit value field', () => {
    const r = [{ a: 1, b: 99 }]
    expect(computeStat(r, ['a', 'b'], { value_field: 'b' })).toEqual({ field: 'b', value: 99 })
  })
})

describe('pivotSeries', () => {
  it('leaves non-series rows alone', () => {
    const rows = [{ x: 1, y: 2 }]
    expect(pivotSeries(rows)).toEqual({ rows, seriesNames: [] })
  })

  it('pivots one row per timestamp with a column per series', () => {
    const rows = [
      { time: 100, series: 'api', value: 1 },
      { time: 100, series: 'web', value: 2 },
      { time: 200, series: 'api', value: 3 },
      { time: 200, series: 'web', value: 4 },
    ]
    const out = pivotSeries(rows)
    expect(out.seriesNames).toEqual(['api', 'web'])
    expect(out.rows).toEqual([
      { time: 100, api: 1, web: 2 },
      { time: 200, api: 3, web: 4 },
    ])
  })

  it('handles a series missing a point at one timestamp', () => {
    const out = pivotSeries([
      { time: 1, series: 'a', value: 1 },
      { time: 2, series: 'a', value: 2 },
      { time: 2, series: 'b', value: 9 },
    ])
    expect(out.rows[0].b).toBeUndefined()
    expect(out.rows[1].b).toBe(9)
  })

  it('survives empty input', () => {
    expect(pivotSeries([])).toEqual({ rows: [], seriesNames: [] })
  })
})

describe('resolveChartFields', () => {
  it('picks the first numeric column as the series', () => {
    const out = resolveChartFields(['label', 'count'], [{ label: 'a', count: 5 }])
    expect(out.xKey).toBe('label')
    expect(out.yKeys).toEqual(['count'])
  })

  it('respects explicit x and y fields', () => {
    const out = resolveChartFields(['a', 'b', 'c'], [{ a: 1, b: 2, c: 3 }],
      { x_field: 'c', y_field: 'a' })
    expect(out.xKey).toBe('c')
    expect(out.yKeys).toEqual(['a'])
  })

  it('reports no series when nothing is numeric', () => {
    expect(resolveChartFields(['a'], [{ a: 'text' }]).yKeys).toEqual([])
  })

  it('detects prometheus shape and pivots it', () => {
    const rows = [
      { time: 1700000000, series: 'up', value: 1 },
      { time: 1700000060, series: 'up', value: 0 },
    ]
    const out = resolveChartFields(['time', 'series', 'value'], rows)
    expect(out.xKey).toBe('time')
    expect(out.yKeys).toEqual(['up'])
    expect(typeof out.rows[0].time).toBe('string') // formatted for the axis
  })
})

describe('visibleColumns', () => {
  it('shows everything when no selection is made', () => {
    expect(visibleColumns(['a', 'b'], undefined)).toEqual(['a', 'b'])
    expect(visibleColumns(['a', 'b'], [])).toEqual(['a', 'b'])
  })

  it('filters to the selection, keeping the source order', () => {
    expect(visibleColumns(['a', 'b', 'c'], ['c', 'a'])).toEqual(['a', 'c'])
  })

  it('ignores names that are not real columns', () => {
    expect(visibleColumns(['a'], ['a', 'nope'])).toEqual(['a'])
  })
})

describe('evaluateThreshold', () => {
  const above = { direction: 'above', warn: 80, critical: 95 }
  const below = { direction: 'below', warn: 20, critical: 5 }

  it('returns null when no thresholds are set', () => {
    expect(evaluateThreshold(50, undefined)).toBeNull()
    expect(evaluateThreshold(50, { direction: 'above' })).toBeNull()
  })

  it('classifies values on the "above" side', () => {
    expect(evaluateThreshold(10, above)).toBe('ok')
    expect(evaluateThreshold(85, above)).toBe('warn')
    expect(evaluateThreshold(99, above)).toBe('critical')
  })

  it('treats the boundary as breached', () => {
    expect(evaluateThreshold(80, above)).toBe('warn')
    expect(evaluateThreshold(95, above)).toBe('critical')
  })

  it('classifies values on the "below" side', () => {
    expect(evaluateThreshold(50, below)).toBe('ok')
    expect(evaluateThreshold(15, below)).toBe('warn')
    expect(evaluateThreshold(2, below)).toBe('critical')
  })

  it('prefers critical when both are breached', () => {
    expect(evaluateThreshold(100, above)).toBe('critical')
  })

  it('works with only one threshold configured', () => {
    expect(evaluateThreshold(99, { direction: 'above', critical: 95 })).toBe('critical')
    expect(evaluateThreshold(10, { direction: 'above', critical: 95 })).toBe('ok')
  })

  it('ignores non-numeric values', () => {
    expect(evaluateThreshold('—', above)).toBeNull()
    expect(evaluateThreshold(null, above)).toBeNull()
  })

  it('accepts numeric strings from the config form', () => {
    expect(evaluateThreshold(85, { direction: 'above', warn: '80' })).toBe('warn')
  })
})

describe('describeThreshold', () => {
  it('says nothing when healthy', () => {
    expect(describeThreshold(10, { warn: 80 }, 'ok')).toBe('')
    expect(describeThreshold(10, { warn: 80 }, null)).toBe('')
  })

  it('explains which limit was crossed', () => {
    expect(describeThreshold('85', { direction: 'above', warn: 80, critical: 95 }, 'warn'))
      .toBe('85 is at or above the warn threshold of 80')
    expect(describeThreshold('2', { direction: 'below', warn: 20, critical: 5 }, 'critical'))
      .toBe('2 is at or below the critical threshold of 5')
  })
})
