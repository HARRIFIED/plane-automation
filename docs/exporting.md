# Running an export

Two ways in, same engine behind both: a CLI for local use, and a REST endpoint for the team.

## CLI

```bash
npm run export -- --project ENG
```

That is the common case — one project, every column, no filters. The file lands in the current
directory as `ENG-export-2026-08-14.xlsx`.

`--` is required: it tells npm to pass the flags to the script rather than eat them itself.

### Examples

```bash
# Unassigned work that is in progress
npm run export -- --project ENG --state-group started --assignee unassigned

# Weekly review: everything created or moved in the last 7 days
npm run export -- --project ENG --updated-from 7d

# What these three worked on this week
npm run export -- --project ENG --updated-from 7d --assignee victor,harrison,buchi

# Bugs raised since July, to a named file
npm run export -- --project ENG --label bug --created-from 2026-07-01 --out bugs.xlsx

# Just the columns you care about
npm run export -- --project ENG --columns identifier,name,state,assignees

# Completed last month, for a report
npm run export -- --project ENG --completed-from 2026-07-01 --completed-to 2026-07-31

# Work in no cycle — the backlog nobody has planned
npm run export -- --project ENG --cycle none

# Two projects, a tab each
npm run export -- --project ENG --project PLAT
```

`--help` lists every flag.

### Naming a project

`--project` accepts the project **key** (`ENG`), its **full name** (`Engineering`), or its UUID.
Case-insensitive. If it does not match, the error lists every project your token can see, which
usually makes the problem obvious:

```
Export failed: No project matches "ENGG". Projects visible to this API token:
ENG (Engineering), PLAT (Platform Infrastructure)
```

### Filters

Repeat a flag to OR its values; different flags are AND-ed. So

```bash
npm run export -- --project ENG --state Todo --state "In Progress" --priority urgent
```

means *(Todo OR In Progress) AND urgent*. Full field reference in [filters.md](filters.md).

### When a filter value does not exist

The CLI **stops** rather than handing you an empty spreadsheet:

```
Export failed: Filter refers to values that do not exist:
  - states: "In Progres" matched nothing in this project — did you mean In Progress?
```

An empty export caused by a typo is indistinguishable from a truthful "nothing matches", and
that is the worst outcome for something used for reporting. Pass `--warn-unmatched` to proceed
anyway; the problem is then recorded on the summary sheet instead.

### Exit codes

`0` success (including `--help`), `1` any failure. Safe to use in a script.

## REST

```bash
npm run start:dev
```

### GET — a shareable URL

```
GET /exports?project=ENG&stateGroup=started&assignee=unassigned
```

Returns the `.xlsx` as a download. Repeat a parameter to OR its values
(`&priority=urgent&priority=high`). Because it is a plain URL, a saved export is a bookmark.

Parameters: `project`, `state`, `stateGroup`, `assignee`, `label`, `module`, `cycle`,
`priority`, `updatedFrom`, `updatedTo`, `createdFrom`, `createdTo`, `completedFrom`,
`completedTo`, `search`, `columns` (comma separated), `refresh`.

Multi-value parameters accept either form, same as the CLI:
`?assignee=victor&assignee=harrison` or `?assignee=victor,harrison`.

The weekly report as a bookmarkable URL — relative dates mean it stays correct forever:

```
GET /exports?project=ENG&updatedFrom=7d
```

### POST — for anything programmatic

```bash
curl -X POST http://localhost:3000/exports \
  -H 'Content-Type: application/json' \
  -d '{
        "projects": ["ENG"],
        "filter": { "labels": ["bug"], "createdBetween": { "from": "2026-07-01" } },
        "columns": ["identifier", "name", "state", "assignees"]
      }' \
  -o bugs.xlsx
```

Both responses carry the counts as headers, so a caller can see what happened without opening
the file:

```
Content-Disposition: attachment; filename="ENG-export-2026-08-14.xlsx"
X-Export-Row-Count: 14
X-Export-Total-Before-Filter: 140
```

Unlike the CLI, unmatched filter values **warn** by default here rather than failing: a browser
download that 400s loses the work, while one that arrives with the problem on its summary sheet
does not. Send `"onUnmatchedFilter": "refuse"` for the CLI's behaviour.

### Other endpoints

- `GET /exports/schema` — the filter vocabulary: column names, state groups, priorities, and the
  absence tokens. Useful for building a UI on top.
- `GET /health` — confirms which Plane instance and workspace the service is pointed at, and
  whether it is using Redis or an in-memory cache. The API token is never included.

## What you get

**Summary tab, first.** Total count, breakdowns by state, priority and assignee, the filter
criteria in plain English, and when it was generated — so a spreadsheet forwarded by email still
explains itself a week later. Warnings appear here too.

**One tab per project**, named after the project. Tab names are truncated to Excel's 31
character limit and de-duplicated if two projects would collide.

Formatting: frozen bold header with the accent fill, auto-sized columns capped so a long
description cannot push everything off screen, priority and state colour-coded (state reuses
Plane's own colour, lightened for legibility on white), real dates rather than ISO strings,
assignees and labels as readable comma-separated cells, and the link column as a clickable
hyperlink.

## Speed and cost

A single-project export of ~800 items is roughly 30 requests against a 55/minute budget, so it
does not wait on the throttle. Re-running within the cache TTL is cheaper again, around 8.

Two things worth knowing:

- **A narrow filter is not a cheaper export.** The whole project is pulled and filtered locally,
  so cost tracks project size, not how much you asked for.
- **Module and cycle cost extra.** Neither is on the work item in Plane's API, so including
  either column — or filtering on them — adds one request per module and per cycle. Leave both
  out of `--columns` and you do not pay it.

## What is missing from every export

Plane's API does not return **archived**, **draft** or **triage** work items, and nothing in the
response signals their absence. If a project auto-archives completed work after N days, a
"completed this quarter" export will under-count. Every export says so on its summary sheet, so
a count that does not reconcile by hand has an explanation attached.
