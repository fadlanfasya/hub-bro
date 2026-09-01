import { useRef } from 'react'
import gsap from 'gsap'
import { useGSAP } from '@gsap/react'
import { EASE, prefersReducedMotion } from '../motion'

gsap.registerPlugin(useGSAP)

// Hub-Bro logo — hexagon network mark (green #00694A, gold node #E9B452).
// Draws itself in once per mount: the hexagon strokes on, then each node pops
// in clockwise starting from the gold node, finishing on the center hub.
export default function Logo({ size = 20 }) {
  const svgRef = useRef(null)

  useGSAP(() => {
    if (prefersReducedMotion()) return

    const hex = svgRef.current.querySelector('.hb-hex')
    const nodes = svgRef.current.querySelectorAll('.hb-node')
    const hub = svgRef.current.querySelector('.hb-hub')
    const len = hex.getTotalLength()

    gsap.set(hex, { strokeDasharray: len, strokeDashoffset: len })
    // a hair above 0 rather than a literal 0 — scaling an element to exactly
    // zero can render as a degenerate/invisible shape in some browsers
    gsap.set([nodes, hub], { scale: 0.001, transformOrigin: '50% 50%' })

    gsap.timeline({ defaults: { ease: EASE } })
      .to(hex, { strokeDashoffset: 0, duration: 0.45 })
      .to(nodes, { scale: 1, duration: 0.2, stagger: 0.045 }, 0.315)
      .to(hub, { scale: 1, duration: 0.2 })
  }, { scope: svgRef })

  return (
    <svg ref={svgRef} width={size} height={size} viewBox="0 0 112 112" xmlns="http://www.w3.org/2000/svg" aria-label="Hub-Bro logo">
      <polygon className="hb-hex"
        points="56,10 95.8,33 95.8,79 56,102 16.2,79 16.2,33"
        fill="none" stroke="#00694A" strokeWidth="7" strokeLinejoin="round"
      />
      <circle className="hb-node" cx="56" cy="10" r="9.5" fill="#E9B452" />
      <circle className="hb-node" cx="95.8" cy="33" r="9.5" fill="#00694A" />
      <circle className="hb-node" cx="95.8" cy="79" r="9.5" fill="#00694A" />
      <circle className="hb-node" cx="56" cy="102" r="9.5" fill="#00694A" />
      <circle className="hb-node" cx="16.2" cy="79" r="9.5" fill="#00694A" />
      <circle className="hb-node" cx="16.2" cy="33" r="9.5" fill="#00694A" />
      <circle className="hb-hub" cx="56" cy="56" r="13" fill="#00694A" />
    </svg>
  )
}
