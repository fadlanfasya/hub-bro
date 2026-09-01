// The app's one motion curve, shared by every hand-built animation (widget
// hover/load, the logo draw-in, modal open/close) rather than each picking
// its own.
export const EASE = 'cubic-bezier(0.16,1,0.3,1)'

// window.matchMedia is unimplemented in the jsdom test environment, so this
// guards instead of throwing there — callers get "no reduced motion" during
// tests rather than a crash.
export function prefersReducedMotion() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
