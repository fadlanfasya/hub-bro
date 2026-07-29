import { describe, expect, it } from 'vitest'
import { escapeCsvValue, toCsv, toFileName } from './export'
import { DEFAULT_RANGE, findRange, isTimeSeries, resolveRange, stepFor } from './timeRange'
import { gaugeFraction } from './components/Gauge'

describe('escapeCsvValue', () => {
  it('leaves plain values alone', () => {
    expect(escapeCsvValue('hello')).toBe('hello')
    expect(escapeCsvValue(42)).toBe('42')
  })

  it('renders null and undefined as empty', () => {
    expect(escapeCsvValue(null)).toBe('')
    expect(escapeCsvValue(undefined)).toBe('')
  })

  it('keeps zero and false rather than blanking them', () => {
    expect(escapeCsvValue(0)).toBe('0')
    expect(escapeCsvValue(false)).toBe('false')
  })

  it('quotes values containing a comma', () => {
    expect(escapeCsvValue('Sentul, Bogor')).toBe('"Sentul, Bogor"')
  })

  it('escapes embedded quotes by doubling them', () => {
    expect(escapeCsvValue('say "hi"')).toBe('"say ""hi"""')
  })

  it('quotes values containing newlines', () => {
    expect(escapeCsvValue('line1\nline2')).toBe('"line1\nline2"')
  })
})

describe('toCsv', () => {
  const columns = ['name', 'status', 'cost']
  const rows = [
    { name: 'vm1', status: 'Running', cost: 100 },
    { name: 'vm2', status: 'Stopped', cost: 0 },
  ]

  it('writes a header row followed by the data', () => {
    const lines = toCsv(columns, rows).split('\r\n')
    expect(lines[0]).toBe('name,status,cost')
    expect(lines[1]).toBe('vm1,Running,100')
    expect(lines).toHaveLength(3)
  })

  it('uses CRLF line endings so Excel is happy', () => {
    expect(toCsv(columns, rows)).toContain('\r\n')
  })

  it('emits only a header when there are no rows', () => {
    expect(toCsv(columns, [])).toBe('name,status,cost')
  })

  it('fills in blanks for missing keys', () => {
    expect(toCsv(columns, [{ name: 'vm3' }]).split('\r\n')[1]).toBe('vm3,,')
  })

  it('ignores keys not present in columns', () => {
    const csv = toCsv(['name'], [{ name: 'a', secret: 'x' }])
    expect(csv).not.toContain('secret')
    expect(csv).not.toContain('x')
  })

  it('escapes values that would break the format', () => {
    const csv = toCsv(['a'], [{ a: 'x,y' }])
    expect(csv.split('\r\n')[1]).toBe('"x,y"')
  })

  it('handles empty input', () => {
    expect(toCsv([], [])).toBe('')
  })
})

describe('toFileName', () => {
  it('slugifies the title and appends the date', () => {
    expect(toFileName('CPU Usage', 'csv')).toMatch(/^cpu-usage-\d{4}-\d{2}-\d{2}\.csv$/)
  })

  it('strips characters that upset file systems', () => {
    expect(toFileName('VMs: Sentul / Jakarta?', 'png')).toMatch(/^vms-sentul-jakarta-/)
  })

  it('collapses runs of separators', () => {
    expect(toFileName('a   ---   b', 'csv')).toMatch(/^a-b-/)
  })

  it('falls back when the title has nothing usable', () => {
    expect(toFileName('!!!', 'png')).toMatch(/^export-/)
    expect(toFileName('', 'csv')).toMatch(/^export-/)
    expect(toFileName(undefined, 'csv')).toMatch(/^export-/)
  })
})

describe('resolveRange', () => {
  const follower = { options: { follow_dashboard_range: true } }

  it('returns nothing for a widget that opted out', () => {
    expect(resolveRange({ options: {} }, '1h')).toBeNull()
    expect(resolveRange({}, '1h')).toBeNull()
  })

  it('inherits the dashboard range when following', () => {
    expect(resolveRange(follower, '6h')).toEqual({ minutes: 360, step: '5m' })
  })

  it('lets a fixed window override the dashboard', () => {
    const fixed = { options: { follow_dashboard_range: true, range_minutes: 30 } }
    expect(resolveRange(fixed, '7d').minutes).toBe(30)
  })

  it('honours an explicit step', () => {
    const fixed = { options: { range_minutes: 60, step: '10s' } }
    expect(resolveRange(fixed, '1h').step).toBe('10s')
  })

  it('picks a step matching the window when none is given', () => {
    expect(resolveRange({ options: { range_minutes: 10080 } }, null).step).toBe('1h')
  })

  it('ignores an invalid fixed window', () => {
    expect(resolveRange({ options: { range_minutes: 0 } }, null)).toBeNull()
    expect(resolveRange({ options: { range_minutes: 'abc' } }, null)).toBeNull()
  })

  it('returns nothing when the dashboard range is unknown', () => {
    expect(resolveRange(follower, 'not-a-range')).toBeNull()
    expect(resolveRange(follower, undefined)).toBeNull()
  })
})

describe('stepFor', () => {
  it('increases resolution as the window grows', () => {
    const steps = [15, 60, 360, 1440, 10080, 43200].map(stepFor)
    expect(new Set(steps).size).toBe(steps.length)   // each window gets its own step
    expect(stepFor(15)).toBe('15s')
    expect(stepFor(43200)).toBe('6h')
  })
})

describe('findRange / defaults', () => {
  it('resolves a known key', () => {
    expect(findRange('24h').minutes).toBe(1440)
  })

  it('returns null for an unknown key', () => {
    expect(findRange('99y')).toBeNull()
  })

  it('has a valid default', () => {
    expect(findRange(DEFAULT_RANGE)).toBeTruthy()
  })
})

describe('isTimeSeries', () => {
  it('is true for prometheus line and bar charts', () => {
    expect(isTimeSeries({ type: 'line' }, 'prometheus')).toBe(true)
    expect(isTimeSeries({ type: 'bar' }, 'prometheus')).toBe(true)
  })

  it('is false for other sources or widget types', () => {
    expect(isTimeSeries({ type: 'line' }, 'glpi')).toBe(false)
    expect(isTimeSeries({ type: 'table' }, 'prometheus')).toBe(false)
    expect(isTimeSeries({ type: 'stat' }, 'prometheus')).toBe(false)
  })
})

describe('gaugeFraction', () => {
  it('maps the value onto 0..1 across the scale', () => {
    expect(gaugeFraction(50, 0, 100)).toBe(0.5)
    expect(gaugeFraction(0, 0, 100)).toBe(0)
    expect(gaugeFraction(100, 0, 100)).toBe(1)
  })

  it('clamps values outside the scale', () => {
    expect(gaugeFraction(150, 0, 100)).toBe(1)
    expect(gaugeFraction(-20, 0, 100)).toBe(0)
  })

  it('supports a non-zero minimum', () => {
    expect(gaugeFraction(75, 50, 100)).toBe(0.5)
  })

  it('returns 0 rather than dividing by zero', () => {
    expect(gaugeFraction(5, 10, 10)).toBe(0)
  })

  it('returns 0 for non-numeric input', () => {
    expect(gaugeFraction('—', 0, 100)).toBe(0)
    expect(gaugeFraction(null, 0, 100)).toBe(0)
    expect(gaugeFraction(50, 0, NaN)).toBe(0)
  })
})
