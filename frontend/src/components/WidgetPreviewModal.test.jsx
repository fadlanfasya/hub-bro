// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import WidgetPreviewModal from './WidgetPreviewModal'

// The preview hits the real /data/fetch endpoint with whatever the draft
// currently holds, so that call is the thing to verify.
vi.mock('../api', () => ({
  data: {
    fetch: vi.fn(() => Promise.resolve({
      data: {
        columns: ['status', 'total'],
        rows: [{ status: 'sukses', total: 23159 }, { status: 'gagal', total: 3217 }],
      },
    })),
  },
}))

import { data as dataApi } from '../api'

const sources = [{ id: 1, name: 'Local Postgres', type: 'sql' }]

const sqlWidget = {
  id: 'w1',
  title: 'Status counts',
  type: 'stat',
  datasource_id: 1,
  options: { query: 'SELECT status, COUNT(*) AS total FROM vms GROUP BY status' },
}

beforeEach(() => {
  dataApi.fetch.mockClear()
})

afterEach(() => {
  cleanup()
})

/** Flush the fetch promise chain after mounting. */
async function settle() {
  await act(async () => { await Promise.resolve() })
  await act(async () => { await Promise.resolve() })
}

describe('WidgetPreviewModal', () => {
  it('fetches the draft once on open, via buildOptions', async () => {
    render(<WidgetPreviewModal widget={sqlWidget} sources={sources} onClose={() => {}} />)
    await settle()
    expect(dataApi.fetch).toHaveBeenCalledTimes(1)
    expect(dataApi.fetch).toHaveBeenCalledWith(1, { query: sqlWidget.options.query })
  })

  it('renders the fetched result through WidgetRenderer (no duplicate fetch)', async () => {
    render(<WidgetPreviewModal widget={sqlWidget} sources={sources} onClose={() => {}} />)
    await settle()
    // stat defaults to the last row's value, thousands separator applied
    expect(screen.getByText('3,217')).toBeTruthy()
    expect(dataApi.fetch).toHaveBeenCalledTimes(1)
  })

  it('refetches when Refresh is clicked', async () => {
    render(<WidgetPreviewModal widget={sqlWidget} sources={sources} onClose={() => {}} />)
    await settle()
    await act(async () => {
      screen.getByText('Refresh').click()
      await Promise.resolve()
    })
    await settle()
    expect(dataApi.fetch).toHaveBeenCalledTimes(2)
  })

  it('shows the server error message on a failed fetch', async () => {
    dataApi.fetch.mockRejectedValueOnce({ response: { data: { detail: 'syntax error at "FORM"' } } })
    render(<WidgetPreviewModal widget={sqlWidget} sources={sources} onClose={() => {}} />)
    await settle()
    expect(screen.getByText('syntax error at "FORM"')).toBeTruthy()
  })

  it('shows a hint instead of fetching when the query is empty', async () => {
    render(
      <WidgetPreviewModal
        widget={{ ...sqlWidget, options: { query: '' } }}
        sources={sources}
        onClose={() => {}}
      />
    )
    await settle()
    expect(dataApi.fetch).not.toHaveBeenCalled()
    expect(screen.getByText('Enter a query in the widget form first — then open the preview again.'))
      .toBeTruthy()
  })

  it('shows a hint when no source is selected yet', async () => {
    render(
      <WidgetPreviewModal widget={{ ...sqlWidget, datasource_id: '' }} sources={sources} onClose={() => {}} />
    )
    await settle()
    expect(dataApi.fetch).not.toHaveBeenCalled()
    expect(screen.getByText('Select a data source in the widget form first.')).toBeTruthy()
  })

  it('closing via overlay click calls onClose', async () => {
    const onClose = vi.fn()
    render(<WidgetPreviewModal widget={sqlWidget} sources={sources} onClose={onClose} />)
    await settle()
    await act(async () => {
      document.querySelector('.preview-overlay').dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Escape calls onClose', async () => {
    const onClose = vi.fn()
    render(<WidgetPreviewModal widget={sqlWidget} sources={sources} onClose={onClose} />)
    await settle()
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      await Promise.resolve()
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
