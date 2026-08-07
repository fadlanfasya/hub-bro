#!/usr/bin/env python3
"""Create the Ops Overview dashboard and its ten drill-down dashboards.

    python tools/seed_ops_overview.py --url http://localhost:8080 \
        --email you@company.com --password secret

Options:
    --dry-run     print what would be created, touch nothing
    --prefix STR  name prefix for the drill-downs (default "Ops · ")
    --replace     rebuild the overview if it already exists

Why a script rather than clicking
---------------------------------
The overview is ten tiles that must each link to a dashboard that does not
exist yet — a chicken-and-egg problem that is tedious by hand and easy to get
wrong. The script creates the drill-downs first, then builds tiles pointing at
their real ids.

Honesty about coverage
----------------------
Only domains with a connected data source get a live tile. The rest are
created as text placeholders naming the source they need. An empty stat widget
that renders a red error is worse than a tile that says what is missing — the
first looks broken, the second looks like a plan.
"""
import argparse
import json
import sys

import httpx

# --------------------------------------------------------------------------
# the ten domains, in whiteboard order
# --------------------------------------------------------------------------
# needs: which connected source type feeds it. None = no source needed.
# metric: the headline number, once wired.
DOMAINS = [
    {"n": 1, "key": "service", "title": "Service Mgt", "accent": "#0b6bcb",
     "needs": "sql", "metric": "SLA breaches, open",
     "why": "Open tickets past their SLA right now."},
    {"n": 2, "key": "capacity", "title": "Capacity Mgt", "accent": "#0891b2",
     "needs": "prometheus", "metric": "Filesystems over 85%",
     "why": "Prefer days-until-full over percent-full once this is wired."},
    {"n": 3, "key": "network", "title": "Network Mgt", "accent": "#7c3aed",
     "needs": "prometheus", "metric": "Interfaces down",
     "why": "Add loss, latency and utilisation on the drill-down."},
    {"n": 4, "key": "security", "title": "Security Mgt", "accent": "#be123c",
     "needs": None, "metric": "Certs expiring in 30 days",
     "why": "No source connected yet. Certificate expiry is the cheapest start."},
    {"n": 5, "key": "license", "title": "License Mgt", "accent": "#a16207",
     "needs": "glpi", "metric": "Over-deployed licences",
     "why": "The compliance risk, not the licence count."},
    {"n": 6, "key": "data", "title": "Data Mgt", "accent": "#0f766e",
     "needs": "sql", "metric": "Hours since last backup",
     "why": "Backup age beats backup success: a job that stopped running never fails."},
    {"n": 7, "key": "event", "title": "Event Mgt", "accent": "#c2410c",
     "needs": "truewatch", "metric": "Open alerts",
     "why": "Track the noisiest rules too, or people stop reading alerts."},
    {"n": 8, "key": "vendor", "title": "Vendor Mgt", "accent": "#4338ca",
     "needs": "glpi", "metric": "Contracts expiring in 60 days",
     "why": "Renewal dates are the actionable part."},
    {"n": 9, "key": "health", "title": "Health Mgt", "accent": "#00694a",
     "needs": None, "metric": "Services down",
     "why": "Absorbs Availability. Data source health already lives on its own page."},
    {"n": 10, "key": "version", "title": "Version Mgt", "accent": "#525252",
     "needs": "glpi", "metric": "Systems on EOL versions",
     "why": "Count what is unsupported, not what version each thing is on."},
]

# Live queries for domains we can wire today. Column aliases match value_field.
SERVICE_BREACH_SQL = """SELECT
  SUM(CASE WHEN age_min > sla_min THEN 1 ELSE 0 END) AS breach
FROM (
  SELECT
    TIMESTAMPDIFF(MINUTE, date_open, NOW()) AS age_min,
    CASE UPPER(priority_name)
         WHEN 'CRITICAL' THEN 480
         WHEN 'HIGH'     THEN 720
         WHEN 'MEDIUM'   THEN 1440
         ELSE 2880
    END AS sla_min
  FROM internal.bronze_omnyxdb_prod_stream.reporting
  WHERE UPPER(ticket_status_name) NOT IN ('CLOSE', 'CLOSED', 'RESOLVED')
    AND date_open IS NOT NULL
) t"""

# tile geometry: 3 rows of 4 on a 12-column grid
TILE_W, TILE_H = 3, 3
HEADER_H = 2


class Api:
    def __init__(self, base, token, dry_run=False):
        self.base = base.rstrip("/")
        self.h = {"Authorization": f"Bearer {token}"}
        self.dry_run = dry_run
        self.client = httpx.Client(timeout=30)

    def get(self, path):
        r = self.client.get(self.base + path, headers=self.h)
        r.raise_for_status()
        return r.json()

    def post(self, path, body):
        if self.dry_run:
            print(f"    [dry-run] POST {path} {json.dumps(body)[:90]}")
            return {"id": 0, "name": body.get("name", "?")}
        r = self.client.post(self.base + path, headers=self.h, json=body)
        r.raise_for_status()
        return r.json()

    def put(self, path, body):
        if self.dry_run:
            print(f"    [dry-run] PUT {path} ({len(json.dumps(body))} bytes)")
            return {}
        r = self.client.put(self.base + path, headers=self.h, json=body)
        r.raise_for_status()
        return r.json()


def login(base, email, password):
    r = httpx.post(f"{base.rstrip('/')}/api/auth/login",
                   data={"username": email, "password": password}, timeout=30)
    if r.status_code != 200:
        sys.exit(f"Login failed ({r.status_code}): {r.text[:200]}")
    return r.json()["access_token"]


def pick_source(sources, wanted_type):
    """First source of the wanted type, preferring one that looks production-ish."""
    if not wanted_type:
        return None
    matches = [s for s in sources if s["type"] == wanted_type]
    if not matches:
        return None
    for s in matches:
        name = s["name"].lower()
        if any(w in name for w in ("prod", "dwh", "ops", "main")):
            return s
    return matches[0]


def stat_tile(wid, domain, ds_id, query, value_field, link, thresholds=None):
    return {
        "id": wid,
        "type": "stat",
        "title": f"{domain['n']}. {domain['title']}",
        "datasource_id": ds_id,
        "options": {
            "query": query,
            "value_field": value_field,
            "aggregate": "first",
            "label": domain["metric"],
            "accent": domain["accent"],
            "widget_bg": "soft",
            "thresholds": thresholds or {"direction": "above", "warn": 1, "critical": 5},
            "link": link,
            "link_label": "Open",
        },
    }


def placeholder_tile(wid, domain, link):
    need = f"Needs a **{domain['needs']}** source." if domain["needs"] \
        else "**No source connected yet.**"
    return {
        "id": wid,
        "type": "text",
        "title": f"{domain['n']}. {domain['title']}",
        "options": {
            "text": (f"### {domain['title']}\n\n"
                     f"{need}\n\n"
                     f"Planned: {domain['metric']}\n\n"
                     f"[Open dashboard]({link})"),
            # font_size is a pixel number, not a t-shirt size
            "font_size": "12",
            "align": "left",
            "valign": "top",
            "accent": domain["accent"],
            "widget_bg": "none",
        },
    }


def build(api, prefix, replace):
    sources = api.get("/api/datasources")
    print(f"  found {len(sources)} data source(s): "
          f"{', '.join(sorted({s['type'] for s in sources})) or 'none'}")

    existing = {d["name"]: d for d in api.get("/api/dashboards")}

    overview_name = "Ops Overview"
    if overview_name in existing and not replace:
        sys.exit(f"'{overview_name}' already exists. Re-run with --replace to rebuild it.")

    # 1. drill-downs first, so tiles can link to real ids
    print("\n  drill-down dashboards")
    links = {}
    for d in DOMAINS:
        name = f"{prefix}{d['title']}"
        if name in existing:
            dash = existing[name]
            print(f"    · {name} (already exists, id {dash['id']})")
        else:
            dash = api.post("/api/dashboards", {"name": name, "visibility": "workspace"})
            print(f"    + {name} (id {dash['id']})")
        links[d["key"]] = f"/dashboards/{dash['id']}"

    # 2. the overview itself
    print("\n  overview")
    if overview_name in existing:
        overview = existing[overview_name]
        print(f"    · reusing id {overview['id']}")
    else:
        overview = api.post("/api/dashboards",
                            {"name": overview_name, "visibility": "workspace"})
        print(f"    + created id {overview['id']}")

    widgets = [{
        "id": "hdr",
        "type": "text",
        "title": "",
        "options": {
            "text": ("# Operations Overview\n\n"
                     "One number per domain. Click a tile to drill in. "
                     "Grey tiles are not wired to a data source yet."),
            "font_size": "16", "align": "left", "valign": "middle",
        },
    }]
    layout = [{"id": "hdr", "x": 0, "y": 0, "w": 12, "h": HEADER_H}]

    wired = 0
    for i, d in enumerate(DOMAINS):
        wid = f"tile_{d['key']}"
        src = pick_source(sources, d["needs"])
        link = links[d["key"]]

        if src and d["key"] == "service":
            widgets.append(stat_tile(wid, d, src["id"], SERVICE_BREACH_SQL, "breach", link))
            wired += 1
            note = f"live on '{src['name']}'"
        else:
            # A source of the right type exists but we have no vetted query for
            # this domain yet. Guessing a query would produce a confidently
            # wrong number, which is worse than an honest blank.
            widgets.append(placeholder_tile(wid, d, link))
            note = (f"placeholder — '{src['name']}' available, query still to write"
                    if src else "placeholder — no source")

        col = i % 4
        row = i // 4
        layout.append({
            "id": wid,
            "x": col * TILE_W,
            "y": HEADER_H + row * TILE_H,
            "w": TILE_W, "h": TILE_H,
        })
        print(f"    {d['n']:>2}. {d['title']:<15} {note}")

    api.put(f"/api/dashboards/{overview['id']}",
            {"definition": {"widgets": widgets, "layout": layout},
             "version": overview.get("version", 1)})

    print(f"\n  {wired} live tile(s), {len(DOMAINS) - wired} placeholder(s)")
    print(f"  open: {api.base}/dashboards/{overview['id']}")


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--url", default="http://localhost:8080")
    p.add_argument("--email", required=True)
    p.add_argument("--password", required=True)
    p.add_argument("--prefix", default="Ops · ")
    p.add_argument("--replace", action="store_true")
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args()

    print(f"Hub-Bro at {args.url}")
    token = login(args.url, args.email, args.password)
    api = Api(args.url, token, dry_run=args.dry_run)
    build(api, args.prefix, args.replace)


if __name__ == "__main__":
    main()
