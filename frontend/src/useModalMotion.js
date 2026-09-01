import { useRef } from 'react'
import gsap from 'gsap'
import { useGSAP } from '@gsap/react'
import { EASE, prefersReducedMotion } from './motion'

gsap.registerPlugin(useGSAP)

// 'fade' — the standard dialog: drops 6px, scales to .98, fades.
// 'slide' — the widget-preview panel: slides in from the right, fades.
// Exit always reverses to its own entrance's start (mirror, not a new shape).
const VARIANTS = {
  fade: { from: { opacity: 0, y: 6, scale: 0.98 }, to: { opacity: 1, y: 0, scale: 1 }, enterDuration: 0.22, exitDuration: 0.18 },
  slide: { from: { opacity: 0, x: 40 }, to: { opacity: 1, x: 0 }, enterDuration: 0.28, exitDuration: 0.22 },
}

/**
 * Shared open/close motion for the app's modals and overlay panels. The
 * close mirrors the open on the app's one easing curve, and the caller's
 * `onClose` (or an alternate `after` callback passed to requestClose) only
 * fires once the exit tween completes — a plain `{open && <Modal/>}` unmount
 * has no such moment, so it vanishes mid-frame instead.
 */
export function useModalMotion(onClose, variant = 'fade') {
  const overlayRef = useRef(null)
  const boxRef = useRef(null)
  const closingRef = useRef(false)
  const spec = VARIANTS[variant]

  useGSAP(() => {
    if (prefersReducedMotion()) return
    gsap.fromTo(overlayRef.current, { opacity: 0 }, { opacity: 1, duration: 0.18, ease: EASE })
    gsap.fromTo(boxRef.current, spec.from, { ...spec.to, duration: spec.enterDuration, ease: EASE })
  }, { scope: overlayRef })

  // `after` lets a save/restore success run its own follow-up (e.g. onSave)
  // once the exit finishes, instead of just onClose. Guarded rather than
  // defaulted — requestClose is wired straight up as onClick in most callers,
  // and a bare `after = onClose` default would silently take the DOM click
  // event as `after` instead, since React passes it as the first argument.
  const requestClose = (after) => {
    const done = typeof after === 'function' ? after : onClose
    if (closingRef.current) return
    closingRef.current = true
    if (prefersReducedMotion()) { done(); return }
    gsap.to(overlayRef.current, { opacity: 0, duration: 0.18, ease: EASE })
    gsap.to(boxRef.current, { ...spec.from, duration: spec.exitDuration, ease: EASE, onComplete: done })
  }

  return { overlayRef, boxRef, requestClose }
}
