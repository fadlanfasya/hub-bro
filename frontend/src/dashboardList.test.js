import { describe, expect, it } from 'vitest'
import { UNFILED, folderNames, groupByFolder, normaliseFolder } from './dashboardList'

// the real list, plus a couple filed away
const d = (name, folder = null, pinned = false) => ({ id: name, name, folder, pinned })

describe('normaliseFolder', () => {
  it('keeps a plain name', () => {
    expect(normaliseFolder('Network')).toBe('Network')
  })

  it('collapses stray whitespace so two spellings are one folder', () => {
    expect(normaliseFolder('  Network   Ops ')).toBe('Network Ops')
  })

  it('treats blank as no folder, never as a folder called ""', () => {
    expect(normaliseFolder('')).toBeNull()
    expect(normaliseFolder('   ')).toBeNull()
    expect(normaliseFolder(null)).toBeNull()
    expect(normaliseFolder(undefined)).toBeNull()
  })
})

describe('groupByFolder', () => {
  const items = [
    d('Ticket Management'),
    d('Ops Hub', null, true),
    d('DB Health Check', 'Infra'),
    d('License Management'),
    d('Event Management'),
    d('Network Management', 'Network'),
    d('Palo Alto Detail', 'Network'),
    d('F5 Detail', 'Network', true),
  ]

  it('puts filed folders first, alphabetically', () => {
    expect(groupByFolder(items).map((g) => g.name))
      .toEqual(['Infra', 'Network', UNFILED])
  })

  it('keeps the unfiled pile last, where it can grow without pushing folders away', () => {
    const groups = groupByFolder(items)
    expect(groups[groups.length - 1].name).toBe(UNFILED)
  })

  it('pins lead their own folder', () => {
    const network = groupByFolder(items).find((g) => g.name === 'Network')
    expect(network.items.map((i) => i.name))
      .toEqual(['F5 Detail', 'Network Management', 'Palo Alto Detail'])
  })

  it('a pin ranks within its folder, not across the whole list', () => {
    // Ops Hub is pinned but unfiled, so it leads that section — it does not
    // jump above the Network folder
    const groups = groupByFolder(items)
    expect(groups[0].name).toBe('Infra')
    expect(groups[2].items[0].name).toBe('Ops Hub')
  })

  it('sorts the rest by name', () => {
    const unfiled = groupByFolder(items).find((g) => g.name === UNFILED)
    expect(unfiled.items.map((i) => i.name))
      .toEqual(['Ops Hub', 'Event Management', 'License Management', 'Ticket Management'])
  })

  it('loses nothing', () => {
    const total = groupByFolder(items).reduce((n, g) => n + g.items.length, 0)
    expect(total).toBe(items.length)
  })

  it('treats blank and missing folders as the same pile', () => {
    const groups = groupByFolder([d('a', ''), d('b', null), d('c', '  ')])
    expect(groups).toHaveLength(1)
    expect(groups[0].name).toBe(UNFILED)
  })

  it('merges folders that differ only in spacing', () => {
    const groups = groupByFolder([d('a', 'Net Ops'), d('b', ' Net  Ops ')])
    expect(groups).toHaveLength(1)
    expect(groups[0].items).toHaveLength(2)
  })

  it('sorts numbered folders like a human would', () => {
    const groups = groupByFolder([d('a', 'Site 10'), d('b', 'Site 9')])
    expect(groups.map((g) => g.name)).toEqual(['Site 9', 'Site 10'])
  })

  it('handles an empty list', () => {
    expect(groupByFolder([])).toEqual([])
    expect(groupByFolder()).toEqual([])
  })
})

describe('folderNames', () => {
  it('lists each folder once, sorted', () => {
    expect(folderNames([d('a', 'Network'), d('b', 'Infra'), d('c', 'Network'), d('d')]))
      .toEqual(['Infra', 'Network'])
  })

  it('is empty when nothing is filed', () => {
    expect(folderNames([d('a'), d('b', '')])).toEqual([])
  })
})
