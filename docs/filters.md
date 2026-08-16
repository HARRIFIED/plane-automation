# Filters

How filtering works, what each field accepts, and the two rules that govern how they combine.

## The two rules

**Values within one field are OR'd. Different fields are AND'd.**

```json
{ "states": ["Todo", "In Progress"], "priorities": ["urgent"] }
```

reads as *(Todo OR In Progress) AND urgent*. A field you leave out is not a constraint at all,
so an empty filter exports everything.

On the CLI, a list is either a repeated flag or comma-separated — these are identical:

```bash
--assignee victor --assignee harrison --assignee buchi
--assignee victor,harrison,buchi
```

Both mean *any of the three*, which is what you want for "narrow this to the work these people
touched". Note the consequence of comma-splitting: a state or label whose name genuinely
contains a comma cannot be filtered this way. Rare enough to accept, and the unmatched-value
guard catches it with a suggestion rather than silently returning nothing.

## Filtering happens in memory

The service pulls a project's full work item set, then filters locally. Two consequences worth
knowing:

- **A narrower filter is not a cheaper export.** Cost tracks project size, not how much you
  asked for.
- **Ten filter combinations over one project cost one pull**, not ten, as long as they run
  inside the lookup cache window.

## Fields

| Field | Accepts | Notes |
| --- | --- | --- |
| `states` | State names | Case-insensitive. "in progress" matches "In Progress" |
| `stateGroups` | `backlog` `unstarted` `started` `completed` `cancelled` | OR'd with `states` — both select states |
| `assignees` | Email, @handle, full name, or first name | `unassigned` selects work with no assignee |
| `labels` | Label names | `none` selects unlabelled work |
| `modules` | Module names | `none` selects work in no module |
| `cycles` | Cycle names | `none` selects work in no cycle |
| `priorities` | `urgent` `high` `medium` `low` `none` | Case-insensitive |
| `updatedBetween` | `{ from, to }` | Last modified. Covers created **and** moved — see below |
| `createdBetween` | `{ from, to }` | Inclusive. See dates below |
| `completedBetween` | `{ from, to }` | Inclusive. Never-completed work is excluded |
| `search` | Any text | Case-insensitive substring of the name or the description |
| `excludeStates` | State names | Dropped after the filters above — see below |
| `excludeKeywords` | Any text | Drops items whose name or description contains it |

### The absence sentinels

`unassigned` and `none` are the ones people actually reach for — "what has nobody picked up",
"what is not in a sprint".

They combine rather than override: `assignees: ["unassigned", "ada"]` means *unassigned OR
Ada's*, not one or the other.

**A real entity always wins.** If your project has a label genuinely named "none", then
`labels: ["none"]` filters to that label. The sentinel only applies when nothing matched. Use
`null` for the absence meaning if you are ever in that position.

### `updatedBetween` — the one for weekly reports

For "what moved this week", use `updatedBetween`, not `createdBetween`. Plane sets `updated_at`
when a work item is created **and** bumps it on every subsequent change, so a single filter
answers both halves of "created or moved this week" — no need to OR two date ranges.

```bash
npm run export -- --project ENG --updated-from 7d
```

A ticket filed in March and moved to Done in August appears in August's export, not March's,
which is what a weekly review wants. A ticket that has sat untouched since it was filed drops
out. Filtering on `createdBetween` instead would miss the first case entirely.

### Dates

All ranges are inclusive at both ends. A date-only bound covers the whole day, so
`{ "from": "2026-07-01", "to": "2026-07-31" }` includes work created at 16:30 on the 31st.
A full ISO timestamp is used exactly as given.

**Relative bounds** — `7d`, `2w` — mean N days or weeks ago, snapped to the start of that day
(so a scheduled export is not affected by the hour it happens to run). They exist for recurring
exports: `--updated-from 7d` means the same thing every week, so a weekly job never needs
editing. The summary sheet renders them in words: *"Updated in the last 7 days"*.

Bounds are interpreted in **UTC**, matching the timestamps Plane returns. For a team an hour or
two off UTC, late-evening work can land on the following day. If that starts to matter, a
configurable export timezone goes in `filter-resolver.ts`, which is the only place that parses
a bound.

`completedBetween` doubles as "only finished work": an item that was never completed has no
completion date, so it cannot fall inside a range.

### Exclusions

Exclusions run **after** the inclusive filters and always win. That makes "everything in
progress, except Blocked" one filter plus one exclusion, rather than an exercise in listing every
state you do want:

```bash
npm run export -- --project ENG --state-group started --exclude-state Blocked
```

**`--exclude-keyword` is for machine-generated noise.** If an AI code reviewer opens tickets that
all carry a marker like "Detected by AI", one flag keeps them out of a human progress report:

```bash
npm run export -- --project ENG --exclude-keyword "Detected by AI"
```

It matches the name and the stripped description, case-insensitively. Repeat the flag for several
keywords — an item matching **any** of them is dropped. Unlike the other list flags, keywords are
**not** comma-split, because an excluded phrase can legitimately contain a comma and there is no
lookup table to catch the mistake.

A mistyped `--exclude-state` is reported like any other unmatched value. That matters more than it
sounds: excluding a state that does not exist excludes nothing, silently, and the export just
looks slightly too long.

### Search

Matches the work item name and the description, case-insensitively. The description is stripped
of its markup first, so searching for "strong" will not match `<strong>` — and searching for a
word that only appears in the description body does match.

## Typos do not fail silently

A mistyped value is the dangerous case in a reporting tool: `states: ["In Progres"]` would match
nothing and return an empty export, which looks identical to a truthful "no work matches".

So resolution never silently drops a value. Anything that matches nothing is collected, with
suggestions drawn from the project's real data:

```
Filter refers to values that do not exist:
  - states: "Progress" matched nothing in this project — did you mean In Progress?
```

Callers choose what to do with that: `assertNoUnmatched()` turns it into a hard error, or the
list can be surfaced as a warning on the export's summary sheet.

## Module and cycle cost extra

Neither is a field on a work item, so filtering by them needs a membership index built from one
request per module and per cycle. `filterNeedsMembership()` reports whether a given filter needs
it, and the index is only loaded when it does — a filter that never mentions modules or cycles
costs nothing extra.

Passing a module or cycle filter without the index throws rather than returning nothing, because
an empty result there would be indistinguishable from "no work in that module".
