# plane-automation

Export [Plane](https://plane.so) work items to formatted Excel, with filters that actually work.

Plane restricts exports to workspace admins and gives you little control over what comes out.
This is a self-serve alternative: anyone with an API token can pull the work items they care
about, filtered how they want, as a spreadsheet that is ready to read rather than a wall of UUIDs.

Works with **Plane Cloud** and **self-hosted** Plane.

## What you get

- **Nine filter dimensions** — state, state group, assignee, label, module, cycle, priority, date
  ranges (created, updated, completed) and free text. Values within a filter are OR-ed, different
  filters are AND-ed. Explicit `unassigned` and `none` options, because those are what people
  actually go looking for.
- **Names, not UUIDs.** Every id is resolved — states, assignees, labels, modules, cycles,
  estimates — because a spreadsheet full of UUIDs is useless.
- **A workbook you can hand to someone.** Frozen bold header, auto-sized columns capped so a long
  description cannot blow out the sheet, priority and state colour-coded, real dates rather than
  ISO strings, clickable links, and a summary tab carrying the filter criteria and totals so the
  file still explains itself a week later.
- **Two ways in** — a CLI for local use and a REST endpoint for a team, sharing one engine.
- **Polite to the API** — a throttle matching Plane's own sliding window, retry with jittered
  backoff, `Retry-After` honoured, and lookups cached so repeat exports are cheap.

## Quick start

```bash
npm install
cp .env.example .env    # fill in PLANE_API_URL, PLANE_APP_URL, PLANE_API_KEY, PLANE_WORKSPACE_SLUG

npm run export -- --project ENG    # export a project to .xlsx
npm run start:dev                  # or run the service
```

Get an API token from Plane → Workspace Settings → API tokens. It is workspace scoped, and an
export only ever sees what that token's owner can see.

Configuration is validated at boot, so a missing or malformed value stops the process with every
problem listed at once rather than surfacing as a confusing 401 on your first export.

Full instructions, including how to find your workspace slug: **[docs/setup.md](docs/setup.md)**.

## Examples

```bash
# This week's movement — anything created or moved in the last 7 days
npm run export -- --project ENG --updated-from 7d

# What three people worked on this week
npm run export -- --project ENG --updated-from 7d --assignee ada,grace,linus

# Unassigned work that is in progress
npm run export -- --project ENG --state-group started --assignee unassigned

# Bugs raised since July, trimmed to the columns you care about
npm run export -- --project ENG --label bug --created-from 2026-07-01 \
  --columns identifier,name,state,assignees

# Two projects, a tab each
npm run export -- --project ENG --project PLAT
```

As a URL, for the same thing over HTTP:

```
GET /exports?project=ENG&updatedFrom=7d&assignee=ada&assignee=grace
```

More in **[docs/exporting.md](docs/exporting.md)** and **[docs/filters.md](docs/filters.md)**.

## Documentation

| | |
| --- | --- |
| [setup.md](docs/setup.md) | Requirements, environment variables, rate limits, caching |
| [exporting.md](docs/exporting.md) | CLI flags, REST endpoints, what the workbook contains |
| [filters.md](docs/filters.md) | Every filter field and how they compose |
| [plane-api-findings.md](docs/plane-api-findings.md) | How Plane's API actually behaves, where it differs from its docs, and why this codebase is shaped the way it is |

That last one is worth reading before changing anything in `src/plane/`. Plane's API has several
behaviours that are not in the published documentation and will cost you an afternoon each.

## Two things to know before you rely on it

**Archived, draft and triage work items are never returned by Plane's API**, and nothing in the
response signals their absence. If your projects auto-archive completed work, a "completed this
quarter" export will under-count. Every export states this on its summary sheet so a count that
does not reconcile has an explanation attached.

**A narrower filter is not a cheaper export.** The whole project is pulled once and filtered in
memory, so cost tracks project size rather than how much you asked for. That is deliberate: it
keeps behaviour predictable under a tight rate limit, and ten different filters over one project
cost one pull rather than ten.

## Layout

```
src/
  config/            Environment schema and typed access. Validated once, at boot.
  cache/             Redis when REDIS_URL is set, in-memory otherwise. Same interface either way.
  plane/             Plane API client — typed, throttled, and completely unaware of Excel.
    http/            Rate limiter and retry policy
    types/           Response shapes, modelled on Plane's serializers
    pagination.ts    Cursor following, deduplication, count reconciliation
  lookup/            UUID → name resolution, cached per project
    project-lookups.ts   Indexed view: UUIDs to names, and names back to UUIDs for filters
    lookup.service.ts    Loading, caching, forced refresh, request coalescing
  filter/            Composable filters. Pure functions — no API calls, no I/O.
    filter-resolver.ts   Names and dates in, ids and timestamps out, typos reported
    filter-engine.ts     Applies a resolved filter to work items
  export/            Orchestration and the workbook
    export.service.ts    Resolve projects → lookups → pull → filter → write
    columns.ts           The configurable column set
    export-row.ts        Work item → displayable values (all UUIDs already resolved)
    workbook-builder.ts  ExcelJS: summary sheet, per-project tabs, formatting
  http/              REST controllers
  cli/               Local entry point
  util/              html-to-text, because the API does not expose description_stripped
```

The Plane client is deliberately isolated from the export logic: it returns Plane's shapes and
knows nothing about spreadsheets. Its write methods are declared but unimplemented, so a future
feature that moves work items between states consumes the same client rather than reshaping it.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run export -- --project ENG` | Export to .xlsx from the command line (`--help` for flags) |
| `npm run start:dev` | Run the service with watch mode |
| `npm run build` | Compile to `dist/` |
| `npm run start:prod` | Run the compiled build |
| `npm test` | Unit tests — no network access required |
| `npm run test:cov` | Unit tests with coverage |
| `npm run typecheck` | Types only, no emit |

Built with Node.js 20.11+, NestJS, TypeScript and ExcelJS. Tests mock the HTTP layer throughout,
so `npm test` never touches a live Plane instance.

## Status

The exporter is complete and in use. Saved filter presets, backed by Postgres, are the next
planned addition — `DATABASE_URL` is reserved for them and unused today.

Issues and pull requests welcome. If you hit an API behaviour that differs from what
[plane-api-findings.md](docs/plane-api-findings.md) records, that document is the place to fix
first — it explains §6.3 how to verify an endpoint against Plane's own source.

## Licence

MIT — see [LICENSE](LICENSE).
