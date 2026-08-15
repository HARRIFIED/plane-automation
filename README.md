# plane-automation

Internal Plane workspace tooling for the Sage Grey product team.

**Phase 1 — Excel exporter.** Self-serve work item exports with real filters, as a formatted
`.xlsx`. Available both as a REST endpoint and a local CLI, so a report does not require a
workspace admin.

**Phase 2 — GitHub merge driven state transitions.** Not built yet. Work items move to Staging
and Production off merge events rather than off somebody remembering. The Plane client is
designed with it in mind: the write methods are declared on the interface and throw until
Phase 2 lands.


## Quick start

```bash
npm install
cp .env.example .env    # then fill in PLANE_API_KEY and PLANE_WORKSPACE_SLUG

npm run export -- --project ENG    # export a project to .xlsx, locally
npm run start:dev                  # or run the service
```

Get an API token from Plane → Workspace Settings → API tokens. It is workspace scoped, and an
export only ever sees what that token's owner can see.

Configuration is validated at boot, so a missing or malformed value stops the process with every
problem listed at once rather than surfacing as a confusing 401 on the first export.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run export -- --project ENG` | Export to .xlsx from the command line (`--help` for flags) |
| `npm run start:dev` | Run the service with watch mode |
| `npm run build` | Compile to `dist/` |
| `npm start:prod` | Run the compiled build |
| `npm test` | Unit tests |
| `npm run test:cov` | Unit tests with coverage |
| `npm run typecheck` | Types only, no emit |

## Layout

```
src/
  config/            Environment schema and typed access. Validated once, at boot.
  cache/             Redis when REDIS_URL is set, in-memory otherwise. Same interface either way.
  plane/             Plane API client — typed, throttled, and completely unaware of Excel.
    http/            Rate limiter and retry policy
    types/           Response shapes, modelled on v1.3.0 serializers
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
docs/
  plane-api-findings.md   What the API actually does on our version, and where it differs
                          from the published docs
```

The client is deliberately isolated from the export logic. It returns Plane's shapes and knows
nothing about spreadsheets; Phase 2 consumes the same client to write state changes.

## Build order

1. ~~Docs verification and findings report~~
2. ~~Project scaffold, config validation, Plane API client with typed responses and throttling~~
3. ~~Lookup resolution and caching~~
4. ~~Filter engine with tests~~
5. ~~Excel generation~~
6. ~~REST endpoint and CLI~~
7. Filter presets — the only step left
