# Plane API — verification findings

Date checked: 2026-08-09
Sources: [developers.plane.so](https://developers.plane.so/api-reference/introduction) for the
documented contract, and the `makeplane/plane` source at `apps/api/plane/api/**` for the places where
the reference docs are thin or auto-generated with placeholder examples.

## Target instance — read this first

We are **not** on Plane Cloud. `https://plane.sagegreytech.com/api/instances/` reports:

```json
{ "instance_name": "SageGrey Technologies", "current_version": "1.3.0",
  "latest_version": "v1.3.1", "edition": "PLANE_COMMUNITY", "is_self_managed": true }
```

Self-managed Community edition on **v1.3.0**. Consequences that run through this whole document:

- **Base URL is `https://plane.sagegreytech.com/api/v1/`**, not `api.plane.so`. Env var, never hardcoded.
- The public docs describe Plane Cloud, which is ahead of 1.3.0. Everything below has been
  re-verified against the **`v1.3.0` git tag**, and where the tag disagrees with the docs, the tag wins.
- The rate limit is ours to set (§6.1), and upgrades are ours to schedule. Pinning behaviour to a
  version we control is a genuine advantage over Cloud — nothing shifts under us unannounced.
- One live authenticated call should still confirm §3.1 and §3.5 once we have a token; a self-managed
  instance can carry local patches that no tag reflects.

---

## 1. Confirmed — the brief was right

| Claim in brief | Verdict |
| --- | --- |
| Auth is `X-API-Key`, not Bearer | **Confirmed.** `X-API-Key: <token>` on every request. Bearer is only for OAuth access tokens, which we are not using. |
| Base URL `https://api.plane.so/api/v1/` | **Confirmed.** |
| Nested under `/workspaces/{workspace_slug}/projects/{project_id}/` | **Confirmed.** `project_id` is a UUID in the path, not the `PROJ` key. |
| Rate limit ~60 req/min | **Confirmed as the default**, and on 1.3.0 it is an env var we control — see §6.1. Scoped **per API key** (`ApiKeyRateThrottle`, cache key = the key itself). Responses carry `X-RateLimit-Remaining` and `X-RateLimit-Reset` (unix seconds). |
| Cursor pagination on the issue list | **Confirmed, with a caveat — see §3.1.** |
| UUIDs, not names, for state/assignees/labels | **Confirmed for state, assignees, labels.** Modules and cycles are a different story — see §2.2. |
| `description_html` contains markup | **Confirmed.** |

### Response envelope (list endpoints)

```json
{
  "grouped_by": null, "sub_grouped_by": null,
  "total_count": 150, "count": 20,
  "next_cursor": "20:1:0", "prev_cursor": "20:0:0",
  "next_page_results": true, "prev_page_results": false,
  "total_pages": 8, "total_results": 150,
  "extra_stats": null,
  "results": [ ... ]
}
```

`per_page` default 20, **max 100**. Follow `next_cursor` while `next_page_results` is true.

---

## 2. Contradictions — things in the brief that do not hold

### 2.1 `description_stripped` is NOT returned  ⚠️

The brief assumes `description_stripped` is available as the plain-text column. It is a real column on
the `Issue` model, but the API serializer explicitly excludes it (source-confirmed):

```python
class Meta:
    model = Issue
    exclude = ["description_json", "description_stripped"]
```

So the payload gives us `description_html` only. **We have to strip the HTML ourselves** for the
description column. See §5 for the dependency question this raises.

### 2.2 Module and cycle are NOT on the work item payload  ⚠️

The brief's column list and filter list both include module and cycle. Neither is a field on the work
item response. The list view annotates `cycle_id` in SQL, but it is an annotation and the serializer
is model-field-based, so it does not reach the JSON.

Membership has to be read from the reverse direction:

- `GET /workspaces/{slug}/projects/{project_id}/modules/{module_id}/module-issues/` → paginated **full**
  work items belonging to that module
- `GET /workspaces/{slug}/projects/{project_id}/cycles/{cycle_id}/cycle-issues/`

Cost: one request per 100 members, per module, per cycle. A project with 12 modules and 8 cycles costs
20+ extra requests against a 60/min budget on top of the issue pull. Mitigations I plan to use:

- Pass `fields=id` so those calls return `[{"id": ...}]` and nothing else, plus `per_page=100`.
- Build the membership maps **lazily** — only when the export actually selects the module/cycle column
  or filters on them. Cache alongside the other lookups in Redis.
- Note that an item can be in multiple modules but the data model gives it at most one cycle.

### 2.3 Server-side filtering exists on Cloud — but not on our version, and not as a bulk tool

The brief assumes filtering is unreliable/absent and mandates fetch-everything-then-filter-in-memory.
Plane Cloud now has a real filter endpoint:

`POST /api/v1/workspaces/{workspace_slug}/work-items/advanced-search/`

Body: `{ query, filters, limit, workspace_search, project_id }`, where `filters` is a JSON grammar with
`and`/`or`/`not` over `state_id__in`, `state_group__in`, `cycle_id__in`, `module_id__in`,
`assignee_id__in`, `label_id__in`, `priority__in`, `created_by_id__in`, `created_at__gte/lte`,
`start_date`, `target_date`, `is_archived`, `type_id__in`.

**It does not exist on v1.3.0.** No `advanced-search/` route is registered in the v1.3.0 URL conf — only
`work-items/search/`, which is a name/sequence-id text search that takes a `limit` and returns six
fields. So the question is moot for us today, but it is worth knowing for two reasons: it is the
strongest argument for eventually upgrading, and it changes nothing about the design because even on
Cloud it fails as an export mechanism:

1. It takes a `limit`, not a cursor — there is no documented way to page through a complete result set.
2. It returns a trimmed row (`id`, `name`, `sequence_id`, `project_identifier`, `state_id`, `priority`,
   `start_date`, `target_date`) — no description, assignees, labels, or timestamps. We would have to
   re-fetch each item anyway.

Also worth knowing: Plane staff have acknowledged on the forum that the `filters` grammar is
**undocumented** ("The filters documentation is indeed missing examples — we're aware"). Building the
exporter on an undocumented body schema would be the wrong trade.

**Recommendation: keep your full-pull-and-filter-in-memory plan.** It is the right call, for better
reasons than the brief gives — on our version it is the only call. I will leave an unimplemented
`advancedSearch` method on the client interface so a future upgrade is a one-file change.

### 2.4 The Phase 2 "known problem" is solved — no local index table needed  ✅

Verified present in v1.3.0. The brief plans a local `identifier → UUID` index table. There is a
first-class endpoint:

```
GET /api/v1/workspaces/{workspace_slug}/work-items/{project_identifier}-{issue_identifier}/
curl "https://api.plane.so/api/v1/workspaces/my-workspace/work-items/PROJ-123/" -H "X-API-Key: $KEY"
```

Note it is workspace-scoped, not project-scoped — you do not need to know the project UUID to resolve
`PROJ-123`. Returns the full work item, `id` being the UUID. Source-confirmed: the route is
`workspaces/<slug>/work-items/<str:project_identifier>-<str:issue_identifier>/` and the view filters on
`project__identifier` + `sequence_id`.

For Phase 2 this means one cheap GET per ticket instead of a scheduled index table. Worth caching in
Redis (identifier → UUID is immutable), but the Postgres index table can be dropped from the design.

---

## 3. Things the brief did not anticipate

### 3.1 The "cursor" is really an offset  ⚠️

Cursor format is `{page_size}:{offset}:{is_prev}` — e.g. `100:3:0` means "100 per page, page index 3".
It is offset pagination with a cursor-shaped string, **not** a stable snapshot. If somebody creates or
deletes a work item mid-export, later pages shift and we can silently skip or duplicate rows.

Mitigations for the client:

- Page with an explicit stable `order_by` (`sequence_id`) rather than the default `-created_at`.
- Deduplicate by `id` while accumulating.
- Compare the accumulated count against `total_count` from the first page and warn on mismatch.
- Keep the configurable max-page safety cap the brief asked for.

### 3.2 The list endpoint silently excludes several categories of work item

The default manager excludes: **triage-state items, archived items, draft items, and every item in an
archived project** (source-confirmed). Nothing in the response signals this, so an export can look
short with no explanation. There are separate `archived-cycles`/`archived-modules` routes but no
archived-work-item list in the public API. I will note the exclusion on the summary sheet so nobody
reconciles a count by hand and concludes the tool is broken.

### 3.3 `expand` is cheap and worth using

`?expand=state,assignees,labels,created_by` inlines those objects instead of UUIDs. That would let us
skip some lookup resolution — but I still plan to build the lookup maps, because:

- `expand` does not cover modules or cycles, so we need maps regardless;
- expanded assignees/labels re-query per row (the serializer does an N+1 on purpose), which inflates
  response time on the large pulls;
- filtering by state group needs the full state table anyway, including states with zero items.

Planned use: `expand=state` only (it is a cheap join and gives us `group` inline for free), everything
else resolved from cached maps.

### 3.4 `fields` param trims the payload

`?fields=id,name,state` restricts the serialized fields. Directly useful for the membership calls in
§2.2 and for the configurable-column-set feature.

### 3.5 Assignees/labels shape

Both come back as **arrays of UUID strings** by default. Empty array, never null, for unassigned — so
the "unassigned" and "no cycle" filters are `length === 0` and `cycle_id == null` respectively.

### 3.6 State groups are a fixed set

`backlog`, `unstarted`, `started`, `completed`, `cancelled` — plus `triage`, which never appears in
list results (§3.2). Safe to type as a union.

### 3.7 The estimate endpoints break every convention in this API  ⚠️

Found the hard way, on a real project. Three separate deviations, all confirmed in
`apps/api/plane/api/views/estimate.py` at v1.3.0:

1. **`GET /projects/{id}/estimates/` returns a single object, not a paginated envelope.** The
   view is `estimate = self.get_queryset().first()` followed by a plain serializer response. A
   project can only have one estimate scale — creating a second returns 409 — so there is no
   list to page.
2. **It returns 404 when the project has no estimate configured.** `{"error": "Estimate not
   found"}`. This is the normal state for most projects, not a failure, and it must be treated
   as "no estimates" rather than propagated.
3. **`GET /estimates/{estimate_id}/estimate-points/` returns a bare array**, like `/members/`.
   It also 404s if the estimate id does not resolve.

The consequence for us: the estimate column is the only one sourced from an optional table, so
its lookup degrades to empty rather than failing the export. Everything else — states, members,
labels — would put wrong names in every row if it were missing, so those stay fatal.

### 3.8 `/issues/` and `/work-items/` are both live

Every route is registered under both prefixes; `work-items` is the current naming and `issues` is the
legacy alias. I will use `work-items` throughout.

---

## 4. Endpoint map for Phase 1

All paths prefixed `https://plane.sagegreytech.com/api/v1/`. Every route below is confirmed present in
the v1.3.0 URL conf.

| Purpose | Method + path |
| --- | --- |
| Projects | `GET workspaces/{slug}/projects/` |
| Work items (bulk pull) | `GET workspaces/{slug}/projects/{project_id}/work-items/?per_page=100&expand=state&order_by=sequence_id` |
| Work item by UUID | `GET workspaces/{slug}/projects/{project_id}/work-items/{id}/` |
| Work item by identifier | `GET workspaces/{slug}/work-items/PROJ-123/` |
| States | `GET workspaces/{slug}/projects/{project_id}/states/` |
| Members | `GET workspaces/{slug}/projects/{project_id}/members/` |
| Labels | `GET workspaces/{slug}/projects/{project_id}/labels/` |
| Modules | `GET workspaces/{slug}/projects/{project_id}/modules/` |
| Module membership | `GET .../modules/{module_id}/module-issues/?fields=id&per_page=100` |
| Cycles | `GET workspaces/{slug}/projects/{project_id}/cycles/` |
| Cycle membership | `GET .../cycles/{cycle_id}/cycle-issues/?fields=id&per_page=100` |
| Text search | `GET workspaces/{slug}/work-items/search/?search=…&limit=…` |
| Update work item (Phase 2 write) | `PATCH workspaces/{slug}/projects/{project_id}/work-items/{id}/` |

**Not available on 1.3.0:** the `*-lite` lookup variants (`modules-lite`, `cycles-lite`,
`project-members-lite`, `members-lite`) landed in v1.4.0, and `work-items/advanced-search/` is Cloud
only. The full-fat lookup endpoints are fine for our purposes — a project has tens of states, labels
and modules, not thousands.

`/issues/` and `/work-items/` are both registered in 1.3.0 and hit the same views; `work-items` is the
current naming, so the client uses it throughout.

---

## 6. Self-hosting notes

### 6.1 The rate limit is a config value we own

In v1.3.0 the throttle reads `rate = os.environ.get("API_KEY_RATE_LIMIT", "60/minute")` on the API
container. Two things follow:

- 60/min is the default, but our instance may already be set differently, and we can raise it if the
  exporter turns out to be throughput-bound. Worth checking the API container's environment.
- The client must therefore treat the limit as **configured, not assumed**: drive the throttle from a
  `PLANE_RATE_LIMIT_PER_MINUTE` env var defaulting to 60, and still handle 429 with `Retry-After`
  regardless of what the config says. Never hardcode 60.

There is also a `ServiceTokenRateThrottle` at a fixed 300/minute, applied when the API token row has
`is_service = True`. That flag is not settable from the UI — it is for Plane's own internal services —
so treat it as unavailable unless we want to set it directly in the database, which I would not
recommend.

### 6.2 429 handling

DRF's `SimpleRateThrottle` returns 429 with a `Retry-After` header derived from the throttle window,
so the brief's requirement to respect `Retry-After` is exactly right and will work as expected.

### 6.3 Version drift

Every finding here is pinned to v1.3.0. Upgrading — even to 1.3.1 — is worth a re-read of this
document, particularly §2.1, §2.2 and §4. The `*-lite` endpoints in 1.4.0 and Cloud's advanced search
would both simplify code we are about to write.

## 5. Decisions

1. **HTML stripping — hand-rolled, no new dependency.** `description_stripped` is not exposed (§2.1),
   so we convert `description_html` ourselves: strip tags, decode entities, collapse whitespace.
   Roughly 25 lines, unit tested against fixtures taken from real descriptions. Revisit only if we hit
   markup the simple version mangles.
2. **Deployment — self-hosted, v1.3.0.** See the target-instance section at the top.
   `PLANE_API_URL=https://plane.sagegreytech.com/api/v1` and
   `PLANE_APP_URL=https://plane.sagegreytech.com`; the item link column is
   `{PLANE_APP_URL}/{workspace_slug}/projects/{project_id}/issues/{issue_id}`.
3. **Archived items — open, see below.**
4. **ORM — Prisma.** The schema is small (presets now; Phase 2 delivery IDs and promotion records
   later), the generated types are stronger than TypeORM's decorator inference, and the migration
   story is less error-prone. TypeORM's deeper Nest integration buys nothing at four tables.

### Still open: what "archived" should mean for an export

The v1.3.0 list endpoint's default manager silently drops four categories (§3.2): work items
**archived** (Plane can auto-archive items that have sat in a completed or cancelled state for N days,
if the project enables it), items in the **triage** inbox, **drafts**, and everything inside an
**archived project**. There is no public endpoint that lists archived work items, so this is a hard
limit of the API rather than a choice in our code.

For a reporting tool the archived ones are the category that could actually distort a number — a
"completed this quarter" export will under-count if the project auto-archives after 30 days. My plan
is to state the exclusion explicitly on the summary sheet so a mismatch is self-explaining. Confirm
whether your projects have auto-archive enabled; if they do and the gap matters, the fallback is
reading the archive out of the database directly, which I would rather avoid.
