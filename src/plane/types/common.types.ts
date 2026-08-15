/**
 * Shapes shared across Plane endpoints.
 *
 * Every type here is modelled on the v1.3.0 serializers, not on the published Cloud
 * docs — the two differ. See docs/plane-api-findings.md.
 */

/** UUID string. Aliased purely for readability at call sites. */
export type Uuid = string;

/** ISO 8601 timestamp, e.g. "2026-08-09T10:15:00.000000Z". */
export type IsoDateTime = string;

/** Date-only string, e.g. "2026-08-09". Plane uses these for start_date / target_date. */
export type IsoDate = string;

/**
 * The envelope every paginated list endpoint returns.
 *
 * Caveat: `members/` does NOT use this — it returns a bare array. See PlaneApiClient.listMembers.
 */
export interface PlanePaginatedResponse<T> {
  results: T[];
  /** Total rows matching the query, before pagination. */
  total_count: number;
  /** Rows in this page. */
  count: number;
  total_pages: number;
  total_results: number;
  next_cursor: string | null;
  prev_cursor: string | null;
  next_page_results: boolean;
  prev_page_results: boolean;
  grouped_by: string | null;
  sub_grouped_by: string | null;
  extra_stats: unknown;
}

/**
 * Plane's cursor is `pageSize:offset:isPrev` — offset pagination wearing a cursor's clothes.
 * Parsed only for logging and for the safety checks in pagination.ts; we follow `next_cursor`
 * verbatim rather than constructing our own.
 */
export interface ParsedCursor {
  pageSize: number;
  offset: number;
  isPrev: boolean;
}

export function parseCursor(cursor: string): ParsedCursor | null {
  const [pageSize, offset, isPrev] = cursor.split(':');
  if (pageSize === undefined || offset === undefined) return null;

  const parsedPageSize = Number(pageSize);
  const parsedOffset = Number(offset);
  if (!Number.isFinite(parsedPageSize) || !Number.isFinite(parsedOffset)) return null;

  return { pageSize: parsedPageSize, offset: parsedOffset, isPrev: isPrev === '1' };
}

/** Query parameters accepted by the paginated list endpoints. */
export interface PlaneListParams {
  cursor?: string;
  per_page?: number;
  /** Prefix with '-' for descending. Plane rejects anything outside its allowlist. */
  order_by?: string;
  /** Comma separated field allowlist; trims the serialized payload. */
  fields?: string;
  /** Comma separated relations to inline instead of returning bare UUIDs. */
  expand?: string;
}
