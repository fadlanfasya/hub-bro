import { describe, expect, it } from 'vitest'
import {
  buildOptions, computeStat, fillDetail, pivotSeries, resolveChartFields, visibleColumns,
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

describe('fillDetail — supporting numbers on a stat tile', () => {
  const cols = ['on_track', 'warning', 'breach', 'label']
  const rows = [{ on_track: 13, warning: 0, breach: 2, label: 'today' }]

  it('substitutes columns from the same row', () => {
    expect(fillDetail('{on_track} on track · {warning} warning', rows, cols))
      .toBe('13 on track · 0 warning')
  })

  it('keeps the surrounding text verbatim', () => {
    expect(fillDetail('of {breach} breached, {warning} at risk', rows, cols))
      .toBe('of 2 breached, 0 at risk')
  })

  it('renders zero rather than treating it as missing', () => {
    expect(fillDetail('{warning}', rows, cols)).toBe('0')
  })

  it('shows an em dash for a column that is not in the query', () => {
    // a typo should look like missing data, not like broken markup
    expect(fillDetail('{on_trak} on track', rows, cols)).toBe('— on track')
  })

  it('returns empty string when no template is set', () => {
    expect(fillDetail('', rows, cols)).toBe('')
    expect(fillDetail(undefined, rows, cols)).toBe('')
    expect(fillDetail('   ', rows, cols)).toBe('')
  })

  it('passes non-templated text through untouched', () => {
    expect(fillDetail('no placeholders here', rows, cols)).toBe('no placeholders here')
  })

  it('tolerates whitespace inside the braces', () => {
    expect(fillDetail('{ breach }', rows, cols)).toBe('2')
  })

  it('carries string columns through', () => {
    expect(fillDetail('as of {label}', rows, cols)).toBe('as of today')
  })

  it('applies the formatter to numbers', () => {
    expect(fillDetail('{on_track}', rows, cols, {}, (v) => `${v}!`)).toBe('13!')
  })

  it('reduces with the same aggregate as the headline value', () => {
    // two numbers on one tile counted different ways would mislead
    const many = [{ a: 1, b: 10 }, { a: 2, b: 20 }, { a: 3, b: 30 }]
    const c = ['a', 'b']
    expect(fillDetail('{b}', many, c, { aggregate: 'sum' })).toBe('60')
    expect(fillDetail('{b}', many, c, { aggregate: 'avg' })).toBe('20')
    expect(fillDetail('{b}', many, c, { aggregate: 'last' })).toBe('30')
    expect(fillDetail('{b}', many, c, { aggregate: 'count' })).toBe('3')
  })

  it('survives an empty result set', () => {
    expect(fillDetail('{on_track} open', [], cols)).toBe('— open')
  })

  it('never aggregates a text column', () => {
    // regression: summing strings produced 0, which looked like a measurement
    const many = [{ n: 1, s: 'first' }, { n: 2, s: 'gagal' }]
    const c = ['n', 's']
    for (const aggregate of ['sum', 'avg', 'min', 'max', 'last', 'count']) {
      expect(fillDetail('{s}', many, c, { aggregate })).toBe('gagal')
    }
    expect(fillDetail('{n}', many, c, { aggregate: 'sum' })).toBe('3')
  })

  it('shows an em dash for a blank text value', () => {
    expect(fillDetail('{s}', [{ s: '' }], ['s'])).toBe('—')
    expect(fillDetail('{s}', [{ s: null }], ['s'])).toBe('—')
  })

  it('does not leave braces on screen for a repeated placeholder', () => {
    expect(fillDetail('{breach} and {breach}', rows, cols)).toBe('2 and 2')
  })
})

describe('buildOptions passes date_diff through', () => {
  it('sends a configured date column', () => {
    const opts = buildOptions({
      options: { date_diff: [{ column: 'expire', as: 'days_left', unit: 'days' }] },
    })
    expect(opts.date_diff).toEqual([{ column: 'expire', as: 'days_left', unit: 'days' }])
  })

  it('drops half-filled rows left behind by the form', () => {
    const opts = buildOptions({
      options: { date_diff: [{ column: 'expire' }, { column: '', as: 'x' }, {}] },
    })
    expect(opts.date_diff).toEqual([{ column: 'expire' }])
  })

  it('omits the key entirely when nothing is configured', () => {
    expect(buildOptions({ options: {} }).date_diff).toBeUndefined()
    expect(buildOptions({ options: { date_diff: [] } }).date_diff).toBeUndefined()
  })
})
