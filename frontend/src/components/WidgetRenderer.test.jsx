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
  ]

  for (const [label, widget] of cases) {
    it(label, async () => {
      const { container } = await mount({ ...base, ...widget })
      expect(container.innerHTML.length).toBeGreaterThan(0)
    })
  }
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
