# Releasing and deploying

Code reaches the server in two independent steps, on purpose:

1. **You press Release in GitHub.** Tests run, an image is built and pushed to
   Docker Hub.
2. **The server notices and pulls it.** Watchtower polls Docker Hub and restarts
   the container.

Nothing pushes *into* the server, so it can sit on `10.1.6.x` with no inbound
port and no SSH key in GitHub. The tradeoff is a few minutes of lag between
pressing the button and the change appearing.

## One-time setup

### 1. GitHub secrets

Repository → Settings → Secrets and variables → Actions:

| Secret | Value |
|---|---|
| `DOCKERHUB_USERNAME` | `fadlanfasya` |
| `DOCKERHUB_TOKEN` | A Docker Hub **access token**, not your password |

Create the token at Docker Hub → Account settings → Personal access tokens,
with Read & Write scope. Using a token rather than the password means you can
revoke CI's access without changing your own login.

### 2. Start Watchtower on the server

It sits behind a compose profile, so it only runs when you ask for it:

```bash
docker compose --profile autodeploy up -d
```

Confirm it is watching:

```bash
docker logs hub-bro-watchtower --tail 20
```

It should report **1** container being watched. If it says more, the label
scoping is wrong — check that only `hubbro` carries the
`com.centurylinklabs.watchtower.enable` label. Grafana and Prometheus on that
host must never be in scope.

To turn auto-deploy off again:

```bash
docker compose stop watchtower
```

## Releasing

GitHub → Actions → **Release** → Run workflow → **Run**. That is the whole
procedure; every field is optional.

- **version** — leave blank. You get `2026.08.06-a1b2c3d` automatically, so the
  image running on the server can always be traced back to a commit. Fill it in
  only if you want a memorable number.
- **latest** — leave ticked. This is the tag the server follows; unticking
  publishes without deploying.
- **notes** — what changed, if you want it in the run summary.

The whole suite runs again before anything is pushed. Releasing an untested
commit is not possible through this path.

Within about five minutes the server pulls and restarts. Watch it happen:

```bash
docker logs -f hub-bro-watchtower
docker compose logs --tail=30 hub-bro
```

## Going back to an earlier build

Rarely needed, but it costs nothing to know. Every release publishes a dated
tag alongside `latest`, so pin one in `docker-compose.yml`:

```yaml
image: fadlanfasya/hub-bro:2026.08.06-a1b2c3d
```

```bash
docker compose up -d
```

Watchtower follows whatever tag you name, and a dated tag never moves, so this
holds until you put `latest` back.

## What a release does not do

- **It never touches your data.** Dashboards, users and encrypted credentials
  live in the `hubbro-data` volume, which is untouched by an image update.
- **It never changes `SECRET_KEY`.** That value must stay stable forever: it
  decrypts your stored data source credentials. Changing it does not delete
  them, it makes them unreadable, which looks like every source suddenly
  failing to authenticate.
- **It does not run database migrations separately.** They run automatically at
  startup and are additive only.

## After deploying

Hard-refresh the browser (Ctrl+Shift+R). The old JavaScript bundle is cached,
and new widget options will not appear until it is replaced.

## If something looks wrong

```bash
docker compose logs --tail=50 hub-bro
curl -fsS http://localhost:8080/api/health
```

For a data source that stops working after a deploy, the diagnose tools report
what the app actually has stored:

```bash
docker exec hub-bro python /app/tools/glpi_diagnose.py
docker exec hub-bro python /app/tools/glpi_probe.py \
    http://10.1.6.51/apirest.php APP_TOKEN USER_TOKEN
```
