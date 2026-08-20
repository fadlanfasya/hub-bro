#!/usr/bin/env python3
"""Check the website holds together. Run: python3 website/check.py

Three failures are worth catching before anyone sees them, and all three are
silent in a browser:

  * an unclosed tag, which renders as something subtly wrong rather than broken
  * a link to a page that isn't there
  * a link to an anchor that used to exist — the table of contents is the usual
    victim, because renaming a heading doesn't touch the link pointing at it

Standard library only, so it runs anywhere without an install step.
"""
import sys
from html.parser import HTMLParser
from pathlib import Path

HERE = Path(__file__).resolve().parent

VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link",
        "meta", "param", "source", "track", "wbr"}


class Page(HTMLParser):
    def __init__(self, name):
        super().__init__()
        self.name = name
        self.open_tags = []
        self.ids = set()
        self.links = []
        self.problems = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if attrs.get("id"):
            self.ids.add(attrs["id"])
        if attrs.get("href"):
            self.links.append(attrs["href"])
        if tag == "img" and attrs.get("alt") is None:
            self.problems.append(f"<img> without alt: {attrs.get('src')}")
        if tag not in VOID:
            self.open_tags.append(tag)

    def handle_endtag(self, tag):
        if tag in VOID:
            return
        if not self.open_tags:
            self.problems.append(f"stray </{tag}>")
        elif self.open_tags[-1] != tag:
            self.problems.append(f"</{tag}> closes <{self.open_tags[-1]}>")
        else:
            self.open_tags.pop()


def main() -> int:
    pages = {}
    for path in sorted(HERE.glob("*.html")):
        page = Page(path.name)
        page.feed(path.read_text(encoding="utf-8"))
        page.close()
        if page.open_tags:
            page.problems.append(f"never closed: {page.open_tags}")
        pages[path.name] = page

    if not pages:
        print("no pages found")
        return 1

    problems = 0
    for name, page in pages.items():
        for problem in page.problems:
            print(f"  ! {name}: {problem}")
            problems += 1

        for href in page.links:
            if href.startswith(("http://", "https://", "mailto:", "#!")):
                continue
            target, _, anchor = href.partition("#")
            target = target or name
            if not (HERE / target).exists():
                print(f"  ! {name}: links to missing file {target}")
                problems += 1
            elif anchor and anchor not in pages.get(target, page).ids:
                print(f"  ! {name}: {target}#{anchor} has no such anchor")
                problems += 1

    for asset in ("style.css", "logo.svg"):
        if not (HERE / asset).exists():
            print(f"  ! missing asset {asset}")
            problems += 1

    total_links = sum(len(p.links) for p in pages.values())
    print(f"{len(pages)} pages, {total_links} links")
    print("OK" if not problems else f"{problems} problem(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
