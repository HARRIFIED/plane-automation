import { PlanePaginationError } from './errors';
import type { PlanePaginatedResponse } from './types';

export interface PaginationOptions {
  /** Hard stop so a cursor that never advances cannot loop forever. */
  maxPages: number;
  /** Resource name, used in errors and warnings. */
  resource: string;
  onWarning?: (message: string) => void;
}

export interface PaginationResult<T> {
  items: T[];
  pagesFetched: number;
  /** Rows the server dropped as duplicates of ones we already had. See below. */
  duplicatesDropped: number;
  /** `total_count` reported by the first page. */
  expectedTotal: number | null;
}

type FetchPage<T> = (cursor: string | undefined) => Promise<PlanePaginatedResponse<T>>;

/**
 * Follow a Plane cursor to exhaustion and return every row.
 *
 * Plane's cursor is `pageSize:offset:isPrev` — offset pagination, not a snapshot. If somebody
 * creates or deletes a work item while we are paging, later offsets shift underneath us and
 * the same row can arrive twice, or one can be skipped entirely. Neither is signalled in the
 * response. So:
 *
 *  - callers page with a stable `order_by` (sequence_id) to minimise the shifting;
 *  - we deduplicate by id here, which makes the duplicate case harmless;
 *  - we compare the final tally against the server's `total_count` and warn on a mismatch,
 *    which is the only way the skip case can be noticed at all.
 *
 * A warning rather than an error: a count that moved mid-export is usually a colleague filing
 * a ticket, not a bug, and failing the export outright would be worse than flagging it.
 */
export async function collectAllPages<T extends { id: string }>(
  fetchPage: FetchPage<T>,
  options: PaginationOptions,
): Promise<PaginationResult<T>> {
  const items: T[] = [];
  const seen = new Set<string>();

  let cursor: string | undefined;
  let pagesFetched = 0;
  let duplicatesDropped = 0;
  let expectedTotal: number | null = null;

  for (;;) {
    if (pagesFetched >= options.maxPages) {
      throw new PlanePaginationError(
        `Aborted paging ${options.resource} after ${options.maxPages} pages (${items.length} rows so far). ` +
          'Either the project is larger than PLANE_MAX_PAGES allows, or the cursor is not advancing.',
      );
    }

    const page = await fetchPage(cursor);
    pagesFetched += 1;

    if (expectedTotal === null) expectedTotal = page.total_count ?? null;

    for (const item of page.results) {
      if (seen.has(item.id)) {
        duplicatesDropped += 1;
        continue;
      }
      seen.add(item.id);
      items.push(item);
    }

    if (!page.next_page_results || !page.next_cursor) break;

    // Guard against a server that echoes the same cursor back: without this the loop would
    // spin until maxPages and then fail with a confusing "project too large" message.
    if (page.next_cursor === cursor) {
      options.onWarning?.(
        `Cursor for ${options.resource} stopped advancing at "${cursor}"; stopping with ${items.length} rows.`,
      );
      break;
    }

    cursor = page.next_cursor;
  }

  if (duplicatesDropped > 0) {
    options.onWarning?.(
      `Dropped ${duplicatesDropped} duplicate ${options.resource} row(s) while paging. ` +
        'Expected when items are created or deleted mid-export.',
    );
  }

  if (expectedTotal !== null && items.length !== expectedTotal) {
    options.onWarning?.(
      `Fetched ${items.length} ${options.resource} rows but the server reported ${expectedTotal}. ` +
        'The data changed while paging, or archived/draft/triage items are being excluded server side.',
    );
  }

  return { items, pagesFetched, duplicatesDropped, expectedTotal };
}
