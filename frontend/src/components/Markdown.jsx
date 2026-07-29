import { parseMarkdown } from '../markdown'

/**
 * Renders the token tree from markdown.js as React elements.
 * Nothing goes through dangerouslySetInnerHTML, so widget text can't inject
 * markup or scripts — which matters because these dashboards get shared publicly.
 */
export default function Markdown({ source, size, align, valign }) {
  const blocks = parseMarkdown(source)

  if (!blocks.length) {
    return <p className="muted" style={{ margin: 0 }}>Empty — add some text in the widget config.</p>
  }

  // headings and code scale with the body size via em, so one number
  // resizes the whole block proportionally
  const style = Number(size) ? { fontSize: `${Number(size)}px` } : undefined
  const className = [
    'markdown',
    align && align !== 'left' ? `align-${align}` : '',
    valign && valign !== 'top' ? `v-${valign}` : '',
  ].filter(Boolean).join(' ')

  return (
    <div className={className} style={style}>
      {blocks.map((block, i) => {
        switch (block.type) {
          case 'heading': {
            const Tag = `h${block.level + 1}`   // h1 in content maps to h2 in the page
            return <Tag key={i}><Inline tokens={block.inline} /></Tag>
          }
          case 'rule':
            return <hr key={i} />
          case 'quote':
            return <blockquote key={i}><Inline tokens={block.inline} /></blockquote>
          case 'list': {
            const Tag = block.ordered ? 'ol' : 'ul'
            return (
              <Tag key={i}>
                {block.items.map((item, j) => <li key={j}><Inline tokens={item} /></li>)}
              </Tag>
            )
          }
          default:
            return <p key={i}><Inline tokens={block.inline} /></p>
        }
      })}
    </div>
  )
}

function Inline({ tokens }) {
  return tokens.map((t, i) => {
    switch (t.type) {
      case 'bold': return <strong key={i}>{t.value}</strong>
      case 'italic': return <em key={i}>{t.value}</em>
      case 'code': return <code key={i}>{t.value}</code>
      case 'link':
        return (
          <a key={i} href={t.href} target="_blank" rel="noopener noreferrer">{t.value}</a>
        )
      default: return <span key={i}>{t.value}</span>
    }
  })
}
