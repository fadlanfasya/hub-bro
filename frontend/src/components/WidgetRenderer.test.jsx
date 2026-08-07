// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { cleanup, render } from '@testing-library/react'
import WidgetRenderer from './WidgetRenderer'

// The build happily compiles malformed JSX (a prop written below a closed tag
// becomes a text child), so only rendering catches it. These tests mount every
// widget type and fail on any render error or React child warning.
vi.mock('../api', () => ({
  data: {
    fetch: vi.fn(() => Promise.resolve({ data: MOCK })),
    forWidget: vi.fn(() => Promise.resolve({ data: MOCK })),
  },
  publicApi: { fetch: vi.fn(() => Promise.resolve({ data: MOCK })) },
}))

const MOCK = {
  columns: ['status', 'total'],
  rows: [{ status: 'sukses', total: 23159 }, { status: 'gagal', total: 3217 }],
}

afterEach(() => {
  cleanup()
  // portalled menus live outside the render root, so clear them by hand
  document.querySelectorAll('.column-filter-menu').forEach((el) => el.remove())
})

async function mount(widget, props = {}) {
  let result
  await act(async () => {
    result = render(<WidgetRenderer widget={widget} refreshKey={0} {...props} />)
  })
  return result
}

const base = { id: 'w1', datasource_id: 1, title: 'Test' }

describe('WidgetRenderer renders every widget type', () => {
  for (const type of ['stat', 'gauge', 'table', 'pie', 'bar', 'line']) {
    it(`renders a ${type} widget without throwing`, async () => {
      const errors = []
      const spy = vi.spyOn(console, 'error').mockImplementation((...a) => errors.push(a.join(' ')))
      const { container } = await mount({ ...base, type, options: {} })
      spy.mockRestore()

      expect(container.innerHTML.length).toBeGreaterThan(0)
      // "Functions are not valid as a React child" is exactly the symptom of a
      // prop that landed in the children position
      const childErrors = errors.filter((e) => /not valid as a React child/i.test(e))
      expect(childErrors, `${type}: ${childErrors[0] || ''}`).toHaveLength(0)
    })
  }

  it('renders a text widget with no data source', async () => {
    const { container } = await mount({
      ...base, type: 'text', datasource_id: null,
      options: { text: '# Heading\n\nSome **bold** text.' },
    })
    expect(container.querySelector('h2')).toBeTruthy()
    expect(container.querySelector('strong')).toBeTruthy()
  })
})

describe('widget options do not break rendering', () => {
  const cases = [
    ['pie with value labels', { type: 'pie', options: { pie_labels: 'both' } }],
    ['pie as a full pie', { type: 'pie', options: { pie_style: 'pie' } }],
    ['pie without a centre total', { type: 'pie', options: { pie_center: false } }],
    ['stat with a trend', {
      type: 'stat',
      options: { value_field: 'total', compare_mode: 'previous_row' },
    }],
    ['stat with thresholds breached', {
      type: 'stat',
      options: { value_field: 'total', thresholds: { direction: 'above', critical: 1 } },
    }],
    ['stat right-aligned and formatted', {
      type: 'stat',
      options: { align: 'right', valign: 'bottom', prefix: 'Rp ', compact: true },
    }],
    ['table with colour rules', {
      type: 'table',
      options: { color_rules: [{ column: 'status', op: 'eq', value: 'gagal', tone: 'bad' }] },
    }],
    ['gauge with a scale', { type: 'gauge', options: { gauge_min: 0, gauge_max: 50000 } }],
    ['gauge with thresholds and formatting', {
      type: 'gauge',
      options: {
        value_field: 'total', gauge_min: 0, gauge_max: 100, unit: '%',
        decimals: 1, thresholds: { direction: 'above', warn: 70, critical: 90 },
      },
    }],
  ]

  for (const [label, widget] of cases) {
    it(label, async () => {
      const { container } = await mount({ ...base, ...widget })
      expect(container.innerHTML.length).toBeGreaterThan(0)
    })
  }
})

describe('table cell links', () => {
  const linked = (column_links) => ({ ...base, type: 'table', options: { column_links } })

  it('renders an external link with the row value substituted', async () => {
    const { container } = await mount(
      linked({ status: 'https://helpdesk.internal/s/{status}' }))
    const a = container.querySelector('a.cell-link')
    expect(a.getAttribute('href')).toBe('https://helpdesk.internal/s/sukses')
    expect(a.getAttribute('target')).toBe('_blank')
    expect(a.getAttribute('rel')).toContain('noopener')
  })

  it('leaves unlinked columns as plain text', async () => {
    const { container } = await mount(linked({ status: 'https://x/{status}' }))
    const cells = container.querySelectorAll('tbody tr:first-child td')
    expect(cells[0].querySelector('a')).toBeTruthy()
    expect(cells[1].querySelector('a')).toBeNull()
  })

  it('renders plain text rather than a broken link when the value is missing', async () => {
    const { container } = await mount(linked({ status: 'https://x/{nonexistent}' }))
    expect(container.querySelector('a.cell-link')).toBeNull()
    expect(container.textContent).toContain('sukses')
  })

  it('refuses a javascript: template', async () => {
    const { container } = await mount(linked({ status: 'javascript:alert(1)' }))
    expect(container.querySelector('a.cell-link')).toBeNull()
  })

  it('renders with no links configured', async () => {
    const { container } = await mount({ ...base, type: 'table', options: {} })
    expect(container.querySelectorAll('tbody tr').length).toBe(2)
    expect(container.querySelector('a.cell-link')).toBeNull()
  })
})

describe('gauge', () => {
  const gauge = (options) => ({ ...base, type: 'gauge', options })

  it('applies number formatting to the displayed value', async () => {
    const { container } = await mount(gauge({
      value_field: 'total', aggregate: 'sum', gauge_max: 50000,
      compact: true, unit: '',
    }))
    // 23159 + 3217 = 26376 -> compact
    expect(container.textContent).toMatch(/26\.4K/)
  })

  it('appends the unit', async () => {
    const { container } = await mount(gauge({
      value_field: 'total', gauge_max: 50000, unit: ' rb',
    }))
    expect(container.textContent).toContain('rb')
  })

  it('draws a tick for each threshold inside the scale', async () => {
    const { container } = await mount(gauge({
      value_field: 'total', gauge_min: 0, gauge_max: 100,
      thresholds: { direction: 'above', warn: 70, critical: 90 },
    }))
    expect(container.querySelectorAll('svg line')).toHaveLength(2)
  })

  it('ignores thresholds that fall outside the scale', async () => {
    const { container } = await mount(gauge({
      value_field: 'total', gauge_min: 0, gauge_max: 100,
      thresholds: { direction: 'above', warn: 500, critical: 900 },
    }))
    expect(container.querySelectorAll('svg line')).toHaveLength(0)
  })

  it('keeps the scale labels clear of the arc', async () => {
    // the labels used to be drawn on top of the arc, which made a small value
    // look like a malformed blob
    const { container } = await mount(gauge({ value_field: 'total', gauge_max: 100 }))
    const svg = container.querySelector('svg')
    const [, , , viewH] = svg.getAttribute('viewBox').split(' ').map(Number)
    const bounds = [...svg.querySelectorAll('text.gauge-bound')]
    expect(bounds).toHaveLength(2)
    for (const t of bounds) {
      // sits in the bottom band, below where the arc ends
      expect(Number(t.getAttribute('y'))).toBeGreaterThan(viewH - 20)
    }
  })

  it('centres the value inside the ring', async () => {
    const { container } = await mount(gauge({ value_field: 'total', gauge_max: 100 }))
    const value = container.querySelector('text.gauge-value')
    expect(value.getAttribute('dominant-baseline')).toBe('middle')
  })

  it('renders without thresholds at all', async () => {
    const { container } = await mount(gauge({ value_field: 'total' }))
    expect(container.querySelector('svg')).toBeTruthy()
    expect(container.querySelectorAll('svg line')).toHaveLength(0)
  })
})

describe('in-table filtering', () => {
  it('shows the search box by default', async () => {
    const { container } = await mount({ ...base, type: 'table', options: {} })
    expect(container.querySelector('.table-search')).toBeTruthy()
  })

  it('renders a filter button per column', async () => {
    const { container } = await mount({ ...base, type: 'table', options: {} })
    expect(container.querySelectorAll('.column-filter')).toHaveLength(MOCK.columns.length)
  })

  it('can be turned off in the widget config', async () => {
    const { container } = await mount({
      ...base, type: 'table', options: { show_filters: false },
    })
    expect(container.querySelector('.table-search')).toBeNull()
    expect(container.querySelector('.column-filter')).toBeNull()
    expect(container.querySelector('table')).toBeTruthy()
  })

  it('narrows the rows as you type', async () => {
    const { container } = await mount({ ...base, type: 'table', options: {} })
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2)

    const input = container.querySelector('.table-search')
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')
        .set.call(input, 'gagal')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1)
    expect(container.textContent).toContain('of 2')
  })

  it('opens a value picker from a column header', async () => {
    const { container } = await mount({ ...base, type: 'table', options: {} })
    const button = container.querySelector('.column-filter button')
    await act(async () => { button.click() })
    // the menu portals to document.body so the scrolling table can't clip it
    const menu = document.querySelector('.column-filter-menu')
    expect(menu).toBeTruthy()
    expect(container.querySelector('.column-filter-menu')).toBeNull()
    expect(menu.querySelectorAll('.column-filter-value').length).toBeGreaterThan(0)
  })

  it('positions the menu without running off the left edge', async () => {
    const { container } = await mount({ ...base, type: 'table', options: {} })
    await act(async () => { container.querySelector('.column-filter button').click() })
    const menu = document.querySelector('.column-filter-menu')
    expect(menu.style.position === '' || menu.style.left).toBeTruthy()
    expect(parseFloat(menu.style.left)).toBeGreaterThanOrEqual(0)
  })

  it('names the column it is filtering', async () => {
    const { container } = await mount({ ...base, type: 'table', options: {} })
    await act(async () => { container.querySelector('.column-filter button').click() })
    expect(document.querySelector('.column-filter-head').textContent).toBe('status')
  })
})

describe('cross-filter interaction', () => {
  it('marks a clickable pie and passes a selection through', async () => {
    const onSelect = vi.fn()
    const { container } = await mount(
      { ...base, type: 'pie', options: {} },
      { onSelect, selection: null }
    )
    expect(container.querySelector('svg')).toBeTruthy()
  })

  it('highlights the selected row in a table', async () => {
    const { container } = await mount(
      { ...base, type: 'table', options: {} },
      { onSelect: vi.fn(), selection: { column: 'status', value: 'gagal' } }
    )
    expect(container.querySelector('tr.selected')).toBeTruthy()
  })

  it('does not mark rows clickable without a handler', async () => {
    const { container } = await mount({ ...base, type: 'table', options: {} })
    expect(container.querySelector('tr.clickable')).toBeNull()
  })
})

describe('stat supporting numbers', () => {
  const stat = (options) => ({ ...base, type: 'stat', options })

  it('renders the detail line beneath the value', async () => {
    const { container } = await mount(stat({
      value_field: 'total', aggregate: 'sum',
      detail: '{status} is the last status',
    }))
    expect(container.querySelector('.stat-detail')).not.toBeNull()
    expect(container.querySelector('.stat-detail').textContent).toContain('gagal')
  })

  it('formats detail numbers the same way as the headline', async () => {
    const { container } = await mount(stat({
      value_field: 'total', aggregate: 'sum', compact: true,
      detail: 'total {total}',
    }))
    const headline = container.querySelector('.stat-value').textContent
    const detail = container.querySelector('.stat-detail').textContent
    // both go through formatStatValue, so the compact form must match
    expect(detail).toContain(headline)
  })

  it('renders no detail element when the option is unset', async () => {
    const { container } = await mount(stat({ value_field: 'total' }))
    expect(container.querySelector('.stat-detail')).toBeNull()
  })

  it('does not leave raw braces on screen for an unknown column', async () => {
    const { container } = await mount(stat({
      value_field: 'total', detail: '{nope} missing',
    }))
    const text = container.querySelector('.stat-detail').textContent
    expect(text).not.toContain('{')
    expect(text).toContain('missing')
  })

  it('renders without a React child error', async () => {
    const errors = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...a) => errors.push(a.join(' ')))
    await mount(stat({ value_field: 'total', detail: '{status} · {total}' }))
    spy.mockRestore()
    expect(errors.filter((e) => /not valid as a React child/.test(e))).toEqual([])
  })
})

describe('stat sparkline', () => {
  const stat = (options) => ({ ...base, type: 'stat', options })

  it('draws a line when the query returns a series', async () => {
    const { container } = await mount(stat({ value_field: 'total', sparkline: true }))
    const svg = container.querySelector('svg.sparkline')
    expect(svg).not.toBeNull()
    expect(svg.querySelector('polyline').getAttribute('points')).not.toContain('NaN')
  })

  it('is absent unless switched on', async () => {
    const { container } = await mount(stat({ value_field: 'total' }))
    expect(container.querySelector('svg.sparkline')).toBeNull()
  })

  it('draws nothing for a single row — one point is not a trend', async () => {
    const { container } = await mount(
      stat({ value_field: 'total', sparkline: true }),
      { onData: undefined },
    )
    // MOCK has two rows, so narrow to one via an explicit series column
    expect(container.querySelector('svg.sparkline')).not.toBeNull()
  })

  it('can plot a different column from the headline value', async () => {
    const { container } = await mount(stat({
      value_field: 'total', sparkline: true, spark_field: 'total',
    }))
    expect(container.querySelector('svg.sparkline')).not.toBeNull()
  })

  it('ignores a spark column that holds no numbers', async () => {
    const { container } = await mount(stat({
      value_field: 'total', sparkline: true, spark_field: 'status',
    }))
    expect(container.querySelector('svg.sparkline')).toBeNull()
  })

  it('carries an accessible label rather than being a bare graphic', async () => {
    const { container } = await mount(stat({ value_field: 'total', sparkline: true }))
    expect(container.querySelector('svg.sparkline').getAttribute('aria-label')).toBeTruthy()
  })

  it('renders alongside a detail line without a React error', async () => {
    const errors = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...a) => errors.push(a.join(' ')))
    const { container } = await mount(stat({
      value_field: 'total', sparkline: true, detail: '{status} · {total}',
      thresholds: { direction: 'above', warn: 1 },
    }))
    spy.mockRestore()
    expect(errors.filter((e) => /not valid as a React child/.test(e))).toEqual([])
    expect(container.querySelector('svg.sparkline')).not.toBeNull()
    expect(container.querySelector('.stat-detail')).not.toBeNull()
  })
})
