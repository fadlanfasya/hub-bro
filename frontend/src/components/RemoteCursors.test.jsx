// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import RemoteCursors from './RemoteCursors'

afterEach(cleanup)

describe('RemoteCursors', () => {
  it('does not render the current user cursor', () => {
    const { container } = render(
      <RemoteCursors currentUserId={1} cursors={[{ user_id: 1, x: 10, y: 20 }]} />
    )
    expect(container.querySelector('.remote-cursor')).toBeNull()
  })

  it('renders a collaborator cursor with its email', () => {
    const { container } = render(
      <RemoteCursors currentUserId={1}
        collaborators={[{ id: 2, email: 'budi@example.com' }]}
        cursors={[{ user_id: 2, x: 120, y: 240 }]} />
    )
    const cursor = container.querySelector('.remote-cursor')
    expect(cursor).not.toBeNull()
    expect(cursor.textContent).toContain('budi@example.com')
    expect(cursor.style.left).toBe('120px')
  })
})
