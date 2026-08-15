# Setup

## Requirements

- Node.js 20.11 or newer (the client uses the built-in `fetch` and `AbortSignal.timeout`)
- Access to `https://plane.sagegreytech.com` and a Plane API token
- Postgres — not needed until step 7 (filter presets)
- Redis — not needed until step 3 (lookup caching); falls back to in-memory when unset

## Install

```bash
npm install
cp .env.example .env
```

## Getting an API token

Plane → Workspace Settings → API tokens → **Add API token**. Copy it immediately; Plane shows it
once.

Two things to know about the token:

- It is **workspace scoped** and sent as the `X-API-Key` header, not as a bearer token.
- It carries **its owner's permissions**. An export run with your token sees the projects you are
  a member of and nothing else. For a shared service token, use an account that is a member of
  every project people will want to export.

## Environment variables

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `NODE_ENV` | no | `development` | `development` \| `test` \| `production` |
| `PORT` | no | `3000` | |
| `PLANE_API_URL` | **yes** | — | Include the version prefix: `https://plane.sagegreytech.com/api/v1` |
| `PLANE_APP_URL` | **yes** | — | Web app root, used for the spreadsheet's link column |
| `PLANE_API_KEY` | **yes** | — | Workspace scoped token |
| `PLANE_WORKSPACE_SLUG` | **yes** | — | As it appears in the Plane URL |
| `PLANE_RATE_LIMIT_PER_MINUTE` | no | `55` | Keep below the server's limit — see below |
| `PLANE_PAGE_SIZE` | no | `100` | Plane caps this at 100 and ignores larger values |
| `PLANE_MAX_PAGES` | no | `500` | Safety cap per list call |
| `PLANE_REQUEST_TIMEOUT_MS` | no | `30000` | |
| `PLANE_MAX_RETRIES` | no | `4` | Retries after the initial attempt |
| `PLANE_RETRY_BASE_MS` | no | `500` | First backoff; doubles with full jitter |
| `LOOKUP_CACHE_TTL_SECONDS` | no | `300` | How long lookup tables stay cached |
| `REDIS_URL` | no | — | Lookup cache; falls back to in-memory when unset |
| `DATABASE_URL` | from step 7 | — | Postgres, for filter presets |

Validation runs at boot via a Zod schema. A missing or malformed value stops the process and
prints every problem at once.

## About the rate limit

Plane throttles **per API key**, and on self-hosted the limit is ours to set: it comes from the
API container's own `API_KEY_RATE_LIMIT` environment variable and defaults to `60/minute`.

`PLANE_RATE_LIMIT_PER_MINUTE` is the client's mirror of that value, defaulted to 55 to leave
headroom for anything else using the same token. Two rules:

1. Keep it **below** the server's value. If you raise the server's limit, raise this one after.
2. It is enforced **per process**. Two containers sharing one token will each assume the full
   budget. Only one process runs exports today; if that changes, the limiter needs to move to a
   shared Redis token bucket (`src/plane/http/rate-limiter.ts`).

The client also watches the `X-RateLimit-Remaining` and `X-RateLimit-Reset` response headers, and
stalls until the window resets if the server says the budget is gone. On a 429 it honours
`Retry-After` and applies it to every in-flight request, not just the rejected one.

## The lookup cache

A spreadsheet full of UUIDs is useless, so before fetching work items the service loads a
project's states, labels, members, modules and cycles and resolves every id to a name. Those
five requests are cached per project, keyed by workspace slug, for `LOOKUP_CACHE_TTL_SECONDS`.

The TTL is short on purpose. Lookups change rarely, but when someone renames a state they
notice immediately if the next report still shows the old name. Any caller can also force a
refresh, which re-fetches and overwrites the cached copy.

**With Redis** the cache is shared across instances and survives restarts. **Without it** the
cache is per process: fine for the CLI, but in a multi-instance deployment a forced refresh
would only affect whichever instance served the request. Set `REDIS_URL` for anything deployed.

A Redis outage degrades rather than breaks. Reads and writes that fail are logged and treated
as a miss, so exports get slower — more requests against the rate limit — but keep working.

Module and cycle membership is cached separately and built **only when an export needs it**.
Neither is a field on a work item, so building the index costs one request per module and per
cycle. On a project with a dozen modules that is the difference between 5 requests and 25
against a 60/minute budget, which is why it is not loaded by default.

## Verifying your setup

```bash
npm test           # no network access needed; the HTTP layer is mocked throughout
npm run typecheck
npm run build
```

To confirm the token and URL against the live instance, this returns your instance's version
without needing authentication:

```bash
curl https://plane.sagegreytech.com/api/instances/
```

## Running an export

```bash
npm run export -- --project ENG
```

See [exporting.md](exporting.md) for the CLI flags, the REST endpoints, and what the workbook
contains.
