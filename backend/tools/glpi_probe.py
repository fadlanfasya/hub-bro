#!/usr/bin/env python3
"""Find out which calling style a GLPI instance accepts for initSession.

    python tools/glpi_probe.py http://10.1.6.51/apirest.php APP_TOKEN USER_TOKEN

Tries every combination of method, credential placement and Content-Type, then
reports which ones return a session token — and follows up with a real data
request so you know the whole round trip works, not just the login.

Why this exists
---------------
GLPI answers ERROR_SESSION_TOKEN_MISSING for several unrelated causes: wrong
method, credentials the web server stripped, an IP outside the API client's
allowed range, or a body it could not parse. The error text is identical for
all of them, so guessing is slow. Sixteen requests settle it.

Run it from wherever the failure happens. Running it from a machine that works
and one that does not is the fastest way to tell a calling-style problem from
an IP-range problem.
"""
import argparse
import sys

import httpx


def probe(base, app_token, user_token, method, auth, ctype, verify, timeout=15):
    headers, params = {}, {}
    if auth == "header":
        headers["App-Token"] = app_token
        headers["Authorization"] = f"user_token {user_token}"
    else:
        params["app_token"] = app_token
        params["user_token"] = user_token
    # Sending a JSON content type on a request with no body is a real variable:
    # some servers then look for parameters in the body and find none.
    if ctype == "json":
        headers["Content-Type"] = "application/json"

    try:
        with httpx.Client(timeout=timeout, verify=verify, follow_redirects=True) as c:
            r = c.request(method, f"{base}/initSession", headers=headers, params=params)
        token = ""
        try:
            token = (r.json() or {}).get("session_token") or ""
        except Exception:  # noqa: BLE001 — a non-JSON body is itself the finding
            pass
        return r.status_code, token, (r.text or "")[:80].replace("\n", " ")
    except Exception as e:  # noqa: BLE001
        return "ERR", "", str(e)[:80]


def fetch_with(base, app_token, session_token, auth, itemtype, verify):
    """Confirm a data request works with the session we just obtained."""
    headers, params = {}, {"range": "0-4"}
    if auth == "header":
        headers["App-Token"] = app_token
        headers["Session-Token"] = session_token
    else:
        params["app_token"] = app_token
        params["session_token"] = session_token
    try:
        with httpx.Client(timeout=15, verify=verify, follow_redirects=True) as c:
            r = c.get(f"{base}/{itemtype}", headers=headers, params=params)
        return r.status_code, (r.text or "")[:80].replace("\n", " ")
    except Exception as e:  # noqa: BLE001
        return "ERR", str(e)[:80]


def main():
    p = argparse.ArgumentParser()
    p.add_argument("base_url", help="e.g. http://10.1.6.51/apirest.php")
    p.add_argument("app_token")
    p.add_argument("user_token")
    p.add_argument("--itemtype", default="SoftwareLicense")
    p.add_argument("--verify-ssl", action="store_true",
                   help="verify certificates (off by default, for self-signed hosts)")
    args = p.parse_args()

    base = args.base_url.rstrip("/")
    if base.endswith("initSession"):
        print("NOTE: drop /initSession from the URL — the script appends it.\n")
        base = base[: -len("/initSession")].rstrip("/")

    print(f"probing {base}\n")
    print(f"{'method':7}{'auth':8}{'ctype':7}{'status':8}{'token':7}body")
    print("-" * 96)

    winners = []
    for method in ("POST", "GET"):
        for auth in ("header", "query"):
            for ctype in ("none", "json"):
                status, token, body = probe(base, args.app_token, args.user_token,
                                            method, auth, ctype, args.verify_ssl)
                got = "yes" if token else "no"
                print(f"{method:7}{auth:8}{ctype:7}{str(status):8}{got:7}{body}")
                if token:
                    winners.append((method, auth, ctype, token))

    print()
    if not winners:
        print("Nothing returned a session token.")
        print("That rules out the calling style — look at these instead:")
        print("  * the tokens themselves (App-Token from the API client entry,")
        print("    user token from Preferences -> Remote access keys)")
        print("  * GLPI -> Setup -> General -> API: is the REST API enabled?")
        print("  * the API client's allowed IP range — must include THIS machine")
        print("  * run this same script from a machine where Postman works, and")
        print("    compare: same result means credentials, different means IP range")
        sys.exit(1)

    print(f"{len(winners)} combination(s) work:")
    for method, auth, ctype, _ in winners:
        print(f"  {method} with credentials in the {auth}"
              f"{' and a JSON content type' if ctype == 'json' else ''}")

    method, auth, ctype, token = winners[0]
    print(f"\nnow a real data request, using the {method}/{auth} session:")
    status, body = fetch_with(base, args.app_token, token, auth, args.itemtype,
                              args.verify_ssl)
    print(f"  GET /{args.itemtype} -> {status}")
    print(f"  {body}")
    if str(status).startswith("2"):
        print("\nThe full round trip works from this machine.")
    else:
        print("\nLogin works but the data request does not — that is a different")
        print("problem: check the account's read permission on that item type.")


if __name__ == "__main__":
    main()
