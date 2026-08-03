// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { cleanup, render } from '@testing-library/react'
import EditableTitle from './EditableTitle'

afterEach(cleanup)

function mount(props) {
  let result
  act(() => { result = render(<EditableTitle value="Ops Hub" onSave={vi.fn()} {...props} />) })
  return result
}

const type = (input, value) => {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')
    .set.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

const press = (input, key) =>
  input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))

describe('EditableTitle', () => {
  it('shows the value as text until clicked', () => {
    const { container } = mount({})
    expect(container.querySelector('input')).toBeNull()
    expect(container.textContent).toContain('Ops Hub')
  })

  it('becomes an input when clicked', () => {
    const { container } = mount({})
    act(() => { container.querySelector('button').click() })
    expect(container.querySelector('input').value).toBe('Ops Hub')
  })

  it('saves on Enter', () => {
    const onSave = vi.fn()
    const { container } = mount({ onSave })
    act(() => { container.querySelector('button').click() })
    const input = container.querySelector('input')
    act(() => { type(input, 'Ops Hub v2') })
    act(() => { press(input, 'Enter') })
    expect(onSave).toHaveBeenCalledWith('Ops Hub v2')
  })

  it('saves when focus leaves', () => {
    const onSave = vi.fn()
    const { container } = mount({ onSave })
    act(() => { container.querySelector('button').click() })
    const input = container.querySelector('input')
    act(() => { type(input, 'Renamed') })
    // React's onBlur listens for focusout, which bubbles; plain blur does not
    act(() => { input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })
    expect(onSave).toHaveBeenCalledWith('Renamed')
  })

  it('discards the edit on Escape', () => {
    const onSave = vi.fn()
    const { container } = mount({ onSave })
    act(() => { container.querySelector('button').click() })
    const input = container.querySelector('input')
    act(() => { type(input, 'Half-typed name') })
    act(() => { press(input, 'Escape') })
    expect(onSave).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Ops Hub')
  })

  it('does not save an unchanged name', () => {
    const onSave = vi.fn()
    const { container } = mount({ onSave })
    act(() => { container.querySelector('button').click() })
    act(() => { press(container.querySelector('input'), 'Enter') })
    expect(onSave).not.toHaveBeenCalled()
  })

  it('refuses to save an empty name', () => {
    const onSave = vi.fn()
    const { container } = mount({ onSave })
    act(() => { container.querySelector('button').click() })
    const input = container.querySelector('input')
    act(() => { type(input, '   ') })
    act(() => { press(input, 'Enter') })
    expect(onSave).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Ops Hub')
  })

  it('trims surrounding whitespace', () => {
    const onSave = vi.fn()
    const { container } = mount({ onSave })
    act(() => { container.querySelector('button').click() })
    const input = container.querySelector('input')
    act(() => { type(input, '  Padded  ') })
    act(() => { press(input, 'Enter') })
    expect(onSave).toHaveBeenCalledWith('Padded')
  })

  it('is plain text for viewers', () => {
    const { container } = mount({ disabled: true })
    expect(container.querySelector('button')).toBeNull()
    expect(container.textContent).toContain('Ops Hub')
  })

  it('picks up an external rename, such as a history restore', () => {
    const { container, rerender } = mount({})
    act(() => { rerender(<EditableTitle value="Restored name" onSave={vi.fn()} />) })
    expect(container.textContent).toContain('Restored name')
  })
})
