import { describe, expect, it } from 'vitest'
import { formatStatValue } from './format'

describe('formatStatValue', () => {
  it('groups thousands by default', () => {
    expect(formatStatValue(11381)).toBe('11,381')
  })

  it('can drop the grouping separator', () => {
    expect(formatStatValue(11381, { thousands: false })).toBe('11381')
  })

  it('applies a fixed number of decimals', () => {
    expect(formatStatValue(99.4567, { decimals: 2 })).toBe('99.46')
    expect(formatStatValue(99, { decimals: 2 })).toBe('99.00')
    expect(formatStatValue(99.4567, { decimals: 0 })).toBe('99')
  })

  it('treats a blank decimals field as "leave it alone"', () => {
    expect(formatStatValue(99.5, { decimals: '' })).toBe('99.5')
    expect(formatStatValue(99.5, { decimals: null })).toBe('99.5')
  })

  it('trims runaway float precision when no decimals are set', () => {
    expect(formatStatValue(0.30000000000000004)).toBe('0.3')
  })

  it('wraps the number in a prefix and suffix', () => {
    expect(formatStatValue(1500, { prefix: 'Rp ' })).toBe('Rp 1,500')
    expect(formatStatValue(240, { suffix: ' ms' })).toBe('240 ms')
    expect(formatStatValue(99.9, { prefix: '~', suffix: '%', decimals: 1 })).toBe('~99.9%')
  })

  it('shortens large numbers in compact mode, keeping one decimal', () => {
    expect(formatStatValue(1200000, { compact: true })).toBe('1.2M')
    expect(formatStatValue(11381, { compact: true })).toBe('11.4K')
  })

  it('respects an explicit decimals setting in compact mode', () => {
    expect(formatStatValue(11381, { compact: true, decimals: 0 })).toBe('11K')
    expect(formatStatValue(1234567, { compact: true, decimals: 2 })).toBe('1.23M')
  })

  it('handles zero and negatives', () => {
    expect(formatStatValue(0)).toBe('0')
    expect(formatStatValue(-4200)).toBe('-4,200')
  })

  it('passes non-numeric values straight through', () => {
    expect(formatStatValue('—')).toBe('—')
    expect(formatStatValue(null)).toBe('null')
    expect(formatStatValue(NaN)).toBe('NaN')
    expect(formatStatValue(Infinity)).toBe('Infinity')
  })
})
