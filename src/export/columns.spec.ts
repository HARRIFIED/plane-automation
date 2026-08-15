import { columnsNeedMembership, DEFAULT_COLUMNS, EXPORT_COLUMN_KEYS, resolveColumns } from './columns';

describe('resolveColumns', () => {
  it('defaults to every column', () => {
    expect(resolveColumns()).toEqual([...DEFAULT_COLUMNS]);
    expect(resolveColumns([])).toEqual([...DEFAULT_COLUMNS]);
  });

  it('keeps a requested subset in the order given', () => {
    expect(resolveColumns(['state', 'identifier', 'name'])).toEqual(['state', 'identifier', 'name']);
  });

  it('tolerates surrounding whitespace from a comma separated flag', () => {
    expect(resolveColumns([' identifier ', ' name'])).toEqual(['identifier', 'name']);
  });

  it('drops duplicates rather than repeating a column', () => {
    expect(resolveColumns(['name', 'name', 'state'])).toEqual(['name', 'state']);
  });

  it('rejects an unknown column and lists the real ones', () => {
    expect(() => resolveColumns(['identifier', 'asignees'])).toThrow(/Unknown column\(s\): asignees/);
    expect(() => resolveColumns(['nope'])).toThrow(/Available columns/);
  });
});

describe('columnsNeedMembership', () => {
  it('is true only for the columns that come from the membership index', () => {
    // This drives the auto-detect: no module or cycle column, no extra requests.
    expect(columnsNeedMembership(['module'])).toBe(true);
    expect(columnsNeedMembership(['cycle'])).toBe(true);
    expect(columnsNeedMembership(['identifier', 'name', 'state'])).toBe(false);
    expect(columnsNeedMembership([])).toBe(false);
  });

  it('is true for the default column set, which includes both', () => {
    expect(columnsNeedMembership(EXPORT_COLUMN_KEYS)).toBe(true);
  });
});
