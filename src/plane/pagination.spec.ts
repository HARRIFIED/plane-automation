import { PlanePaginationError } from './errors';
import { collectAllPages } from './pagination';
import type { PlanePaginatedResponse } from './types';

interface Row {
  id: string;
}

/** Build a page envelope shaped exactly like Plane's. */
function page(rows: Row[], overrides: Partial<PlanePaginatedResponse<Row>> = {}): PlanePaginatedResponse<Row> {
  return {
    results: rows,
    total_count: rows.length,
    count: rows.length,
    total_pages: 1,
    total_results: rows.length,
    next_cursor: null,
    prev_cursor: null,
    next_page_results: false,
    prev_page_results: false,
    grouped_by: null,
    sub_grouped_by: null,
    extra_stats: null,
    ...overrides,
  };
}

const options = { maxPages: 10, resource: 'work items' };

describe('collectAllPages', () => {
  it('returns a single page unchanged', async () => {
    const result = await collectAllPages(async () => page([{ id: 'a' }, { id: 'b' }]), options);

    expect(result.items).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(result.pagesFetched).toBe(1);
  });

  it('follows the cursor until it is exhausted', async () => {
    const cursors: (string | undefined)[] = [];
    const fetchPage = jest.fn(async (cursor: string | undefined) => {
      cursors.push(cursor);
      if (cursor === undefined) {
        return page([{ id: 'a' }], { total_count: 3, next_cursor: '100:1:0', next_page_results: true });
      }
      if (cursor === '100:1:0') {
        return page([{ id: 'b' }], { total_count: 3, next_cursor: '100:2:0', next_page_results: true });
      }
      return page([{ id: 'c' }], { total_count: 3 });
    });

    const result = await collectAllPages(fetchPage, options);

    expect(result.items.map((row) => row.id)).toEqual(['a', 'b', 'c']);
    expect(cursors).toEqual([undefined, '100:1:0', '100:2:0']);
    expect(result.pagesFetched).toBe(3);
  });

  it('stops when next_page_results is false even if a cursor is present', async () => {
    // Plane populates next_cursor on the last page too; trusting it alone would loop.
    const fetchPage = jest.fn(async () =>
      page([{ id: 'a' }], { next_cursor: '100:1:0', next_page_results: false }),
    );

    const result = await collectAllPages(fetchPage, options);

    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(result.items).toHaveLength(1);
  });

  it('deduplicates rows that shift between offset pages', async () => {
    // The offset cursor is not a snapshot: a concurrent insert can push a row into two pages.
    const warnings: string[] = [];
    const fetchPage = jest.fn(async (cursor: string | undefined) =>
      cursor === undefined
        ? page([{ id: 'a' }, { id: 'b' }], { total_count: 3, next_cursor: '2:1:0', next_page_results: true })
        : page([{ id: 'b' }, { id: 'c' }], { total_count: 3 }),
    );

    const result = await collectAllPages(fetchPage, {
      ...options,
      onWarning: (message) => warnings.push(message),
    });

    expect(result.items.map((row) => row.id)).toEqual(['a', 'b', 'c']);
    expect(result.duplicatesDropped).toBe(1);
    expect(warnings.some((warning) => warning.includes('duplicate'))).toBe(true);
  });

  it('warns when the row count does not match the server total', async () => {
    const warnings: string[] = [];

    await collectAllPages(async () => page([{ id: 'a' }], { total_count: 5 }), {
      ...options,
      onWarning: (message) => warnings.push(message),
    });

    expect(warnings.some((warning) => warning.includes('server reported 5'))).toBe(true);
  });

  it('throws once the page cap is hit rather than looping forever', async () => {
    let offset = 0;
    const fetchPage = jest.fn(async () => {
      offset += 1;
      return page([{ id: `row-${offset}` }], {
        total_count: 1000,
        next_cursor: `100:${offset}:0`,
        next_page_results: true,
      });
    });

    await expect(collectAllPages(fetchPage, { ...options, maxPages: 3 })).rejects.toThrow(PlanePaginationError);
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it('stops instead of spinning when the cursor repeats itself', async () => {
    const warnings: string[] = [];
    const fetchPage = jest.fn(async (cursor: string | undefined) =>
      cursor === undefined
        ? page([{ id: 'a' }], { total_count: 2, next_cursor: '100:1:0', next_page_results: true })
        : page([{ id: 'b' }], { total_count: 2, next_cursor: '100:1:0', next_page_results: true }),
    );

    const result = await collectAllPages(fetchPage, {
      ...options,
      onWarning: (message) => warnings.push(message),
    });

    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(result.items.map((row) => row.id)).toEqual(['a', 'b']);
    expect(warnings.some((warning) => warning.includes('stopped advancing'))).toBe(true);
  });
});
