// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import Collaborators from './Collaborators'

afterEach(cleanup)

describe('Collaborators', () => {
  it('stays hidden when nobody else is viewing', () => {
    const { container } = render(<Collaborators users={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('shows avatars, names in tooltips, and the viewer count', () => {
    const users = [
      { id: 1, email: 'ana.sari@example.com' },
      { id: 2, email: 'budi@example.com' },
    ]
    const { container } = render(<Collaborators users={users} />)
    expect(container.textContent).toContain('2 viewing')
    expect(container.querySelectorAll('.collaborator-avatar')).toHaveLength(2)
    expect(container.querySelector('[title="ana.sari@example.com"]')).not.toBeNull()
  })

  it('condenses a large room into five avatars and a remainder', () => {
    const users = Array.from({ length: 7 }, (_, id) => ({ id, email: `user${id}@example.com` }))
    const { container } = render(<Collaborators users={users} />)
    expect(container.querySelectorAll('.collaborator-avatar')).toHaveLength(5)
    expect(container.querySelector('.collaborator-more').textContent).toBe('+2')
  })
})
