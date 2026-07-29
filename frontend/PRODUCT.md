# Product

## Register

product

## Users

Internal ops/BI teams who connect data sources (CSV today, more source types planned via the `data.fetch` API) and assemble dashboards for their own team's use — no engineering support needed. They work from a desk during business hours, often with data-dense screens open for long stretches, so eye strain and scan-ability matter as much as visual appeal.

## Product Purpose

Hub-Bro lets internal teams build monitoring dashboards from whatever data they have, without waiting on engineering. Core loop: connect a data source → drop widgets onto a grid (stat, chart, table) → arrange and save. Success looks like: a new dashboard from raw data in minutes, and a dashboard that stays legible during long daily-monitoring sessions.

## Brand Personality

Calm & editorial. Spacious, confident, restrained — magazine-like poise applied to a dense data tool, not SaaS-dashboard flash. Confidence comes from typographic hierarchy and considered spacing, not gradients or decoration.

## Anti-references

- The generic dark-navy-bg + default-blue-accent + boxy-card admin template look (what the app currently is).
- Bootstrap-admin-template chrome and Tableau/PowerBI-style enterprise heaviness.
- AI-slop scaffolding: gradient text, side-stripe card borders, glassmorphism-as-default, hero-metric clichés, tiny uppercase eyebrows, numbered section markers, identical card grids.

## Design Principles

1. **Calm density** — dense information gets breathing room and clear grouping, not cramming or ornamentation.
2. **One considered accent** — the accent color carries meaning (state, emphasis, action), not decoration; no default-blue-because-that's-the-default.
3. **Editorial restraint over SaaS flash** — typography and spacing carry hierarchy instead of gradients, glass, or shadow stacking.
4. **Data first** — widgets and charts get visual priority; chrome (nav, modals, forms) stays quiet.
5. **Dual-theme parity** — light and dark are both deliberately designed, not one default plus an inverted afterthought.

## Accessibility & Inclusion

WCAG AA contrast baseline throughout (body text ≥4.5:1, including placeholder text). Full keyboard navigation, including modals and an accessible fallback for grid drag/resize interactions. All motion respects `prefers-reduced-motion`.
