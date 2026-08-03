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

  // The whole point: what you saved is what you see when you come back.
  it('renders a saved layout exactly, without rearranging it', () => {
    const saved = [
      item('a', { x: 0, y: 0, w: 3, h: 3 }),
      item('b', { x: 3, y: 0, w: 3, h: 3 }),
      item('c', { x: 6, y: 0, w: 6, h: 3 }),
      item('d', { x: 0, y: 3, w: 6, h: 5 }),
      item('e', { x: 6, y: 3, w: 6, h: 5 }),
    ]
    const { container } = mount({ items: saved })
    const rendered = [...container.querySelectorAll('.grid-stack-item')].map((el) => ({
      id: el.getAttribute('gs-id'),
      x: Number(el.getAttribute('gs-x')),
      y: Number(el.getAttribute('gs-y')),
      w: Number(el.getAttribute('gs-w')),
      h: Number(el.getAttribute('gs-h')),
    }))
    for (const want of saved) {
      const got = rendered.find((r) => r.id === want.id)
      expect(got, want.id).toMatchObject({ x: want.x, y: want.y, w: want.w, h: want.h })
    }
  })

  it('places items correctly even when listed out of visual order', () => {
    // widget order in the definition need not match top-to-bottom on screen;
    // inserting a lower widget first used to push the upper ones around
    const jumbled = [
      item('bottom', { x: 0, y: 6, w: 12, h: 4 }),
      item('top', { x: 0, y: 0, w: 6, h: 3 }),
      item('middle', { x: 6, y: 0, w: 6, h: 3 }),
    ]
    const { container } = mount({ items: jumbled })
    const byId = Object.fromEntries(
      [...container.querySelectorAll('.grid-stack-item')]
        .map((el) => [el.getAttribute('gs-id'),
          { x: Number(el.getAttribute('gs-x')), y: Number(el.getAttribute('gs-y')) }])
    )
    expect(byId.top).toEqual({ x: 0, y: 0 })
    expect(byId.middle).toEqual({ x: 6, y: 0 })
    expect(byId.bottom).toEqual({ x: 0, y: 6 })
  })

  it('leaves positions alone when the widget list re-renders unchanged', () => {
    // a data refresh re-renders the editor; that must not move anything
    const saved = [item('a', { x: 3, y: 2, w: 4, h: 3 })]
    const { container, rerender } = mount({ items: saved })
    for (let i = 0; i < 3; i += 1) {
      act(() => {
        rerender(<DashboardGrid items={saved.map((s) => ({ ...s }))}
          renderItem={renderItem} />)
      })
    }
    const el = container.querySelector('.grid-stack-item')
    expect(el.getAttribute('gs-x')).toBe('3')
    expect(el.getAttribute('gs-y')).toBe('2')
  })

  it('follows an externally changed position, such as a history restore', () => {
    const { container, rerender } = mount({ items: [item('a', { x: 0, y: 0, w: 3, h: 3 })] })
    act(() => {
      rerender(<DashboardGrid items={[item('a', { x: 6, y: 2, w: 4, h: 4 })]}
        renderItem={renderItem} />)
    })
    const el = container.querySelector('.grid-stack-item')
    expect(el.getAttribute('gs-x')).toBe('6')
    expect(el.getAttribute('gs-y')).toBe('2')
    expect(el.getAttribute('gs-w')).toBe('4')
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

  // Layout is only persisted on a finished drag or resize. gridstack's own
  // repositioning must never be saved, or opening the dashboard in a second
  // tab could overwrite the real layout with a rearranged one.
  it('does not fire onChange when items are added', () => {
    const onChange = vi.fn()
    const { rerender } = mount({ items: [item('a')], onChange })
    act(() => {
      rerender(<DashboardGrid items={[item('a'), item('b')]}
        renderItem={renderItem} onChange={onChange} />)
    })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('does not fire onChange when items are removed', () => {
    const onChange = vi.fn()
    const { rerender } = mount({ items: [item('a'), item('b')], onChange })
    act(() => {
      rerender(<DashboardGrid items={[item('a')]}
        renderItem={renderItem} onChange={onChange} />)
    })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('does not fire onChange when a widget is locked or unlocked', () => {
    const onChange = vi.fn()
    const { rerender } = mount({ items: [item('a')], onChange })
    act(() => {
      rerender(<DashboardGrid items={[item('a', { locked: true })]}
        renderItem={renderItem} onChange={onChange} />)
    })
    expect(onChange).not.toHaveBeenCalled()
  })

  // gridstack invokes drag/resize handlers directly rather than dispatching DOM
  // events — which is precisely why they can't fire from programmatic changes.
  it('registers handlers only for finished drags and resizes', () => {
    const { container } = mount({ items: [item('a')], onChange: vi.fn() })
    const handlers = container.querySelector('.grid-stack').gridstack._gsEventHandler
    expect(handlers.dragstop).toBeTypeOf('function')
    expect(handlers.resizestop).toBeTypeOf('function')
    expect(handlers.change).toBeUndefined()
  })

  it('saves the layout when a drag finishes', () => {
    const onChange = vi.fn()
    const { container } = mount({ items: [item('a', { x: 2, y: 1, w: 4, h: 3 })], onChange })
    const grid = container.querySelector('.grid-stack').gridstack
    act(() => { grid._gsEventHandler.dragstop() })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0][0]).toMatchObject({ i: 'a', x: 2, y: 1, w: 4, h: 3 })
  })

  it('saves the layout when a resize finishes', () => {
    const onChange = vi.fn()
    const { container } = mount({ items: [item('a')], onChange })
    act(() => { container.querySelector('.grid-stack').gridstack._gsEventHandler.resizestop() })
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('cleans up on unmount', () => {
    const { unmount } = mount({ items: [item('a')] })
    expect(() => act(() => unmount())).not.toThrow()
  })
})
