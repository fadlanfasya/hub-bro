# Hub-Bro website

Static pages: a landing page and the docs. Plain HTML and one stylesheet — no
build step, no dependencies, nothing to keep up to date.

```
website/
  index.html   landing: what it is, connectors, what it is not
  docs.html    the guide, with a sticky table of contents
  style.css    shared; light and dark follow the visitor's system setting
  logo.svg     the app's own mark
  check.py     structure and link check, run in CI before every deploy
```

## Look at it locally

```bash
cd website
python -m http.server 4000
```

Then open <http://localhost:4000>. Opening `index.html` straight from the file
system works too — nothing here needs a server.

## Checking it

```bash
python3 website/check.py
```

Validates tag nesting and every internal link, including anchors. Renaming a
heading without updating the table of contents is the failure this catches; a
browser shows no error for it, it just doesn't scroll anywhere.

## Publishing

**GitHub Pages** — via Actions, not the branch setting. "Deploy from a branch"
only offers the repository root or `/docs`, and `docs/` here holds operator
notes rather than the site, so `.github/workflows/pages.yml` publishes
`website/` instead.

One-time setup: **Settings → Pages → Source → GitHub Actions**. After that,
every push touching `website/` runs the check and deploys if it passes. The
workflow only triggers on changes under `website/`, so a backend commit doesn't
republish identical files.

Site: <https://fadlanfasya.github.io/hub-bro/>

**nginx**, if you already run one for the app:

```nginx
location /site/ {
    alias /srv/hub-bro/website/;
    index index.html;
}
```

**The app's own container.** Copy `website/` into the image's static directory
and it is served alongside the UI. Only do this if the app itself is reachable
by the people who need the docs — otherwise the docs are behind the thing they
explain.

## Where the links point

GitHub is in the top navigation on both pages; Docker Hub is not. Someone
deciding whether to try Hub-Bro wants the source, the README and the issue
tracker — a registry page tells them nothing except that an image exists.
Docker Hub is a distribution detail, so it appears where it is actually needed:
in the deployment section, and in the footer.

Both pages link to `/issues` from the footer. A project with no visible way to
report a problem reads as unmaintained, whatever the commit history says.

## Editing

The docs deliberately repeat the reasoning behind a few decisions — why there is
no verify-SSL checkbox, why `SECRET_KEY` must never change, why the join is an
outer join. Those paragraphs are the ones that stop someone filing a bug or
losing their credentials, so keep them when trimming for length.

Keep it accurate over flattering. The "What it is not" section on the landing
page exists so nobody installs Hub-Bro expecting Grafana, and it is worth more
than another feature card.
