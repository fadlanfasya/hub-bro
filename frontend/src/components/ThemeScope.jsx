import { useMemo } from 'react'
import { themeToCssVars } from '../theme'
import { useTheme } from '../useTheme'

/**
 * Applies a dashboard's theme by overriding CSS variables on a wrapper div.
 *
 * Scoped rather than global on purpose: the sidebar, modals and other
 * dashboards keep the app's own accent, so opening a violet dashboard doesn't
 * repaint the whole application.
 *
 * Charts read var(--chart-N) and controls read var(--primary), both of which
 * inherit — so nothing inside needs to know a theme exists.
 */
export default function ThemeScope({ theme, children, className }) {
  const [mode] = useTheme()
  const style = useMemo(
    () => themeToCssVars(theme, mode === 'dark' ? 'dark' : 'light'),
    [theme, mode]
  )
  return <div className={className} style={style}>{children}</div>
}
