# Hub-Bro website

Static pages: a landing page and the docs. Plain HTML and one stylesheet — no
build step, no dependencies, nothing to keep up to date.

```
website/
  index.html   landing: what it is, connectors, what it is not
  docs.html    the guide, with a sticky table of contents
  style.css    shared; light and dark follow the visitor's system setting
  logo.svg     the app's own mark
```

## Look at it locally

```bash
cd website
python -m http.server 4000
```

Then open <http://localhost:4000>. Opening `index.html` straight from the file
system works too — nothing here needs a server.

## Publishing

**GitHub Pages.** Settings → Pages → Deploy from a branch, folder `/website`.
Nothing else to configure.

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

## Editing

The docs deliberately repeat the reasoning behind a few decisions — why there is
no verify-SSL checkbox, why `SECRET_KEY` must never change, why the join is an
outer join. Those paragraphs are the ones that stop someone filing a bug or
losing their credentials, so keep them when trimming for length.

Keep it accurate over flattering. The "What it is not" section on the landing
page exists so nobody installs Hub-Bro expecting Grafana, and it is worth more
than another feature card.
