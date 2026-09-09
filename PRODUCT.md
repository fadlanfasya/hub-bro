# Product

## Register

product

## Users

Small-to-mid IT/ops and engineering teams who already run their own infrastructure — Prometheus, GLPI, a SQL database, internal REST APIs, the occasional CSV someone emailed. They're self-hosting because they want to own their data and avoid paying for (or standing up) a heavier BI platform for something that's really "check the same five numbers every day."

Three roles, one shared workspace (dashboards belong to the team, not a person):
- **Admin** — owns data sources, users, and everything editors can do.
- **Editor** — builds and edits dashboards, picks data sources, can't touch source configuration or user management.
- **Viewer** — reads dashboards and exports data, nothing else.

Context of use: checked routinely (a daily ops habit, not a one-off report), sometimes on a wall-mounted kiosk display, sometimes drilling from a stat card into the ticket or row that caused it via cross-filtering and `?q=` links. Often the only screen open while triaging an incident, so it needs to stay legible and fast under that kind of attention, not admired at leisure.

## Product Purpose

Pull numbers out of the systems a team already runs and put them on one screen, self-hosted, in one container. The job to be done is consolidation: stop tab-switching between Prometheus, GLPI, and a spreadsheet to answer "is everything okay." Success looks like a team trusting Hub-Bro enough to make it the one screen they check, and trusting it enough to run unattended on a wall display without worrying it's showing something stale or wrong.

## Brand Personality

**Precise, built, understated.** The existing CSS already commits to this: 6px radii everywhere ("soft corners read as friendly and tentative; this reads as built"), borders carry separation instead of shadows, no decoration without a reason. Voice is direct and technical — the README and in-code comments explain *why* a decision was made, plainly, with no marketing register. This is infrastructure a team relies on, not a product being sold to them.

## Anti-references

- **Generic AI-template dashboard** — purple/blue gradients, identical icon+heading cards, a hero-metric-with-gradient-accent, cream/sand backgrounds. The templated SaaS-dashboard look.
- **Playful / soft** — rounded-everything, pastel palettes, illustration-heavy empty states. Anything that reads as consumer-friendly rather than a serious tool an ops team is trusting with real infrastructure data.

## Design Principles

1. **Structure over decoration.** Borders and layout carry visual separation; shadows and gradients are reserved for when contrast genuinely needs them, never applied by default.
2. **Data is the interface.** Widgets, charts, and tables are the content; chrome (headers, nav, modals) stays quiet so it never competes with the numbers someone opened the page to see.
3. **Self-hosted trust.** The app holds credentials and internal infrastructure details. Every surface should read as something IT trusts to run unattended — precise, no surprises, nothing that resembles a dark pattern.
4. **Built, not friendly.** Favor confident, structural decisions over soft/approachable ones. This is a tool operators rely on, not an app being sold to them.
5. **Theming never breaks readability.** Per-dashboard themes and accents are real features, but any customization must never compromise legibility or the good/warn/critical distinction — precedent already set in `frontend/src/theme.js`, which nudges a custom accent until it clears 4.5:1 against the card background.

## Accessibility & Inclusion

WCAG AA. Contrast is already partly enforced in code (`theme.js` nudges any custom accent until it clears 4.5:1 against the card background) — new UI should hold that bar without relying on the runtime nudge to save it.

Given this is used for monitoring and alerting, **status/threshold color (good/warn/critical) must be distinguishable by more than hue alone** — an icon, shape, or label should carry the signal alongside color, not color by itself, for colorblind users reading a dashboard at a glance.
