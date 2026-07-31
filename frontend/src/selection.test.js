import { describe, expect, it } from 'vitest'
import {
  canEmitSelection, crossFiltersFor, describeSelection, isSelected, toggleSelection,
} from './selection'
import { buildOptions } from './widgetData'

describe('toggleSelection', () => {
  it('sets a selection when there is none', () => {
    expect(toggleSelection(null, { column: 'status', value: 'gagal', sourceId: 'w1' }))
      .toEqual({ column: 'status', value: 'gagal', sourceId: 'w1' })
  })

  it('clears when the same value is clicked again', () => {
    const current = { column: 'status', value: 'gagal', sourceId: 'w1' }
    expect(toggleSelection(current, { column: 'status', value: 'gagal' })).toBeNull()
  })

  it('replaces when a different value in the same column is clicked', () => {
    const current = { column: 'status', value: 'gagal' }
    expect(toggleSelection(current, { column: 'status', value: 'sukses' }).value).toBe('sukses')
  })

  it('replaces when a different column is clicked', () => {
    const current = { column: 'status', value: 'gagal' }
    expect(toggleSelection(current, { column: 'site', value: 'Sentul' }).column).toBe('site')
  })

  it('compares values as strings so 1 and "1" match', () => {
    expect(toggleSelection({ column: 'id', value: 1 }, { column: 'id', value: '1' })).toBeNull()
  })

  it('ignores a click with no column', () => {
    expect(toggleSelection(null, { value: 'x' })).toBeNull()
    expect(toggleSelection(null, null)).toBeNull()
  })
})

describe('crossFiltersFor', () => {
  const selection = { column: 'status', value: 'gagal', sourceId: 'w1' }

  it('produces an eq filter for a receiving widget', () => {
    expect(crossFiltersFor({ id: 'w2', type: 'table' }, selection))
      .toEqual([{ column: 'status', op: 'eq', value: 'gagal' }])
  })

  it('returns nothing when there is no selection', () => {
    expect(crossFiltersFor({ id: 'w2' }, null)).toBeUndefined()
    expect(crossFiltersFor({ id: 'w2' }, {})).toBeUndefined()
  })

  it('does not filter the widget that raised the selection', () => {
    // otherwise clicking a slice would leave that pie showing one slice,
    // with no way to pick a different one
    expect(crossFiltersFor({ id: 'w1', type: 'pie' }, selection)).toBeUndefined()
  })

  it('respects a widget opting out', () => {
    expect(crossFiltersFor({ id: 'w2', options: { ignore_cross_filter: true } }, selection))
      .toBeUndefined()
  })
})

describe('canEmitSelection', () => {
  it('allows pie, bar and table', () => {
    for (const type of ['pie', 'bar', 'table']) {
      expect(canEmitSelection({ type }), type).toBe(true)
    }
  })

  it('excludes types with nothing discrete to click', () => {
    for (const type of ['stat', 'gauge', 'line', 'text']) {
      expect(canEmitSelection({ type }), type).toBe(false)
    }
  })

  it('respects an explicit opt-out', () => {
    expect(canEmitSelection({ type: 'pie', options: { emit_selection: false } })).toBe(false)
  })
})

describe('isSelected', () => {
  const selection = { column: 'status', value: 'gagal' }

  it('matches the selected column and value', () => {
    expect(isSelected(selection, 'status', 'gagal')).toBe(true)
  })

  it('does not match another value or column', () => {
    expect(isSelected(selection, 'status', 'sukses')).toBe(false)
    expect(isSelected(selection, 'site', 'gagal')).toBe(false)
  })

  it('compares loosely across types', () => {
    expect(isSelected({ column: 'id', value: 2 }, 'id', '2')).toBe(true)
  })

  it('is false with no selection', () => {
    expect(isSelected(null, 'a', 'b')).toBe(false)
  })
})

describe('describeSelection', () => {
  it('reads as column = value', () => {
    expect(describeSelection({ column: 'status', value: 'gagal' })).toBe('status = gagal')
  })

  it('is empty with no selection', () => {
    expect(describeSelection(null)).toBe('')
  })
})

describe('buildOptions with cross filters', () => {
  it('includes cross_filters when given', () => {
    const opts = buildOptions({ options: {} }, null,
      [{ column: 'status', op: 'eq', value: 'gagal' }])
    expect(opts.cross_filters).toHaveLength(1)
  })

  it('omits them when empty, so the payload stays clean', () => {
    expect(buildOptions({ options: {} }, null, [])).not.toHaveProperty('cross_filters')
    expect(buildOptions({ options: {} }, null, undefined)).not.toHaveProperty('cross_filters')
  })

  it('keeps configured filters separate from cross filters', () => {
    const opts = buildOptions(
      { options: { filters: [{ column: 'site', op: 'eq', value: 'Sentul' }] } },
      null,
      [{ column: 'status', op: 'eq', value: 'gagal' }]
    )
    expect(opts.filters).toHaveLength(1)
    expect(opts.cross_filters).toHaveLength(1)
    expect(opts.filters[0].column).toBe('site')
  })
})
