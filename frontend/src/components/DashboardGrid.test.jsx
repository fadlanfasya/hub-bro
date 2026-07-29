// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { cleanup, render } from '@testing-library/react'
import DashboardGrid from './DashboardGrid'

afterEach(cleanup)

const item = (id, extra = {}) => ({ id, x: 0, y: 0, w: 6, h: 4, ...extra })
const renderItem = (it) => <div data-testid={`content-${it.id}`}>{it.id}</div>

function mount(props) {
  let result
  act(() => { result = render(<DashboardGrid renderItem={renderItem} {...props} />) })
  return result
}

describe('DashboardGrid', () => {
  it('initialises gridstack without throwing', () => {
    const { container } = mount({ items: [] })
    expect(container.querySelector('.grid-stack')).toBeTruthy()
  })

  it('creates one grid item per widget', () => {
    const { container } = mount({ items: [item('a'), item('b')] })
    expect(container.querySelectorAll('.grid-stack-item')).toHaveLength(2)
  })

  it('renders widget content into the grid item via a portal', () => {
    const { container, getByTestId } = mount({ items: [item('a')] })
    expect(getByTestId('content-a')).toBeTruthy()
    // the content must live inside gridstack's own content element
    const holder = container.querySelector('.grid-stack-item-content')
    expect(holder.querySelector('[data-testid="content-a"]')).toBeTruthy()
  })

  it('writes position and size onto the grid item', () => {
    const { container } = mount({ items: [item('a', { x: 3, y: 2, w: 4, h: 5 })] })
    const el = container.querySelector('.grid-stack-item')
    expect(el.getAttribute('gs-x')).toBe('3')
    expect(el.getAttribute('gs-y')).toBe('2')
    expect(el.getAttribute('gs-w')).toBe('4')
    expect(el.getAttribute('gs-h')).toBe('5')
  })

  it('adds items when the list grows', () => {
    const { container, rerender } = mount({ items: [item('a')] })
    expect(container.querySelectorAll('.grid-stack-item')).toHaveLength(1)
    act(() => {
      rerender(<DashboardGrid items={[item('a'), item('b')]} renderItem={renderItem} />)
    })
    expect(container.querySelectorAll('.grid-stack-item')).toHaveLength(2)
  })

  it('removes items when the list shrinks', () => {
    const { container, rerender } = mount({ items: [item('a'), item('b')] })
    act(() => {
      rerender(<DashboardGrid items={[item('a')]} renderItem={renderItem} />)
    })
    expect(container.querySelectorAll('.grid-stack-item')).toHaveLength(1)
    expect(container.querySelector('[data-testid="content-b"]')).toBeNull()
  })

  it('marks locked widgets so they cannot be dragged or resized', () => {
    const { container } = mount({ items: [item('a', { locked: true })] })
    const el = container.querySelector('.grid-stack-item')
    expect(el.classList.contains('is-locked')).toBe(true)
    expect(el.getAttribute('gs-no-move')).toBe('true')
    expect(el.getAttribute('gs-no-resize')).toBe('true')
  })

  it('unlocks a widget when the flag is cleared', () => {
    const { container, rerender } = mount({ items: [item('a', { locked: true })] })
    act(() => {
      rerender(<DashboardGrid items={[item('a', { locked: false })]} renderItem={renderItem} />)
    })
    const el = container.querySelector('.grid-stack-item')
    expect(el.classList.contains('is-locked')).toBe(false)
    expect(el.getAttribute('gs-no-move')).not.toBe('true')
  })

  it('locks everything in read-only mode', () => {
    const { container } = mount({ items: [item('a')], readOnly: true })
    const el = container.querySelector('.grid-stack-item')
    expect(el.getAttribute('gs-no-move')).toBe('true')
    expect(el.getAttribute('gs-no-resize')).toBe('true')
  })

  it('applies a minimum size so widgets cannot be shrunk away', () => {
    const { container } = mount({ items: [item('a', { minW: 3, minH: 3 })] })
    // gridstack keeps size constraints on the engine node rather than the DOM
    const node = container.querySelector('.grid-stack-item').gridstackNode
    expect(node.minW).toBe(3)
    expect(node.minH).toBe(3)
  })

  it('defaults to a minimum size when none is given', () => {
    const { container } = mount({ items: [item('a')] })
    expect(container.querySelector('.grid-stack-item').gridstackNode.minW).toBe(2)
  })

  it('does not fire onChange just from rendering', () => {
    const onChange = vi.fn()
    mount({ items: [item('a')], onChange })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('cleans up on unmount', () => {
    const { unmount } = mount({ items: [item('a')] })
    expect(() => act(() => unmount())).not.toThrow()
  })
})
