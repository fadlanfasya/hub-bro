/**
 * Minimal markdown parser producing a token tree, not HTML.
 *
 * Deliberately not using a markdown library with `dangerouslySetInnerHTML`:
 * an editor could otherwise plant a script in a text widget that runs for
 * every viewer, including on a public share link. Emitting tokens that React
 * renders as elements means nothing can escape into markup.
 *
 * Supported: #/##/### headings, **bold**, *italic*, `code`, [links](url),
 * - bullet lists, 1. numbered lists, > quotes, --- rules, paragraphs,
 * and pipe tables with an optional alignment row.
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

/** Split a table row into cell strings, tolerating missing outer pipes. */
export function splitRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '')
    .split('|').map((c) => c.trim())
}

/** Is this the `|---|:--:|` row that separates a table header from its body? */
export function isAlignmentRow(line) {
  if (!line || !line.includes('-')) return false
  const cells = splitRow(line)
  return cells.length > 0 && cells.every((c) => /^:?-{1,}:?$/.test(c))
}

/** left | center | right per column, from the alignment row. */
function parseAlignments(line) {
  return splitRow(line).map((c) => {
    const left = c.startsWith(':')
    const right = c.endsWith(':')
    if (left && right) return 'center'
    if (right) return 'right'
    return 'left'
  })
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

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index]
    const line = raw.trimEnd()

    if (!line.trim()) { flushAll(); continue }

    // a pipe table is a header row followed by an alignment row
    if (line.includes('|') && isAlignmentRow(lines[index + 1])) {
      flushAll()
      const header = splitRow(line)
      const aligns = parseAlignments(lines[index + 1])
      const rows = []
      let cursor = index + 2
      while (cursor < lines.length && lines[cursor].includes('|') && lines[cursor].trim()) {
        const cells = splitRow(lines[cursor])
        // pad or trim so every row matches the header width
        rows.push(header.map((_, i) => parseInline(cells[i] ?? '')))
        cursor += 1
      }
      blocks.push({
        type: 'table',
        header: header.map(parseInline),
        aligns: header.map((_, i) => aligns[i] || 'left'),
        rows,
      })
      index = cursor - 1
      continue
    }

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
