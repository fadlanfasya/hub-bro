import { Link } from 'react-router-dom'
import { ArrowUpRight } from 'lucide-react'
import { isSafeUrl, linkProps } from '../links'

/**
 * Optional "go deeper" link in a widget header — to another dashboard or an
 * external system. Sits outside the drag handle's cancel zone so clicking it
 * navigates rather than starting a drag.
 */
export default function WidgetLink({ url, label }) {
  if (!isSafeUrl(url)) return null
  const props = linkProps(url)
  const text = label || (props.internal ? 'Open' : 'View')

  const body = <>{text}<ArrowUpRight size={11} /></>
  const className = 'widget-link widget-actions'

  return props.internal
    ? <Link to={props.to} className={className} onClick={(e) => e.stopPropagation()}>{body}</Link>
    : (
      <a className={className} href={props.href} target={props.target} rel={props.rel}
        onClick={(e) => e.stopPropagation()}>{body}</a>
    )
}
