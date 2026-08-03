import { describe, expect, it } from 'vitest'
import {
  buildLinkUrl, isInternalLink, isSafeUrl, linkProps, templateColumns,
} from './links'

describe('isSafeUrl', () => {
  it('allows http, https, mailto and app paths', () => {
    expect(isSafeUrl('https://helpdesk.internal/t/1')).toBe(true)
    expect(isSafeUrl('http://10.1.5.4/x')).toBe(true)
    expect(isSafeUrl('mailto:ops@example.com')).toBe(true)
    expect(isSafeUrl('/dashboards/3')).toBe(true)
  })

  it('rejects script and data URLs', () => {
    // a widget config is shared publicly, so this is the important case
    expect(isSafeUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeUrl('JavaScript:alert(1)')).toBe(false)
    expect(isSafeUrl('data:text/html,<script>alert(1)</script>')).toBe(false)
    expect(isSafeUrl('vbscript:msgbox')).toBe(false)
  })

  it('rejects blanks and non-strings', () => {
    expect(isSafeUrl('')).toBe(false)
    expect(isSafeUrl('   ')).toBe(false)
    expect(isSafeUrl(null)).toBe(false)
    expect(isSafeUrl(42)).toBe(false)
  })

  it('rejects a bare hostname with no scheme', () => {
    expect(isSafeUrl('helpdesk.internal/t/1')).toBe(false)
  })
})

describe('isInternalLink', () => {
  it('recognises app paths', () => {
    expect(isInternalLink('/dashboards/2')).toBe(true)
    expect(isInternalLink('https://x.com')).toBe(false)
  })
})

describe('templateColumns', () => {
  it('lists the placeholders used', () => {
    expect(templateColumns('https://x/{a}/{b}')).toEqual(['a', 'b'])
  })

  it('trims whitespace inside braces', () => {
    expect(templateColumns('https://x/{ ticket_id }')).toEqual(['ticket_id'])
  })

  it('returns nothing for a plain URL', () => {
    expect(templateColumns('https://x')).toEqual([])
    expect(templateColumns(undefined)).toEqual([])
  })
})

describe('buildLinkUrl', () => {
  const row = { ticket_id: 347521, subject: 'Gagal generate sertifikat', status: 'Open' }

  it('substitutes a value from the row', () => {
    expect(buildLinkUrl('https://helpdesk/t/{ticket_id}', row))
      .toBe('https://helpdesk/t/347521')
  })

  it('handles several placeholders', () => {
    expect(buildLinkUrl('https://x/{status}/{ticket_id}', row))
      .toBe('https://x/Open/347521')
  })

  it('URL-encodes values so spaces and symbols cannot break the link', () => {
    const url = buildLinkUrl('https://x/search?q={subject}', row)
    expect(url).toBe('https://x/search?q=Gagal%20generate%20sertifikat')
    expect(url).not.toContain(' ')
  })

  it('encodes characters that would alter the query string', () => {
    expect(buildLinkUrl('https://x?q={v}', { v: 'a&b=c' }))
      .toBe('https://x?q=a%26b%3Dc')
  })

  it('returns null when a placeholder has no value', () => {
    // better to show plain text than link to /ticket/undefined
    expect(buildLinkUrl('https://x/{missing}', row)).toBeNull()
    expect(buildLinkUrl('https://x/{ticket_id}', {})).toBeNull()
    expect(buildLinkUrl('https://x/{v}', { v: '' })).toBeNull()
    expect(buildLinkUrl('https://x/{v}', { v: null })).toBeNull()
  })

  it('keeps a zero, which is a real value', () => {
    expect(buildLinkUrl('https://x/{n}', { n: 0 })).toBe('https://x/0')
  })

  it('works without placeholders', () => {
    expect(buildLinkUrl('https://wiki/runbook', row)).toBe('https://wiki/runbook')
  })

  it('builds internal dashboard links', () => {
    expect(buildLinkUrl('/dashboards/{id}', { id: 3 })).toBe('/dashboards/3')
  })

  it('refuses an unsafe template', () => {
    expect(buildLinkUrl('javascript:alert({ticket_id})', row)).toBeNull()
  })

  it('refuses a template that becomes unsafe after substitution', () => {
    expect(buildLinkUrl('{scheme}alert(1)', { scheme: 'javascript:' })).toBeNull()
  })

  it('returns null for empty or missing templates', () => {
    expect(buildLinkUrl('', row)).toBeNull()
    expect(buildLinkUrl(undefined, row)).toBeNull()
    expect(buildLinkUrl('   ', row)).toBeNull()
  })
})

describe('linkProps', () => {
  it('routes internal links in place', () => {
    expect(linkProps('/dashboards/2')).toEqual({ to: '/dashboards/2', internal: true })
  })

  it('opens external links in a new tab, safely', () => {
    const props = linkProps('https://x.com')
    expect(props.internal).toBe(false)
    expect(props.target).toBe('_blank')
    // without noopener the opened page can navigate this one
    expect(props.rel).toContain('noopener')
    expect(props.rel).toContain('noreferrer')
  })
})
