// Hub-Bro logo — hexagon network mark (green #00694A, gold node #E9B452)
export default function Logo({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 112 112" xmlns="http://www.w3.org/2000/svg" aria-label="Hub-Bro logo">
      <polygon
        points="56,10 95.8,33 95.8,79 56,102 16.2,79 16.2,33"
        fill="none" stroke="#00694A" strokeWidth="7" strokeLinejoin="round"
      />
      <circle cx="95.8" cy="33" r="9.5" fill="#00694A" />
      <circle cx="95.8" cy="79" r="9.5" fill="#00694A" />
      <circle cx="56" cy="102" r="9.5" fill="#00694A" />
      <circle cx="16.2" cy="79" r="9.5" fill="#00694A" />
      <circle cx="16.2" cy="33" r="9.5" fill="#00694A" />
      <circle cx="56" cy="10" r="9.5" fill="#E9B452" />
      <circle cx="56" cy="56" r="13" fill="#00694A" />
    </svg>
  )
}
