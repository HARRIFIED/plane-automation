# Claude Code Brief: Plane Workspace Tooling

## Context

I run a product team at Sage Grey. We use Plane (plane.so) for project management. I want to build an internal service that solves two problems:

1. Only workspace admins can export tickets from the Plane UI, and the export has no useful filtering. My team needs self serve exports to Excel with real filters for reporting.
2. Engineers forget to move tickets when their work ships. I want ticket state changes driven by GitHub merges instead of memory.

Both features will live in the same service and share a Plane API client. **Build Phase 1 only for now.** Phase 2 is described at the bottom so you design the shared layer with it in mind. Do not implement Phase 2 until I tell you to.

## Stack

- Node.js, NestJS, TypeScript
- Deploy target is AWS ECS Fargate or any better cheaper alternative
- Postgres (TypeORM or Prisma, your call, tell me why)
- Redis for caching lookups or in-memory 
- SQS for webhook processing in Phase 2
- ExcelJS for spreadsheet generation, not SheetJS, because I want control over column widths, frozen header rows and cell formatting
- Jest for tests

## Before you write code

My knowledge of the Plane API may be out of date and the endpoint shapes have shifted between versions. Do not trust the details below blindly. Start by checking the current API reference at developers.plane.so and confirm:

- The auth header format
- The base URL and version prefix
- The exact issue list endpoint and its pagination model
- Whether server side filtering is supported and on which fields
- Whether there is a clean way to resolve a human readable identifier like PROJ-123 to an issue UUID
- Current rate limits

Report back what you found and flag anything that contradicts what I have written here before you start building. If you cannot reach the docs, say so and I will paste the relevant pages in.

## What I believe to be true, verify it

- Auth is a workspace scoped personal access token passed as `X-API-Key`, not a Bearer token
- Base URL is `https://api.plane.so/api/v1/`
- Resources are nested under `/workspaces/{workspace_slug}/projects/{project_id}/`
- Rate limit is somewhere around 60 requests per minute
- Issue list pagination is cursor based
- Issues return UUIDs for state, assignees, labels, modules and cycles rather than names
- `description_html` contains markup, `description_stripped` is the plain text version

## Phase 1: Excel exporter

### Behaviour

A service that pulls work items from one or more Plane projects, applies filters, and produces a formatted .xlsx file.

Expose it two ways:

- A REST endpoint that returns the generated file
- A CLI entry point so I can run exports locally without the service deployed

### Fetching strategy

Pull the full issue set for a project once per run and filter in memory. Do not make one request per filter combination. The rate limit is tight and most of our projects are under a few thousand items, so a single full pull is cheaper and more predictable than server side filtering that may or may not behave consistently.

Before fetching issues, load the lookup tables for the project (states, members, labels, modules, cycles) and build in memory maps. Every UUID in the output must be resolved to a human readable name. A spreadsheet full of UUIDs is useless. Cache these lookups in Redis with a short TTL, keyed by project, and let the caller force a refresh.

Handle cursor pagination properly. Follow the cursor until exhausted, and add a configurable safety cap on total pages so a bad response cannot loop forever.

Implement a request queue or throttle in the API client so we stay under the rate limit regardless of how many projects are being exported. Retry on 429 with exponential backoff and respect any Retry-After header.

### Filters

Support filtering by:

- State (by name, and by state group such as backlog, unstarted, started, completed, cancelled)
- Assignee
- Label
- Module
- Cycle
- Priority
- Created date range
- Completed date range
- Free text match on name and description

Filters should be composable. Multiple values within one filter are OR, different filters are AND. Support an explicit "unassigned" and "no cycle" option, since those are the ones people actually want to find.

Add named filter presets stored in Postgres so the team can save and reuse a filter set. This is the difference between a script I use and a tool the team uses.

### Output format

- Frozen header row, bold, with the accent colour on the header fill
- Auto sized columns with a sensible max width so long descriptions do not blow out the sheet
- Priority and state columns colour coded by conditional fill
- Dates formatted as readable dates, not ISO strings, and not raw epoch values
- Assignees and labels joined into readable comma separated cells
- A summary sheet as the first tab: total count, breakdown by state, by assignee, by priority, plus the filter criteria that produced the export and the timestamp it was generated
- Exporting multiple projects puts each project on its own tab

Columns: identifier, name, description (stripped), state, priority, assignees, labels, module, cycle, created at, updated at, started at, completed at, target date, estimate point, created by, link to the item in Plane.

Make the column set configurable so I can trim it per export.

### Structure

Separate the Plane API client from the export logic completely. The client is a NestJS module with typed methods and no knowledge of Excel. The exporter consumes it. Phase 2 will consume the same client to write state changes, so the client needs write methods stubbed out in the interface even if unimplemented for now.

Config comes from environment variables, validated at boot with a schema so the service fails fast on a missing token rather than at first request.

### Tests

Unit test the filter logic and the UUID resolution with fixtures. Mock the HTTP layer, do not hit the live API in tests. One integration test that runs against a real project behind an env flag is fine.

## Phase 2: GitHub merge driven state transitions

Do not build this yet. Design Phase 1 so this drops in cleanly.

### Behaviour

Two flows:

**Feature branch merged into `staging`.** Extract ticket identifiers from the branch name, PR title and PR body. Move each matching Plane work item to the Staging state.

**`staging` merged into `main`.** This PR usually has a release title and names no tickets. Resolve the ticket set by asking GitHub what is actually in the release: fetch the commits on the release PR and extract identifiers from all of them. That endpoint caps at 250 commits, so fall back to the compare API between the previous release tag and the merge commit for larger releases. Move every resolved ticket to Production.

Keep a local record of tickets promoted to Staging as a secondary source, but treat GitHub as the source of truth. Manual moves in the Plane UI will make a purely local record drift.

### Requirements

- Verify the GitHub webhook signature, HMAC SHA256 on `X-Hub-Signature-256`. The endpoint is public.
- Acknowledge the webhook immediately and push the payload to SQS. GitHub times out around ten seconds and the queue gives us retries for free. A worker does the actual Plane calls.
- Idempotency. Store the GitHub delivery ID and no op on redelivery. GitHub retries on timeout and I do not want tickets bouncing between states.
- Transitions only move forward. Encode the state order explicitly. If a stale branch merges to staging and its ticket is already in Production, ignore it.
- Every failure, whether an unresolved ticket ID or a failed transition, posts to Teams(which we currently use). A silent automation that quietly stopped working is worse than moving tickets by hand, because nobody notices for weeks.
- Structured logging on every transition: which PR, which ticket, from state, to state, outcome.
- A dry run mode that logs intended transitions without writing to Plane.

### Known problem

Resolving `PROJ-123` to an issue UUID may not have a clean single endpoint. Plan for a local index table mapping identifier to UUID, refreshed on a schedule and on cache miss. Confirm this against the docs first, since I would rather not build the index if the API handles it.

## How I want you to work

Work through Phase 1 in this order and check in with me at each step rather than building the whole thing in one pass:

1. Docs verification and findings report
2. Project scaffold, config validation, Plane API client with typed responses and throttling
3. Lookup resolution and caching
4. Filter engine with tests
5. Excel generation
6. REST endpoint and CLI
7. Filter presets

Keep the code readable over clever. Comment the non obvious parts, particularly anything where the Plane API behaves unexpectedly, so the next person does not have to rediscover it. Write a README and specs or documentation in docs/ as you go covering setup, env vars and how to run an export.

Ask me before pulling in a dependency that is not already listed here.