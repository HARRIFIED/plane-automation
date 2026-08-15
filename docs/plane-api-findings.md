# Plane API — field notes

What Plane's REST API actually does, where it differs from its published documentation, and the
design decisions those differences force on anything built against it.

Written while building this exporter, but most of it is useful to anyone integrating with Plane.

**Sources:** [developers.plane.so](https://developers.plane.so/api-reference/introduction) for the
documented contract, and the `makeplane/plane` source under `apps/api/plane/api/**` for everywhere
the reference is thin or auto-generated with placeholder examples.

**Last verified:** 2026-08-09 against the `v1.3.0` tag.

## Which version this describes — read this first

**Verified against self-hosted Plane Community v1.3.0**, by reading the `v1.3.0` git tag of
`makeplane/plane` rather than trusting the published reference alone.

That distinction matters more than it sounds. The documentation at developers.plane.so describes
**Plane Cloud**, which runs ahead of self-hosted releases, so several documented endpoints do not
exist on 1.3.0 and several undocumented behaviours do. Where the tag disagrees with the docs
below, the tag wins.

Check what you are running before trusting any of this. Self-hosted instances report it without
authentication:

```bash
curl https://your-plane-host/api/instances/
```

```json
{ "current_version": "1.3.0", "edition": "PLANE_COMMUNITY", "is_self_managed": true }
```

If you are on a different version, §6.3 explains how to verify an endpoint's real behaviour
against Plane's source in a couple of minutes. A self-managed instance can also carry local
patches that no tag reflects, so one live authenticated call is still worth making — §3.1 and
§3.5 are the two most worth confirming.

---

## 1. Confirmed — these hold as documented

| Claim | Verdict |
| --- | --- |
| Auth is `X-API-Key`, not Bearer | **Confirmed.** `X-API-Key: <token>` on every request. Bearer is only for OAuth access tokens. |
| Base URL ends `/api/v1/` | **Confirmed.** `https://api.plane.so/api/v1/` on Cloud; the same path on your own host when self-hosting. |
| Nested under `/workspaces/{workspace_slug}/projects/{project_id}/` | **Confirmed.** `project_id` is a UUID in the path, not the `PROJ` key. |
| Rate limit ~60 req/min | **Confirmed as the default.** Scoped **per API key** (`ApiKeyRateThrottle`, cache key = the key itself). Responses carry `X-RateLimit-Remaining` and `X-RateLimit-Reset` (unix seconds). Self-hosters can change it — see §6.1. |
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

Two endpoints do **not** use this envelope — see §6.3.

---

## 2. Traps — where reasonable assumptions turn out to be wrong

Each of these is a case where the obvious expectation, or the published documentation, does not
match what the API does. They are the ones that cost real time.

### 2.1 `description_stripped` is NOT returned  ⚠️

Plain text has to be derived, not fetched. `description_stripped` is a real column on the `Issue`
model, but the API serializer explicitly excludes it (source-confirmed):

```python
class Meta:
    model = Issue
    exclude = ["description_json", "description_stripped"]
```

The payload gives you `description_html` only, so any plain-text column has to be produced by
stripping that markup yourself. See §5.1 for how this project does it.

### 2.2 Module and cycle are NOT on the work item payload  ⚠️

Neither is a field on the work item response. The list view annotates `cycle_id` in SQL, but it is
an annotation and the serializer is model-field-based, so it never reaches the JSON.

Membership can only be read from the reverse direction:

- `GET /workspaces/{slug}/projects/{project_id}/modules/{module_id}/module-issues/` → paginated
  **full** work items belonging to that module
- `GET /workspaces/{slug}/projects/{project_id}/cycles/{cycle_id}/cycle-issues/`

Cost: one request per 100 members, per module, per cycle. A project with 12 modules and 8 cycles
costs 20+ extra requests against a 60/min budget, on top of the issue pull. Three mitigations:

- Pass `fields=id` so those calls return `[{"id": ...}]` and nothing else, plus `per_page=100`.
  Without it, Plane re-serialises every full work item you already hold.
- Build the membership maps **lazily** — only when the module/cycle data is actually needed.
- Note that an item can be in multiple modules, but the data model gives it at most one cycle.

### 2.3 Server-side filtering exists on Cloud, but is not a bulk export tool

Plane Cloud has a real filter endpoint:

`POST /api/v1/workspaces/{workspace_slug}/work-items/advanced-search/`

Body: `{ query, filters, limit, workspace_search, project_id }`, where `filters` is a JSON grammar
with `and`/`or`/`not` over `state_id__in`, `state_group__in`, `cycle_id__in`, `module_id__in`,
`assignee_id__in`, `label_id__in`, `priority__in`, `created_by_id__in`, `created_at__gte/lte`,
`start_date`, `target_date`, `is_archived`, `type_id__in`.

**It does not exist on v1.3.0.** No `advanced-search/` route is registered in the v1.3.0 URL conf —
only `work-items/search/`, a name/sequence-id text search that takes a `limit` and returns six
fields.

Even on Cloud it fails as an export mechanism, for two reasons:

1. It takes a `limit`, not a cursor — there is no documented way to page a complete result set.
2. It returns a trimmed row (`id`, `name`, `sequence_id`, `project_identifier`, `state_id`,
   `priority`, `start_date`, `target_date`) — no description, assignees, labels or timestamps. You
   would have to re-fetch each item anyway.

Also worth knowing: Plane staff have acknowledged on the forum that the `filters` grammar is
**undocumented** ("The filters documentation is indeed missing examples — we're aware"). Building
on an undocumented request schema is a poor trade.

**Conclusion: pull the full set and filter in memory.** On 1.3.0 it is the only option; on Cloud it
is still the better one. This client carries an unimplemented `advancedSearch` method so adopting
it later is a one-file change.

### 2.4 Human identifiers resolve directly — no local index table needed  ✅

A common assumption is that turning `PROJ-123` into a UUID requires maintaining your own index.
It does not. There is a first-class endpoint, present in v1.3.0:

```
GET /api/v1/workspaces/{workspace_slug}/work-items/{project_identifier}-{issue_identifier}/
curl "https://api.plane.so/api/v1/workspaces/my-workspace/work-items/PROJ-123/" -H "X-API-Key: $KEY"
```

Note it is **workspace-scoped, not project-scoped** — you do not need the project UUID to resolve
`PROJ-123`. It returns the full work item, with `id` being the UUID. Source-confirmed: the route is
`workspaces/<slug>/work-items/<str:project_identifier>-<str:issue_identifier>/` and the view filters
on `project__identifier` + `sequence_id`.

Worth caching if you resolve identifiers in bulk, since identifier → UUID never changes.

---

## 3. Undocumented behaviours worth knowing

### 3.1 The "cursor" is really an offset  ⚠️

Cursor format is `{page_size}:{offset}:{is_prev}` — e.g. `100:3:0` means "100 per page, page index
3". It is offset pagination wearing a cursor's clothes, **not** a stable snapshot. If anyone creates
or deletes a work item mid-export, later pages shift and rows can be silently skipped or duplicated.

Mitigations, all implemented in `src/plane/pagination.ts`:

- Page with an explicit stable `order_by` (`sequence_id`) rather than the default `-created_at`.
- Deduplicate by `id` while accumulating.
- Compare the accumulated count against `total_count` from the first page and warn on a mismatch —
  the only way a skipped row can be noticed at all.
- Cap total pages, so a cursor that stops advancing fails loudly instead of looping.

### 3.2 The list endpoint silently excludes several categories of work item

The default manager excludes: **triage-state items, archived items, draft items, and every item in
an archived project** (source-confirmed). Nothing in the response signals this, so an export can
come back short with no explanation. There are separate `archived-cycles` / `archived-modules`
routes, but no archived-work-item list in the public API.

This exporter states the exclusion on every summary sheet, so nobody reconciles a count by hand and
concludes the tool is broken. See §5 for why that matters for reporting.

### 3.3 `expand` inlines related objects — but is not always the right call

`?expand=state,assignees,labels,created_by` returns those relations as objects instead of bare
UUIDs. Useful, but this project deliberately does **not** use it, for three reasons:

- `expand` does not cover modules or cycles (§2.2), so lookup maps are needed regardless.
- Expanded assignees and labels re-query per row — the serializer does an N+1 on purpose — which
  inflates response time on exactly the large pulls where it would help most.
- Filtering by state group needs the full state table anyway, including states with zero items.

Given the maps exist, expanding would add a second shape for the same field and buy nothing. If you
are fetching a handful of items rather than a whole project, the trade goes the other way.

### 3.4 `fields` trims the payload

`?fields=id,name,state` restricts which fields are serialised. Worth using for the membership calls
in §2.2, where the ids are all you need and the default response repeats entire work items.

### 3.5 Assignees and labels are arrays of UUIDs

Both come back as **arrays of UUID strings** by default — an empty array, never null, when there
are none. So "unassigned" is `assignees.length === 0`, and "no cycle" is `cycle_id == null`.

### 3.6 State groups are a fixed set

`backlog`, `unstarted`, `started`, `completed`, `cancelled` — plus `triage`, which never appears in
list results (§3.2). Safe to type as a union.

### 3.7 The estimate endpoints break every convention in this API  ⚠️

Found the hard way, against a real project. Three separate deviations, all confirmed in
`apps/api/plane/api/views/estimate.py` at v1.3.0:

1. **`GET /projects/{id}/estimates/` returns a single object, not a paginated envelope.** The view
   is `estimate = self.get_queryset().first()` followed by a plain serializer response. A project
   can only have one estimate scale — creating a second returns 409 — so there is no list to page.
2. **It returns 404 when the project has no estimate configured.** `{"error": "Estimate not
   found"}`. That is the normal state for most projects, not a failure, and must be treated as "no
   estimates" rather than propagated.
3. **`GET /estimates/{estimate_id}/estimate-points/` returns a bare array**, like `/members/`. It
   also 404s if the estimate id does not resolve.

A work item's `estimate_point` is a UUID pointing into that table, so without it the estimate column
can only show a UUID. See §5.3 for how this shapes error handling.

### 3.8 `/issues/` and `/work-items/` are both live

Every route is registered under both prefixes and they hit the same views. `work-items` is the
current naming and `issues` is the legacy alias; this client uses `work-items` throughout.

---

## 4. Endpoint map

All paths are relative to your API base — `https://api.plane.so/api/v1/` on Cloud, or
`https://your-plane-host/api/v1/` when self-hosting. Every route below is confirmed present in the
v1.3.0 URL conf.

| Purpose | Method + path |
| --- | --- |
| Projects | `GET workspaces/{slug}/projects/` |
| Work items (bulk pull) | `GET workspaces/{slug}/projects/{project_id}/work-items/?per_page=100&order_by=sequence_id` |
| Work item by UUID | `GET workspaces/{slug}/projects/{project_id}/work-items/{id}/` |
| Work item by identifier | `GET workspaces/{slug}/work-items/PROJ-123/` |
| States | `GET workspaces/{slug}/projects/{project_id}/states/` |
| Members | `GET workspaces/{slug}/projects/{project_id}/members/` — bare array, no envelope |
| Labels | `GET workspaces/{slug}/projects/{project_id}/labels/` |
| Modules | `GET workspaces/{slug}/projects/{project_id}/modules/` |
| Module membership | `GET .../modules/{module_id}/module-issues/?fields=id&per_page=100` |
| Cycles | `GET workspaces/{slug}/projects/{project_id}/cycles/` |
| Cycle membership | `GET .../cycles/{cycle_id}/cycle-issues/?fields=id&per_page=100` |
| Estimates | `GET workspaces/{slug}/projects/{project_id}/estimates/` — single object, 404s when unset |
| Estimate points | `GET .../estimates/{estimate_id}/estimate-points/` — bare array |
| Text search | `GET workspaces/{slug}/work-items/search/?search=…&limit=…` |
| Update a work item | `PATCH workspaces/{slug}/projects/{project_id}/work-items/{id}/` |

**Not available on 1.3.0:** the `*-lite` lookup variants (`modules-lite`, `cycles-lite`,
`project-members-lite`, `members-lite`) landed in v1.4.0, and `work-items/advanced-search/` is Cloud
only. The full lookup endpoints are fine at normal scale — a project has tens of states, labels and
modules, not thousands.

---

## 5. Design decisions these findings force

Recorded so the reasoning is not lost, and so anyone changing them knows what they are trading.

### 5.1 HTML stripping is hand-rolled, with no new dependency

`description_stripped` is not exposed (§2.1), so `description_html` is converted locally: strip
tags, decode entities, collapse whitespace. About 25 lines in `src/util/html-to-text.ts`, unit
tested. The bar is "readable text in a spreadsheet cell", not faithful rendering — reach for a real
parser only if you need tables or nested lists to survive.

### 5.2 The item link is built from the app URL, not the API URL

The web app and the API share a host when self-hosting, but not on Cloud (`app.plane.so` vs
`api.plane.so`), so they are separate settings. The link column is
`{PLANE_APP_URL}/{workspace_slug}/projects/{project_id}/issues/{issue_id}`.

### 5.3 Estimates are the only optional lookup

They 404 when unconfigured (§3.7), so that table degrades to empty and the column goes blank.
States, labels and members stay fatal, because a missing one would put *wrong* names in every row
rather than an empty cell. That asymmetry is the general rule worth copying: degrade where the
consequence is a blank, fail where the consequence is wrong data.

### 5.4 Filtering happens in memory, after a full pull

Forced by §2.3, but it also makes cost predictable under a tight rate limit: ten filter
combinations over one project cost one pull rather than ten. The trade is that a narrow filter is
no cheaper than a broad one, since cost tracks project size.

### 5.5 The archived-items gap

The list endpoint silently drops four categories (§3.2): **archived** work items (Plane can
auto-archive anything that has sat in a completed or cancelled state for N days, if the project
enables it), items in the **triage** inbox, **drafts**, and everything inside an **archived
project**. No public endpoint lists archived work items, so this is a hard limit of the API rather
than a choice any client makes.

For a reporting tool, archived items are the category that can actually distort a number: a
"completed this quarter" export under-counts if the project auto-archives after 30 days. This
exporter states the exclusion on every summary sheet so a mismatch is self-explaining. If the gap
matters for your reporting, the only workaround is reading the archive from the database directly,
which is worth avoiding.

---

## 6. Self-hosting and verification notes

### 6.1 The rate limit is a config value, not a constant

In v1.3.0 the throttle reads `rate = os.environ.get("API_KEY_RATE_LIMIT", "60/minute")` on the API
container. Two things follow:

- 60/min is only the default. A self-hosted instance may already be set differently, and it can be
  raised if you turn out to be throughput-bound. Worth checking the API container's environment
  before assuming. On Plane Cloud you get 60 and no say in it.
- A client must therefore treat the limit as **configured, not assumed**: drive the throttle from a
  setting, and still handle 429 with `Retry-After` regardless of what that setting says. Never
  hardcode 60.

There is also a `ServiceTokenRateThrottle` at a fixed 300/minute, applied when the API token row has
`is_service = True`. That flag is not settable from the UI — it is for Plane's own internal services
— so treat it as unavailable unless you are willing to set it directly in the database, which is not
recommended.

### 6.2 429 handling

DRF's `SimpleRateThrottle` returns 429 with a `Retry-After` header derived from the throttle window,
so honouring that header works exactly as you would hope.

### 6.3 Verify the response shape, not just that the route exists

Two endpoints in this API have been wired up correctly by path and still been wrong, because the
response conventions are not uniform:

- `projects/{id}/members/` returns a **bare array** where everything around it returns a pagination
  envelope.
- `projects/{id}/estimates/` returns a **single object** and **404s when unconfigured** (§3.7).

Checking the URL conf only proves a route is registered. Before writing a client method, read the
view in `apps/api/plane/api/views/*.py` at the tag matching your version and confirm three things:
whether it paginates, what it returns when the underlying record is absent, and whether the
serializer excludes fields the model has (`description_stripped` is the trap — §2.1).

### 6.4 Version drift

Every finding here is pinned to v1.3.0. Upgrading — even to 1.3.1 — is worth a re-read, especially
§2.1, §2.2 and §4. The `*-lite` endpoints added in 1.4.0 and Cloud's advanced search would both
simplify code this project currently writes by hand.

If you verify this against a different version, corrections are welcome — that is the most useful
contribution anyone could make to this file.
