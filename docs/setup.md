# Setup

Works with **Plane Cloud** and **self-hosted Plane**. The only difference is two URLs.

## Requirements

- **Node.js 20.11 or newer** — the client uses the built-in `fetch` and `AbortSignal.timeout`
- A **Plane API token** and the workspace it belongs to
- **Redis** — optional. Without it the lookup cache is per process, which is fine for CLI use
- **Postgres** — not used yet. Reserved for saved filter presets, which are not implemented

## Install

```bash
npm install
cp .env.example .env
```

Then fill in the four required values below.

## Getting an API token

Plane → **Workspace Settings** → **API tokens** → **Add API token**. Copy it immediately; Plane
shows it once.

Two things to know about the token:

- It is **workspace scoped** and sent as the `X-API-Key` header, not as a bearer token.
- It carries **its owner's permissions**. An export run with your token sees the projects you are
  a member of and nothing else. If you deploy this for a team, use a service account that belongs
  to every project people will want to export — otherwise some of them get empty results and no
  explanation.

## Pointing it at your Plane

### Plane Cloud

```bash
PLANE_API_URL=https://api.plane.so/api/v1
PLANE_APP_URL=https://app.plane.so
```

### Self-hosted

Use your own domain. The API lives under `/api/v1` on the same host as the app:

```bash
PLANE_API_URL=https://plane.example.com/api/v1
PLANE_APP_URL=https://plane.example.com
```

### Finding your workspace slug

It is the first path segment after the host in any Plane URL:

```
https://app.plane.so/acme/projects/8f14e45f-.../issues/
                     ^^^^
                     PLANE_WORKSPACE_SLUG=acme
```

The same slug appears in every API path, which is why a wrong one surfaces as a 401 or 404 rather
than a helpful error.

## Environment variables

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `PLANE_API_URL` | **yes** | — | Include the `/api/v1` prefix |
| `PLANE_APP_URL` | **yes** | — | Web app root, used for the spreadsheet's link column |
| `PLANE_API_KEY` | **yes** | — | Workspace scoped token |
| `PLANE_WORKSPACE_SLUG` | **yes** | — | As it appears in the Plane URL |
| `NODE_ENV` | no | `development` | `development` \| `test` \| `production` |
| `PORT` | no | `3000` | HTTP server only; the CLI ignores it |
| `PLANE_RATE_LIMIT_PER_MINUTE` | no | `55` | Keep below your server's limit — see below |
| `PLANE_PAGE_SIZE` | no | `100` | Plane caps this at 100 and ignores larger values |
| `PLANE_MAX_PAGES` | no | `500` | Safety cap per list call |
| `PLANE_REQUEST_TIMEOUT_MS` | no | `30000` | |
| `PLANE_MAX_RETRIES` | no | `4` | Retries after the initial attempt |
| `PLANE_RETRY_BASE_MS` | no | `500` | First backoff; doubles, with full jitter |
| `LOOKUP_CACHE_TTL_SECONDS` | no | `300` | How long lookup tables stay cached |
| `REDIS_URL` | no | — | Lookup cache; in-memory when unset |
| `DATABASE_URL` | no | — | Unused today; reserved for saved filter presets |

Validation runs at boot via a Zod schema, so a missing or malformed value stops the process and
prints **every** problem at once rather than surfacing as a confusing 401 on your first export.

## About the rate limit

Plane throttles **per API key** — 60 requests per minute by default.

`PLANE_RATE_LIMIT_PER_MINUTE` is this client's own throttle, defaulted to 55 to leave headroom for
anything else using the same token. Three things worth knowing:

1. **Keep it below your server's value.** On Plane Cloud that value is fixed at 60. On self-hosted
   it comes from the API container's `API_KEY_RATE_LIMIT` environment variable, so you can raise
   both if exports turn out to be throughput-bound.
2. **It is enforced per process.** Two containers sharing one token will each assume the full
   budget. If you scale out, the limiter needs to become a shared Redis token bucket —
   `src/plane/http/rate-limiter.ts` is the only file that would change.
3. **The server is still the authority.** The client watches the `X-RateLimit-Remaining` and
   `X-RateLimit-Reset` response headers and stalls until the window resets if the budget is gone.
   On a 429 it honours `Retry-After` and applies it to every in-flight request, not just the one
   that was rejected.

## The lookup cache

A spreadsheet full of UUIDs is useless, so before fetching work items the service loads a
project's states, labels, members, modules, cycles and estimate points, then resolves every id to
a name. Those requests are cached per project, keyed by workspace slug, for
`LOOKUP_CACHE_TTL_SECONDS`.

The TTL is short on purpose. Lookups change rarely, but someone who renames a state notices
immediately if the next report still shows the old name. Any caller can also force a refresh
(`--refresh` on the CLI), which re-fetches and overwrites the cached copy.

**With Redis** the cache is shared across instances and survives restarts. **Without it** the
cache is per process — fine for the CLI, but in a multi-instance deployment a forced refresh only
affects whichever instance served the request. Set `REDIS_URL` for anything deployed.

A Redis outage degrades rather than breaks: failed reads and writes are logged and treated as a
miss, so exports get slower — more requests against the rate limit — but keep working.

Module and cycle membership is cached separately and built **only when an export needs it**.
Neither is a field on a work item in Plane's API, so building that index costs one request per
module and per cycle. On a project with a dozen modules that is the difference between 6 requests
and 26 against a 60/minute budget, which is why it is not loaded unless the export selects those
columns or filters on them.

## Plane version compatibility

Plane's API is not uniform across versions, and the published documentation describes Plane Cloud,
which runs ahead of self-hosted releases.

Everything here was verified against **self-hosted Plane Community v1.3.0**, with the differences
recorded in [plane-api-findings.md](plane-api-findings.md). The exporter is written to degrade
rather than fail when an endpoint is absent — a project with no estimate scale, for example,
returns 404 for its estimates and simply gets a blank estimate column.

Check what you are running before trusting any assumption. Self-hosted instances expose this
without authentication:

```bash
curl https://plane.example.com/api/instances/
```

If you are on a materially different version and something breaks,
[plane-api-findings.md](plane-api-findings.md) §6.3 explains how to verify an endpoint's real
behaviour against Plane's source.

## Verifying your setup

```bash
npm test         # no network needed; the HTTP layer is mocked throughout
npm run typecheck
npm run build
```

Then confirm the token, URL and slug together by listing the projects it can see:

```bash
curl -H "X-API-Key: $PLANE_API_KEY" \
  "$PLANE_API_URL/workspaces/$PLANE_WORKSPACE_SLUG/projects/"
```

A 401 means the token or the slug is wrong. A list of projects means you are ready — and the
`identifier` field on each one is the short key you pass to `--project`.

## Running an export

```bash
npm run export -- --project ENG
```

See [exporting.md](exporting.md) for the CLI flags, the REST endpoints, and what the workbook
contains.
