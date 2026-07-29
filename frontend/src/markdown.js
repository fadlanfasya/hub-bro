/**
 * Minimal markdown parser producing a token tree, not HTML.
 *
 * Deliberately not using a markdown library with `dangerouslySetInnerHTML`:
 * an editor could otherwise plant a script in a text widget that runs for
 * every viewer, including on a public share link. Emitting tokens that React
 * renders as elements means nothing can escape into markup.
 *
 * Supported: #/##/### headings, **bold**, *italic*, `code`, [links](url),
 * - bullet lists, 1. numbered lists, > quotes, --- rules, paragraphs.
 */

const SAFE_LINK = /^(https?:\/\/|mailto:|\/)/i

/** Split a line into inline tokens: text, bold, italic, code, link. */
export function parseInline(text) {
  const tokens = []
  // order matters: code first so ** inside backticks stays literal
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]]+\]\([^)]+\))/g
  let last = 0
  let match

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) {
      tokens.push({ type: 'text', value: text.slice(last, match.index) })
    }
    const piece = match[0]

    if (piece.startsWith('`')) {
      tokens.push({ type: 'code', value: piece.slice(1, -1) })
    } else if (piece.startsWith('**')) {
      tokens.push({ type: 'bold', value: piece.slice(2, -2) })
    } else if (piece.startsWith('*')) {
      tokens.push({ type: 'italic', value: piece.slice(1, -1) })
    } else {
      const label = piece.slice(1, piece.indexOf(']'))
      const href = piece.slice(piece.indexOf('(') + 1, -1)
      // refuse javascript: and data: URLs outright
      if (SAFE_LINK.test(href)) tokens.push({ type: 'link', value: label, href })
      else tokens.push({ type: 'text', value: label })
    }
    last = pattern.lastIndex
  }

  if (last < text.length) tokens.push({ type: 'text', value: text.slice(last) })
  return tokens
}

/** Parse a document into block tokens. */
export function parseMarkdown(source) {
  const lines = String(source || '').replace(/\r\n/g, '\n').split('\n')
  const blocks = []
  let paragraph = []
  let list = null

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push({ type: 'paragraph', inline: parseInline(paragraph.join(' ')) })
      paragraph = []
    }
  }
  const flushList = () => {
    if (list) {
      blocks.push(list)
      list = null
    }
  }
  const flushAll = () => { flushParagraph(); flushList() }

  for (const raw of lines) {
    const line = raw.trimEnd()

    if (!line.trim()) { flushAll(); continue }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line)
    if (heading) {
      flushAll()
      blocks.push({ type: 'heading', level: heading[1].length, inline: parseInline(heading[2]) })
      continue
    }

    if (/^(---+|\*\*\*+)$/.test(line.trim())) {
      flushAll()
      blocks.push({ type: 'rule' })
      continue
    }

    const quote = /^>\s?(.*)$/.exec(line)
    if (quote) {
      flushAll()
      blocks.push({ type: 'quote', inline: parseInline(quote[1]) })
      continue
    }

    const bullet = /^\s*[-*]\s+(.*)$/.exec(line)
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (bullet || numbered) {
      flushParagraph()
      const ordered = Boolean(numbered)
      if (!list || list.ordered !== ordered) {
        flushList()
        list = { type: 'list', ordered, items: [] }
      }
      list.items.push(parseInline((bullet || numbered)[1]))
      continue
    }

    flushList()
    paragraph.push(line.trim())
  }

  flushAll()
  return blocks
}
