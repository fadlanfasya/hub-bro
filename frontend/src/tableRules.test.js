import { describe, expect, it } from 'vitest'
import { isNumeric, nextSort, sortRows, toneForCell } from './tableRules'
import { parseInline, parseMarkdown } from './markdown'
import { computeTrend, formatTrend } from './format'

describe('sortRows', () => {
  const rows = [
    { name: 'beta', count: 10 },
    { name: 'alpha', count: 200 },
    { name: 'gamma', count: 30 },
  ]

  it('sorts numbers numerically, not as strings', () => {
    expect(sortRows(rows, 'count', 'asc').map((r) => r.count)).toEqual([10, 30, 200])
  })

  it('sorts descending', () => {
    expect(sortRows(rows, 'count', 'desc').map((r) => r.count)).toEqual([200, 30, 10])
  })

  it('sorts text alphabetically', () => {
    expect(sortRows(rows, 'name', 'asc').map((r) => r.name)).toEqual(['alpha', 'beta', 'gamma'])
  })

  it('sorts numeric strings as numbers', () => {
    const r = [{ v: '100' }, { v: '9' }, { v: '25' }]
    expect(sortRows(r, 'v', 'asc').map((x) => x.v)).toEqual(['9', '25', '100'])
  })

  it('sinks blanks regardless of direction', () => {
    const r = [{ v: 5 }, { v: null }, { v: 1 }]
    expect(sortRows(r, 'v', 'asc').map((x) => x.v)).toEqual([1, 5, null])
    expect(sortRows(r, 'v', 'desc').map((x) => x.v)).toEqual([5, 1, null])
  })

  it('does not mutate the input', () => {
    const original = [...rows]
    sortRows(rows, 'count', 'desc')
    expect(rows).toEqual(original)
  })

  it('returns the rows unchanged with no column', () => {
    expect(sortRows(rows, null)).toBe(rows)
  })
})

describe('nextSort', () => {
  it('cycles asc, desc, then off', () => {
    let s = nextSort(null, 'name')
    expect(s).toEqual({ column: 'name', direction: 'asc' })
    s = nextSort(s, 'name')
    expect(s).toEqual({ column: 'name', direction: 'desc' })
    expect(nextSort(s, 'name')).toBeNull()
  })

  it('starts fresh when a different column is clicked', () => {
    expect(nextSort({ column: 'a', direction: 'desc' }, 'b'))
      .toEqual({ column: 'b', direction: 'asc' })
  })
})

describe('isNumeric', () => {
  it('accepts numbers and numeric strings', () => {
    expect(isNumeric(5)).toBe(true)
    expect(isNumeric('42')).toBe(true)
    expect(isNumeric('3.14')).toBe(true)
  })

  it('rejects text, blanks and non-finite values', () => {
    expect(isNumeric('Running')).toBe(false)
    expect(isNumeric('')).toBe(false)
    expect(isNumeric(null)).toBe(false)
    expect(isNumeric(NaN)).toBe(false)
  })
})

describe('toneForCell', () => {
  const rules = [{ column: 'status', op: 'eq', value: 'Failed', tone: 'bad' }]

  it('colours a matching cell', () => {
    expect(toneForCell({ status: 'Failed' }, 'status', rules)).toBe('bad')
  })

  it('leaves non-matching cells alone', () => {
    expect(toneForCell({ status: 'Success' }, 'status', rules)).toBeNull()
  })

  it('does not colour other columns', () => {
    expect(toneForCell({ status: 'Failed', name: 'x' }, 'name', rules)).toBeNull()
  })

  it('colours the whole row when asked', () => {
    const wholeRow = [{ column: 'status', op: 'eq', value: 'Failed', tone: 'bad', whole_row: true }]
    expect(toneForCell({ status: 'Failed', name: 'x' }, 'name', wholeRow)).toBe('bad')
  })

  it('supports numeric comparisons', () => {
    const r = [{ column: 'errors', op: 'gt', value: 100, tone: 'warn' }]
    expect(toneForCell({ errors: 150 }, 'errors', r)).toBe('warn')
    expect(toneForCell({ errors: 50 }, 'errors', r)).toBeNull()
  })

  it('uses the first matching rule', () => {
    const many = [
      { column: 'n', op: 'gt', value: 10, tone: 'warn' },
      { column: 'n', op: 'gt', value: 5, tone: 'bad' },
    ]
    expect(toneForCell({ n: 20 }, 'n', many)).toBe('warn')
  })

  it('ignores incomplete rules', () => {
    expect(toneForCell({ a: 1 }, 'a', [{ column: '', tone: 'bad' }])).toBeNull()
    expect(toneForCell({ a: 1 }, 'a', [{ column: 'a' }])).toBeNull()
  })

  it('returns null with no rules', () => {
    expect(toneForCell({ a: 1 }, 'a', undefined)).toBeNull()
  })
})

describe('computeTrend', () => {
  it('returns nothing when no comparison is configured', () => {
    expect(computeTrend([{ v: 5 }], 'v', {})).toBeNull()
  })

  it('compares against another column', () => {
    const t = computeTrend([{ today: 110, yesterday: 100 }], 'today',
      { compare_field: 'yesterday' })
    expect(t.delta).toBe(10)
    expect(t.percent).toBeCloseTo(10)
    expect(t.direction).toBe('up')
    expect(t.tone).toBe('good')
  })

  it('compares against the previous row', () => {
    const t = computeTrend([{ v: 100 }, { v: 80 }], 'v', { compare_mode: 'previous_row' })
    expect(t.delta).toBe(-20)
    expect(t.direction).toBe('down')
  })

  it('treats a rise as bad when higher is worse', () => {
    const t = computeTrend([{ fails: 20, prev: 10 }], 'fails',
      { compare_field: 'prev', higher_is_better: false })
    expect(t.direction).toBe('up')
    expect(t.tone).toBe('bad')
  })

  it('reports a fall as good for a failure count', () => {
    const t = computeTrend([{ fails: 5, prev: 10 }], 'fails',
      { compare_field: 'prev', higher_is_better: false })
    expect(t.tone).toBe('good')
  })

  it('marks no change as flat', () => {
    const t = computeTrend([{ a: 10, b: 10 }], 'a', { compare_field: 'b' })
    expect(t.direction).toBe('flat')
    expect(t.tone).toBe('flat')
  })

  it('avoids dividing by a zero baseline', () => {
    const t = computeTrend([{ a: 10, b: 0 }], 'a', { compare_field: 'b' })
    expect(t.percent).toBeNull()
    expect(t.delta).toBe(10)
    expect(formatTrend(t, {})).toBe('10')
  })

  it('handles a negative baseline sensibly', () => {
    const t = computeTrend([{ a: -5, b: -10 }], 'a', { compare_field: 'b' })
    expect(t.delta).toBe(5)
    expect(t.percent).toBeCloseTo(50)
  })

  it('gives up on non-numeric values', () => {
    expect(computeTrend([{ a: 'x', b: 1 }], 'a', { compare_field: 'b' })).toBeNull()
    expect(computeTrend([{ a: 1 }], 'a', { compare_mode: 'previous_row' })).toBeNull()
  })
})

describe('formatTrend', () => {
  it('shows one decimal under 10 percent, none above', () => {
    expect(formatTrend({ percent: 8.14, delta: 1 }, {})).toBe('8.1%')
    expect(formatTrend({ percent: 42.7, delta: 1 }, {})).toBe('43%')
  })

  it('drops the sign — the arrow carries direction', () => {
    expect(formatTrend({ percent: -12.5, delta: -1 }, {})).toBe('13%')
  })
})

describe('parseInline', () => {
  it('returns plain text as one token', () => {
    expect(parseInline('hello')).toEqual([{ type: 'text', value: 'hello' }])
  })

  it('parses bold, italic and code', () => {
    expect(parseInline('**b**')[0]).toEqual({ type: 'bold', value: 'b' })
    expect(parseInline('*i*')[0]).toEqual({ type: 'italic', value: 'i' })
    expect(parseInline('`c`')[0]).toEqual({ type: 'code', value: 'c' })
  })

  it('leaves markers inside code spans literal', () => {
    const tokens = parseInline('`**not bold**`')
    expect(tokens).toHaveLength(1)
    expect(tokens[0]).toEqual({ type: 'code', value: '**not bold**' })
  })

  it('parses links', () => {
    expect(parseInline('[docs](https://x.com)')[0])
      .toEqual({ type: 'link', value: 'docs', href: 'https://x.com' })
  })

  it('refuses javascript: URLs, keeping only the label', () => {
    const tokens = parseInline('[click](javascript:alert(1))')
    expect(tokens[0].type).toBe('text')
    expect(tokens[0].value).toBe('click')
  })

  it('allows relative and mailto links', () => {
    expect(parseInline('[a](/dash)')[0].type).toBe('link')
    expect(parseInline('[b](mailto:x@y.com)')[0].type).toBe('link')
  })

  it('keeps surrounding text', () => {
    const tokens = parseInline('a **b** c')
    expect(tokens.map((t) => t.type)).toEqual(['text', 'bold', 'text'])
  })
})

describe('parseMarkdown', () => {
  it('parses headings at three levels', () => {
    const blocks = parseMarkdown('# One\n## Two\n### Three')
    expect(blocks.map((b) => b.level)).toEqual([1, 2, 3])
  })

  it('groups consecutive lines into one paragraph', () => {
    const blocks = parseMarkdown('line one\nline two')
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('paragraph')
  })

  it('splits paragraphs on a blank line', () => {
    expect(parseMarkdown('one\n\ntwo')).toHaveLength(2)
  })

  it('parses bullet and numbered lists', () => {
    const bullets = parseMarkdown('- a\n- b')[0]
    expect(bullets.type).toBe('list')
    expect(bullets.ordered).toBe(false)
    expect(bullets.items).toHaveLength(2)

    expect(parseMarkdown('1. a\n2. b')[0].ordered).toBe(true)
  })

  it('starts a new list when the style changes', () => {
    const blocks = parseMarkdown('- a\n1. b')
    expect(blocks).toHaveLength(2)
  })

  it('parses quotes and horizontal rules', () => {
    expect(parseMarkdown('> note')[0].type).toBe('quote')
    expect(parseMarkdown('---')[0].type).toBe('rule')
  })

  it('never emits raw html', () => {
    const blocks = parseMarkdown('<script>alert(1)</script>')
    expect(blocks[0].type).toBe('paragraph')
    // the tag survives only as literal text, which React escapes on render
    expect(blocks[0].inline[0].type).toBe('text')
  })

  it('handles empty and undefined input', () => {
    expect(parseMarkdown('')).toEqual([])
    expect(parseMarkdown(undefined)).toEqual([])
  })

  it('normalises windows line endings', () => {
    expect(parseMarkdown('# a\r\n\r\nb')).toHaveLength(2)
  })
})
