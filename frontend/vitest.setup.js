// Tells React 18+ that act() is available, silencing the
// "current testing environment is not configured to support act(...)" warning.
globalThis.IS_REACT_ACT_ENVIRONMENT = true

// jsdom has no ResizeObserver, which recharts' ResponsiveContainer requires.
// A no-op stub is enough: we assert charts render, not that they lay out.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

// ResponsiveContainer measures its parent; jsdom reports zero, which makes
// recharts skip rendering entirely. Give elements a non-zero size.
if (typeof Element !== 'undefined' && !Element.prototype.__hbSized) {
  Element.prototype.__hbSized = true
  Object.defineProperty(Element.prototype, 'clientWidth', { value: 600, configurable: true })
  Object.defineProperty(Element.prototype, 'clientHeight', { value: 400, configurable: true })
  Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
    return { width: 600, height: 400, top: 0, left: 0, bottom: 400, right: 600, x: 0, y: 0 }
  }
}
