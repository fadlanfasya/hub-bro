// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import WidgetConfigModal from './WidgetConfigModal'

const sources = [{ id: 1, name: 'Local Postgres', type: 'sql' }]

afterEach(() => {
  cleanup()
})

/** The type select follows its label as a plain sibling, same as every
 * other field in this form (no htmlFor wiring), so locate it that way. */
function selectAfterLabel(text) {
  return screen.getByText(text).nextElementSibling
}

/** Matches a <label> element's own text, so it never accidentally matches
 * a Section toggle button that happens to start with the same word. */
function labelText(text) {
  return (content, element) => element.tagName.toLowerCase() === 'label' && content.startsWith(text)
}

function sectionToggle(title) {
  return screen.getByText(title).closest('button')
}

function renderModal(widget) {
  const onSave = vi.fn()
  const onClose = vi.fn()
  render(<WidgetConfigModal widget={widget} sources={sources} onSave={onSave} onClose={onClose} />)
  return { onSave, onClose }
}

describe('WidgetConfigModal — stat disclosure', () => {
  it('shows only the basics for a brand-new stat widget', () => {
    renderModal(undefined)
    fireEvent.change(selectAfterLabel('Widget type'), { target: { value: 'stat' } })

    // Basics: always visible.
    expect(screen.getByText(labelText('Label'))).toBeTruthy()
    expect(screen.getByText(labelText('Value field'))).toBeTruthy()
    expect(screen.getByText(labelText('Alignment'))).toBeTruthy()
    expect(screen.getByText(labelText('Value size'))).toBeTruthy()

    // Everything collapsed behind a section is not in the DOM at all.
    expect(screen.queryByText(labelText('Compare against'))).toBeNull()
    expect(screen.queryByText(labelText('Show as a percent of'))).toBeNull()
    expect(screen.queryByText(labelText('Show a sparkline'))).toBeNull()
    expect(screen.queryByText(labelText('Supporting numbers'))).toBeNull()
    expect(screen.queryByText(labelText('Thresholds'))).toBeNull()
    expect(screen.queryByText(labelText('Aggregate'))).toBeNull()

    // The section toggles themselves are still reachable.
    expect(sectionToggle('Comparison & trend')).toBeTruthy()
    expect(sectionToggle('Extras')).toBeTruthy()
    expect(sectionToggle('Thresholds & number format')).toBeTruthy()
  })

  it('reveals compare/baseline/caption fields when "Comparison & trend" is opened', () => {
    renderModal(undefined)
    fireEvent.change(selectAfterLabel('Widget type'), { target: { value: 'stat' } })

    expect(screen.queryByText(labelText('Compare against'))).toBeNull()
    fireEvent.click(sectionToggle('Comparison & trend'))
    expect(screen.getByText(labelText('Compare against'))).toBeTruthy()

    // Picking "another column" reveals the baseline + caption fields too.
    fireEvent.change(selectAfterLabel('Compare against'), { target: { value: 'field' } })
    expect(screen.getByText(labelText('Baseline column'))).toBeTruthy()
    expect(screen.getByText(labelText('Caption'))).toBeTruthy()
  })

  it('reveals percent_of/sparkline/supporting-numbers fields when "Extras" is opened', () => {
    renderModal(undefined)
    fireEvent.change(selectAfterLabel('Widget type'), { target: { value: 'stat' } })

    expect(screen.queryByText(labelText('Show as a percent of'))).toBeNull()
    fireEvent.click(sectionToggle('Extras'))
    expect(screen.getByText(labelText('Show as a percent of'))).toBeTruthy()
    expect(screen.getByText(labelText('Supporting numbers'))).toBeTruthy()

    fireEvent.click(screen.getByText('Show a sparkline'))
    expect(screen.getByText(labelText('Sparkline column'))).toBeTruthy()
  })

  it('pre-expands "Comparison & trend" when editing a stat widget that already compares', () => {
    renderModal({
      id: 'w1', title: 'CPU', type: 'stat', datasource_id: 1,
      options: { compare_field: 'yesterday' },
    })
    // No click needed — an active setting must never start hidden.
    expect(screen.getByText(labelText('Compare against'))).toBeTruthy()
    expect(screen.getByText(labelText('Baseline column'))).toBeTruthy()
  })

  it('pre-expands "Extras" when editing a stat widget that already has a sparkline', () => {
    renderModal({
      id: 'w1', title: 'CPU', type: 'stat', datasource_id: 1,
      options: { sparkline: true },
    })
    expect(screen.getByText(labelText('Show as a percent of'))).toBeTruthy()
  })

  it('pre-expands "Thresholds & number format" when editing a stat widget with thresholds set', () => {
    renderModal({
      id: 'w1', title: 'CPU', type: 'stat', datasource_id: 1,
      options: { thresholds: { warn: 70, critical: 90 } },
    })
    expect(screen.getByText(labelText('Thresholds'))).toBeTruthy()
    expect(screen.getByText(labelText('Aggregate'))).toBeTruthy()
  })
})

describe('WidgetConfigModal — gauge/table disclosure', () => {
  it('collapses gauge thresholds by default and pre-expands when a threshold is set', () => {
    renderModal({
      id: 'w2', title: 'Load', type: 'gauge', datasource_id: 1, options: {},
    })
    expect(screen.queryByText(labelText('Thresholds'))).toBeNull()
    fireEvent.click(sectionToggle('Thresholds & number format'))
    expect(screen.getByText(labelText('Thresholds'))).toBeTruthy()

    cleanup()

    renderModal({
      id: 'w2', title: 'Load', type: 'gauge', datasource_id: 1,
      options: { thresholds: { critical: 95 } },
    })
    expect(screen.getByText(labelText('Thresholds'))).toBeTruthy()
  })

  it('collapses table row styling by default and pre-expands when a colour rule exists', () => {
    renderModal({
      id: 'w3', title: 'Inventory', type: 'table', datasource_id: 1, options: {},
    })
    expect(screen.queryByText(labelText('Colour rules'))).toBeNull()
    fireEvent.click(sectionToggle('Row styling'))
    expect(screen.getByText(labelText('Colour rules'))).toBeTruthy()

    cleanup()

    renderModal({
      id: 'w3', title: 'Inventory', type: 'table', datasource_id: 1,
      options: { color_rules: [{ column: 'status', op: 'eq', value: 'DOWN', tone: 'bad' }] },
    })
    expect(screen.getByText(labelText('Colour rules'))).toBeTruthy()
  })
})

describe('WidgetConfigModal — options round-trip', () => {
  it('keeps every existing opts key/value unchanged on save when nothing was edited', async () => {
    const options = {
      label: 'CPU',
      value_field: 'cpu_pct',
      align: 'right',
      valign: 'top',
      value_size: 32,
      compare_field: 'yesterday',
      compare_label: 'vs yesterday',
      higher_is_better: false,
      percent_of: 'total',
      sparkline: true,
      spark_field: 'cpu_hist',
      detail: '{on_track} on track',
      thresholds: { direction: 'above', warn: 70, critical: 90 },
      prefix: 'Rp',
      suffix: '%',
      decimals: 1,
      compact: true,
      accent: '#00694a',
      widget_bg: 'soft',
      link: 'https://wiki.internal/runbook',
      link_label: 'Open',
    }
    const widget = { id: 'w4', title: 'CPU usage', type: 'stat', datasource_id: 1, options }
    const { onSave } = renderModal(widget)

    // Save goes through the same close-tween as Cancel/Escape (useModalMotion) —
    // onSave only fires once the exit animation's onComplete runs.
    await act(async () => {
      fireEvent.submit(screen.getByText('Save').closest('form'))
      await new Promise((r) => setTimeout(r, 300))
    })

    expect(onSave).toHaveBeenCalledTimes(1)
    const saved = onSave.mock.calls[0][0]
    expect(saved.id).toBe('w4')
    expect(saved.type).toBe('stat')
    for (const [key, value] of Object.entries(options)) {
      expect(saved.options[key]).toEqual(value)
    }
    // Same key count too — nothing extra silently added or an existing key dropped.
    expect(Object.keys(saved.options).sort()).toEqual(Object.keys(options).sort())
  })
})
