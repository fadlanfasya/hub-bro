#!/usr/bin/env python3
"""Compare what Hub-Bro *stores* against what actually works.

    python tools/glpi_diagnose.py            # every GLPI source
    python tools/glpi_diagnose.py --id 3     # just one

When a standalone probe succeeds but the app fails on the same machine against
the same GLPI, the difference is the stored configuration — not the network,
not the credentials you typed, not GLPI. This prints the config as the
connector actually sees it (secrets fingerprinted, never shown), then runs the
real connector code against it.

Fingerprints rather than values: length, first and last two characters, and
whether there is stray whitespace. That is enough to spot a truncated paste, a
trailing newline, or an empty field, without putting a credential on screen.
"""
import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("SECRET_KEY", os.environ.get("SECRET_KEY", ""))


def fingerprint(value) -> str:
    if value is None:
        return "MISSING (key absent)"
    if not isinstance(value, str):
        return f"not a string: {type(value).__name__}"
    if value == "":
        return "EMPTY STRING  <-- nothing was stored"
    stripped = value.strip()
    notes = []
    if stripped != value:
        notes.append("HAS SURROUNDING WHITESPACE  <-- likely a bad paste")
    if "\n" in value or "\r" in value:
        notes.append("CONTAINS A NEWLINE  <-- likely a bad paste")
    if value.startswith("enc:v1:"):
        notes.append("STILL ENCRYPTED  <-- decryption failed, check SECRET_KEY")
    shape = f"len={len(value)} starts={value[:2]!r} ends={value[-2:]!r}"
    return shape + ("  " + " ".join(notes) if notes else "")


async def check(ds):
    from app.connectors import glpi

    cfg = ds.config_dict
    print(f"\n=== data source #{ds.id}: {ds.name} ===")
    print(f"  base_url        {cfg.get('base_url')!r}")
    print(f"  verify_ssl      {cfg.get('verify_ssl', True)}")
    print(f"  tokens_in_query {bool(cfg.get('tokens_in_query'))}")
    print(f"  app_token       {fingerprint(cfg.get('app_token'))}")
    print(f"  user_token      {fingerprint(cfg.get('user_token'))}")

    url = (cfg.get("base_url") or "").rstrip("/")
    if not url:
        print("\n  base_url is empty — nothing to try.")
        return
    if not url.endswith("apirest.php"):
        print(f"\n  NOTE: base_url does not end in apirest.php. The connector "
              f"appends the endpoint, so it will call {url}/initSession")

    print("\n  running the real connector...")
    glpi._sessions.clear()
    try:
        token = await glpi._init_session(cfg)
        print(f"  initSession OK, session token len={len(token)}")
    except Exception as e:  # noqa: BLE001
        print(f"  initSession FAILED: {str(e)[:220]}")
        print("\n  Since the standalone probe works from this machine, compare the")
        print("  fingerprints above with the tokens you passed to the probe. A")
        print("  different length means the stored value is not what you think.")
        return

    for itemtype in ("SoftwareLicense", "Computer"):
        try:
            result = await glpi.fetch(cfg, {"itemtype": itemtype, "max_rows": 5})
            meta = result.get("meta") or {}
            print(f"  fetch {itemtype:16} OK — {len(result['rows'])} rows "
                  f"(server reports {meta.get('total')})")
            if result["rows"]:
                print(f"    columns: {', '.join(result['columns'][:8])}"
                      f"{' …' if len(result['columns']) > 8 else ''}")
        except Exception as e:  # noqa: BLE001
            print(f"  fetch {itemtype:16} FAILED: {str(e)[:160]}")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--id", type=int, help="only this data source")
    args = p.parse_args()

    if not os.environ.get("SECRET_KEY"):
        print("SECRET_KEY is not set. Stored credentials cannot be decrypted "
              "without it — run this the same way the app runs.")
        sys.exit(1)

    from app.database import SessionLocal
    from app.models import DataSource

    db = SessionLocal()
    q = db.query(DataSource).filter(DataSource.type == "glpi")
    if args.id:
        q = q.filter(DataSource.id == args.id)
    sources = q.all()

    if not sources:
        print("No GLPI data sources found in this database.")
        all_sources = db.query(DataSource).all()
        if all_sources:
            print("Sources that do exist:")
            for s in all_sources:
                print(f"  #{s.id} {s.name} ({s.type})")
        sys.exit(1)

    for ds in sources:
        asyncio.run(check(ds))


if __name__ == "__main__":
    main()
