# Hub-Bro

Unified dashboard platform MVP — connect data from APIs, monitoring tools, and files, and build dashboards in one place.

## Features

- Accounts with roles (admin / editor / viewer), created by an admin — see [Users and roles](#users-and-roles)
- Data source connectors:
  - **REST API** — any JSON endpoint, custom headers, optional SSL verification
  - **CSV upload**
  - **Prometheus** — instant and range PromQL queries
  - **GLPI** — automatic session handling, pagination, and server-side filter pushdown
  - **SQL** — PostgreSQL / MySQL / SQLite, one SELECT per widget
- Data transforms per widget: filter rows, group by a column, aggregate (count/sum/avg/min/max), sort, limit
- Drag-and-drop dashboard builder (12-column grid, auto-save). Widgets stay where you drop them, can be locked in place, and have a minimum size so charts stay readable
- Widget types: line chart, bar chart, pie/donut, stat card, gauge, table, text/markdown
- Stat widgets can show a trend against another column or the previous row
- Tables sort on click, filter in place (search box plus per-column value pickers), and support conditional colouring
- Unpivot turns wide `count(*) FILTER (…)` results into chartable rows
- Per-dashboard themes (preset palettes or a custom accent), with an optional per-widget accent
- Cross-filtering: click a pie slice, bar, or table row to filter the whole dashboard
- Version history with restore, and a conflict warning when two editors overlap
- Dashboard time range picker (15m → 30d); widgets can follow it or pin their own window
- Export any widget as CSV or PNG, or the whole dashboard as a PNG
- Per-widget auto refresh (10s → 15m), with backend response caching so several widgets on one source share a single upstream request
- Alert thresholds on stat widgets (warn / critical colouring)
- Read-only share links and a kiosk mode for wall displays
- Credentials encrypted at rest and masked in API responses

## Stack

- Backend: FastAPI + SQLAlchemy + SQLite (`backend/`)
- Frontend: React (Vite) + gridstack + recharts (`frontend/`)

## Run (development)

Two processes: Vite serves the UI and proxies `/api` to the backend. For production use Docker instead — see below.

Backend (port 8000):

```bash
cd backend
python -m venv venv
venv\Scripts\activate        # Windows (source venv/bin/activate on Linux/Mac)
pip install -r requirements.txt

copy .env.example .env       # cp on Linux/Mac — then set SECRET_KEY
uvicorn app.main:app --reload
```

Generate a key with `python -c "import secrets; print(secrets.token_urlsafe(48))"`.
Without one the server still runs but uses a random key that changes on every
restart, so logins won't survive a reload.

Frontend (port 5173, proxies /api to the backend):

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173, register an account, add a data source, create a dashboard, add widgets.

## Try it quickly

Add a REST source with URL `https://jsonplaceholder.typicode.com/users` (no headers), then create a dashboard with a table widget on it — or a stat widget with aggregate "Row count".

## Users and roles

The **first person to open the app registers the admin account**, and self-registration then closes permanently. Every account after that is created from the **Users** page. This matters if you expose Hub-Bro publicly (a Cloudflare tunnel, say) — nobody who finds the URL can create themselves an account.

| Capability | Admin | Editor | Viewer |
|---|:--:|:--:|:--:|
| View dashboards | ✓ | ✓ | ✓ |
| Export data (CSV/PNG) | ✓ | ✓ | ✓ |
| Create and edit dashboards | ✓ | ✓ | — |
| Create share links | ✓ | ✓ | — |
| View data sources | ✓ | ✓ | — |
| Add and edit data sources | ✓ | — | — |
| Manage users | ✓ | — | — |

Dashboards and data sources belong to the **workspace**, not to a person: everyone sees the same dashboards, and the role decides who can change them. Deleting a user leaves their dashboards in place.

Notes on the reasoning:

- **Viewers can't see data sources** because a source config exposes internal hostnames and which systems exist, even with credentials masked. They still see the data through dashboards.
- **Only admins edit data sources**, since a source is shared infrastructure and one bad edit breaks every dashboard using it.
- **Viewers can't call `/api/data/fetch`.** They load widget data through a widget-scoped endpoint where the query comes from the stored dashboard. Otherwise "read-only" would still let someone run arbitrary SQL against a SQL source.
- You can't demote, deactivate or delete the last remaining admin, and can't deactivate or delete yourself.
- Deactivating someone takes effect immediately, even if they hold a valid token.

Users change their own password under **Account**; admins can reset anyone's from **Users**.

## Deploying with Docker

```bash
cp .env.example .env
# set SECRET_KEY — generate one with:
docker run --rm python:3.12-slim python -c "import secrets; print(secrets.token_urlsafe(48))"

docker compose up -d --build
```

The app is then on `http://<server>:8080` — frontend and API on a single port, no separate web server needed. Put nginx/IIS in front for TLS; the container already trusts `X-Forwarded-*`.

**Set `CORS_ORIGINS` in `.env`** to the address people actually type (including port), e.g. `http://dashboards.internal:8080`. Widgets will fail to load data if this doesn't match.

Useful commands:

```bash
docker compose logs -f          # follow logs
docker compose ps               # health status
docker compose up -d --build    # deploy an update
```

**Data lives in the `hubbro-data` volume** — the SQLite database and uploaded CSVs. It survives rebuilds. Back it up:

```bash
docker run --rm -v hubbro-data:/data -v "$PWD:/backup" \
  alpine tar czf /backup/hubbro-backup.tgz /data
```

Two things the container enforces that dev mode doesn't: it **refuses to start** without a valid `SECRET_KEY` (or with wildcard CORS), and `/docs` is disabled. Don't change `SECRET_KEY` after the first run — it logs everyone out *and* makes stored data-source credentials unreadable.

## Connecting GLPI

1. In GLPI: **Setup → General → API** — enable the REST API and create an API client to get an **App-Token**.
2. **Preferences → Remote access keys** — generate an **API token** for your user.
3. In Hub-Bro, add a GLPI source with the `apirest.php` URL (e.g. `http://10.1.6.51/glpi/apirest.php`), both tokens, and uncheck SSL verification if the server uses a self-signed certificate.

Hub-Bro opens the session, reuses it across requests, and re-opens it automatically when it expires. In a widget, set **Item type** (Computer, Ticket, …) and use *Filter & summarize* to chart things like VMs per status:

- Group by `states_id`, summarize with **Count of rows**, sort by `count` desc → bar or pie chart.

## Sharing a dashboard

Open a dashboard → **Share** → *Create link*. This produces two URLs:

- `/shared/<token>` — read-only view, no login needed
- `/shared/<token>?kiosk=1&refresh=60` — chrome-free view that reloads every 60s, for a wall display

Viewers can only see that one dashboard, and can only run the queries its widgets already contain — the token gives no access to your other dashboards or data sources. *Revoke link* kills it immediately; re-sharing issues a fresh token.

## Tests

```bash
cd backend
bash tests/run_all.sh                 # everything (228 assertions)

python tests/test_transforms.py       # transform unit tests
python tests/test_security.py         # encryption + SQL query validation
python tests/test_cache.py            # memory + redis cache backends
bash tests/test_integration.sh        # API, caching, transforms
bash tests/test_glpi.sh               # pagination, filter pushdown, session recovery
bash tests/test_sharing.sh            # sharing, duplication, access isolation
bash tests/test_permissions.sh        # every role against every endpoint
bash tests/test_history.sh            # snapshots, restore, concurrent edits
bash tests/test_production.sh         # config guards, SPA serving, persistence
```

```bash
cd frontend
npm test                              # data shaping, tables, theme, selection, grid (277 tests)
```

The GLPI suites run against a mock GLPI server (`tests/mock_glpi.py`) — no real instance needed.

## Architecture notes

- `backend/app/connectors/` — one module per source type; each returns normalized `{columns, rows}`. Add a new connector by writing a `fetch(config, options)` and registering it in `connectors/__init__.py`.
- `backend/app/transforms.py` — filtering/grouping/sorting applied *after* the fetch, so transforms never change the cache key. Widgets showing different views of one source share a single upstream request.
- `backend/app/cache.py` — in-process TTL cache (`CACHE_TTL_SECONDS`, default 15s), with a per-key lock so concurrent widgets don't stampede the source. Swap in Redis behind the same `get`/`set` interface for multi-process deployments.
- `backend/app/permissions.py` — the single source of truth for the role matrix. `/api/users/roles` serves it to the UI, so the table in the app can't drift from what's enforced.
- `backend/app/secrets_store.py` — Fernet encryption for tokens and passwords, keyed off `SECRET_KEY`. Changing `SECRET_KEY` makes stored credentials unreadable and they must be re-entered.
- `backend/app/migrations.py` — additive column migrations run at startup, so an existing database picks up new columns. Move to Alembic if schema changes get more involved.
- Connectors that can filter server-side (GLPI, SQL) receive `filters` directly and report back anything they couldn't translate, which the transform layer then applies in Python.
- `frontend/src/components/DashboardGrid.jsx` — gridstack wrapper. gridstack owns the item elements (it has to position them) and React renders each widget's content into them through a portal, so the two never fight over the same nodes. `float: true` is what stops widgets snapping upward.
- `backend/app/static_files.py` — in production the API also serves the built frontend, with a fallback so client-side routes like `/dashboards/3` return the app while unknown `/api` paths still return a JSON 404.
- `frontend/src/selection.js` — cross-filters are sent as `cross_filters`, which the backend treats as a transform. That keeps them out of the cache key, so clicking a slice re-filters cached data rather than re-querying the source. A cross-filter on a column a widget doesn't have is skipped, unlike a configured filter which would exclude every row.
- `frontend/src/theme.js` — themes set only the accent and chart colours; surfaces and text stay on the app's tokens, and any accent is nudged until it clears 4.5:1 against the card background. That's why a theme can't make a dashboard unreadable.
- `frontend/src/layout.js` — converts between the stored layout (`{i,x,y,w,h}`) and gridstack's (`{id,...}`), so dashboards saved before the grid migration keep working.
- Dashboard definitions (widgets + grid layout) are stored as a JSON blob per dashboard.
- The backend proxies all data fetches, so API keys stay server-side and CORS is never an issue.

## Running multiple workers

The cache defaults to an in-process dict, which is why the container runs a single uvicorn worker. To scale out, uncomment the `redis` service and `REDIS_URL` in `docker-compose.yml`, then raise the worker count. Cache entries are then shared and survive restarts.

If Redis is configured but unreachable, the app logs a warning and falls back to the in-process cache rather than failing — `GET /api/health` reports which backend is live.

## Known limits
- Alert thresholds colour the widget but don't notify anywhere yet.
- There's no rate limiting on login. Fine on a private network; add Cloudflare Access or similar before exposing the app publicly.
- Version history keeps the last 30 snapshots per dashboard, and collapses saves made by the same person within two minutes.
- GLPI fetches up to **Max rows** per widget (default 1000). Above that, a widget shows "Showing N of M" and its counts cover only the fetched rows.

## Next steps

- Webhook/email delivery for threshold alerts
- Refresh tokens; Redis-backed cache for multi-worker deployments
- Dashboard-level variables (e.g. a location filter applied to every widget)
