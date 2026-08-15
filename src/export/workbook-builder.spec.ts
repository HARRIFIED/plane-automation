import ExcelJS from 'exceljs';

import { DEFAULT_COLUMNS } from './columns';
import type { ExportRow } from './export-row';
import { buildWorkbook, sanitiseSheetName, tint } from './workbook-builder';

function row(overrides: Partial<ExportRow> = {}): ExportRow {
  return {
    identifier: 'ENG-1',
    name: 'Login page hangs',
    description: 'Users report the login page hangs.',
    state: 'In Progress',
    stateColor: '#3f76d4',
    stateGroup: 'started',
    priority: 'urgent',
    assignees: 'Ada Lovelace',
    labels: 'bug, frontend',
    module: 'Billing',
    cycle: 'Sprint 12',
    createdAt: new Date('2026-07-01T09:00:00.000Z'),
    updatedAt: new Date('2026-07-02T09:00:00.000Z'),
    startDate: null,
    completedAt: null,
    targetDate: null,
    estimate: '3',
    createdBy: 'Ada Lovelace',
    link: 'https://plane.sagegreytech.com/sagegrey/projects/project-1/issues/item-1',
    ...overrides,
  };
}

const summary = {
  generatedAt: new Date('2026-08-09T12:00:00.000Z'),
  filterDescription: ['State: In Progress', 'Priority: urgent'],
  warnings: [] as string[],
  sheets: [{ projectName: 'Engineering', projectIdentifier: 'ENG', rows: [row()] }],
};

/** Write then read back, so the assertions are about a real .xlsx rather than our own objects. */
async function reopen(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  return workbook;
}

describe('buildWorkbook', () => {
  it('produces a readable workbook with the summary first', async () => {
    const workbook = await reopen(await buildWorkbook({ columns: DEFAULT_COLUMNS, summary }));

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(['Summary', 'Engineering']);
  });

  it('freezes the header row', async () => {
    const workbook = await reopen(await buildWorkbook({ columns: DEFAULT_COLUMNS, summary }));
    const sheet = workbook.getWorksheet('Engineering');

    expect(sheet?.views?.[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
  });

  it('writes a bold header with the accent fill', async () => {
    const workbook = await reopen(await buildWorkbook({ columns: ['identifier', 'name'], summary }));
    const header = workbook.getWorksheet('Engineering')?.getRow(1);

    expect(header?.getCell(1).font?.bold).toBe(true);
    expect(header?.getCell(1).fill).toMatchObject({ fgColor: { argb: 'FF1F3A5F' } });
  });

  it('writes only the requested columns, in order', async () => {
    const workbook = await reopen(await buildWorkbook({ columns: ['state', 'identifier'], summary }));
    const header = workbook.getWorksheet('Engineering')?.getRow(1);

    expect(header?.getCell(1).value).toBe('State');
    expect(header?.getCell(2).value).toBe('ID');
    expect(header?.getCell(3).value).toBeFalsy();
  });

  it('writes dates as real dates with a readable format, not ISO text', async () => {
    const workbook = await reopen(await buildWorkbook({ columns: ['createdAt'], summary }));
    const cell = workbook.getWorksheet('Engineering')?.getRow(2).getCell(1);

    expect(cell?.value).toBeInstanceOf(Date);
    expect(cell?.numFmt).toBe('dd mmm yyyy hh:mm');
  });

  it('leaves a missing date as an empty cell', async () => {
    const workbook = await reopen(await buildWorkbook({ columns: ['completedAt'], summary }));
    const cell = workbook.getWorksheet('Engineering')?.getRow(2).getCell(1);

    expect(cell?.value ?? '').toBe('');
  });

  it('colour codes priority', async () => {
    const workbook = await reopen(await buildWorkbook({ columns: ['priority'], summary }));
    const cell = workbook.getWorksheet('Engineering')?.getRow(2).getCell(1);

    expect(cell?.value).toBe('Urgent');
    expect(cell?.fill).toMatchObject({ fgColor: { argb: 'FFFFC7CE' } });
  });

  it('leaves "none" priority unfilled rather than colouring every row', async () => {
    const unprioritised = {
      ...summary,
      sheets: [{ ...summary.sheets[0]!, rows: [row({ priority: 'none' })] }],
    };

    const workbook = await reopen(await buildWorkbook({ columns: ['priority'], summary: unprioritised }));

    expect(workbook.getWorksheet('Engineering')?.getRow(2).getCell(1).fill).toBeUndefined();
  });

  it('colour codes state using Plane\'s own colour, tinted', async () => {
    const workbook = await reopen(await buildWorkbook({ columns: ['state'], summary }));
    const cell = workbook.getWorksheet('Engineering')?.getRow(2).getCell(1);

    expect(cell?.fill).toMatchObject({ type: 'pattern', pattern: 'solid' });
  });

  it('makes the link column a real hyperlink', async () => {
    const workbook = await reopen(await buildWorkbook({ columns: ['link'], summary }));
    const cell = workbook.getWorksheet('Engineering')?.getRow(2).getCell(1);

    expect(cell?.value).toMatchObject({
      text: 'Open',
      hyperlink: 'https://plane.sagegreytech.com/sagegrey/projects/project-1/issues/item-1',
    });
  });

  it('caps column width so a long description cannot blow out the sheet', async () => {
    const long = { ...summary, sheets: [{ ...summary.sheets[0]!, rows: [row({ description: 'x'.repeat(5000) })] }] };
    const workbook = await reopen(await buildWorkbook({ columns: ['description'], summary: long }));

    expect(workbook.getWorksheet('Engineering')?.getColumn(1).width).toBeLessThanOrEqual(60);
  });

  it('gives every column an explicit width that survives the file round-trip', async () => {
    // ExcelJS drops a width of exactly 9 as "the default", which left narrow columns unsized.
    const workbook = await reopen(await buildWorkbook({ columns: DEFAULT_COLUMNS, summary }));
    const sheet = workbook.getWorksheet('Engineering');

    for (let column = 1; column <= DEFAULT_COLUMNS.length; column += 1) {
      expect(sheet?.getColumn(column).width).toBeGreaterThan(0);
    }
  });

  it('records the filter criteria and generation time on the summary', async () => {
    const workbook = await reopen(await buildWorkbook({ columns: DEFAULT_COLUMNS, summary }));
    const text = flatten(workbook.getWorksheet('Summary'));

    expect(text).toContain('State: In Progress');
    expect(text).toContain('Total work items');
    expect(text).toContain('Plane work item export');
  });

  it('says so when there were no filters', async () => {
    const workbook = await reopen(
      await buildWorkbook({ columns: DEFAULT_COLUMNS, summary: { ...summary, filterDescription: [] } }),
    );

    expect(flatten(workbook.getWorksheet('Summary'))).toContain('No filters — full project export');
  });

  it('breaks totals down by state, priority and assignee', async () => {
    const workbook = await reopen(await buildWorkbook({ columns: DEFAULT_COLUMNS, summary }));
    const text = flatten(workbook.getWorksheet('Summary'));

    expect(text).toContain('By state');
    expect(text).toContain('By priority');
    expect(text).toContain('By assignee');
  });

  it('notes the work items Plane will not return, so a short count is explainable', async () => {
    const workbook = await reopen(await buildWorkbook({ columns: DEFAULT_COLUMNS, summary }));

    expect(flatten(workbook.getWorksheet('Summary'))).toContain('archived, draft or triage');
  });

  it('surfaces warnings on the summary sheet', async () => {
    const withWarnings = { ...summary, warnings: ['ENG: labels value "bugg" matched nothing'] };
    const workbook = await reopen(await buildWorkbook({ columns: DEFAULT_COLUMNS, summary: withWarnings }));

    expect(flatten(workbook.getWorksheet('Summary'))).toContain('matched nothing');
  });

  it('gives each project its own tab, plus a by-project breakdown', async () => {
    const multi = {
      ...summary,
      sheets: [
        { projectName: 'Engineering', projectIdentifier: 'ENG', rows: [row()] },
        { projectName: 'Platform', projectIdentifier: 'PLAT', rows: [row({ identifier: 'PLAT-1' })] },
      ],
    };

    const workbook = await reopen(await buildWorkbook({ columns: DEFAULT_COLUMNS, summary: multi }));

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(['Summary', 'Engineering', 'Platform']);
    expect(flatten(workbook.getWorksheet('Summary'))).toContain('By project');
  });

  it('handles a project with no matching work items', async () => {
    const empty = { ...summary, sheets: [{ projectName: 'Engineering', projectIdentifier: 'ENG', rows: [] }] };
    const workbook = await reopen(await buildWorkbook({ columns: DEFAULT_COLUMNS, summary: empty }));

    // Header still present, so the file is not mistaken for a failed export.
    expect(workbook.getWorksheet('Engineering')?.getRow(1).getCell(1).value).toBe('ID');
  });

  it('makes two similarly named projects distinct tabs instead of colliding', async () => {
    const clashing = {
      ...summary,
      sheets: [
        { projectName: 'Platform Infrastructure Team Alpha', projectIdentifier: 'A', rows: [] },
        { projectName: 'Platform Infrastructure Team Beta', projectIdentifier: 'B', rows: [] },
      ],
    };

    const workbook = await reopen(await buildWorkbook({ columns: ['identifier'], summary: clashing }));

    expect(new Set(workbook.worksheets.map((sheet) => sheet.name)).size).toBe(3);
  });
});

describe('sanitiseSheetName', () => {
  it('replaces the characters Excel forbids in a tab name', () => {
    expect(sanitiseSheetName('Platform / Infra: v2 [beta]')).toBe('Platform - Infra- v2 -beta-');
  });

  it('truncates to Excel\'s 31 character limit', () => {
    expect(sanitiseSheetName('x'.repeat(50))).toHaveLength(31);
  });

  it('falls back rather than producing an empty tab name', () => {
    expect(sanitiseSheetName('   ')).toBe('Sheet');
  });
});

describe('tint', () => {
  it('lightens a colour towards white and returns ARGB', () => {
    expect(tint('#000000', 0.5)).toBe('FF808080');
    expect(tint('#ffffff', 0.5)).toBe('FFFFFFFF');
  });

  it('accepts a hex value with or without the hash', () => {
    expect(tint('3f76d4')).toBe(tint('#3f76d4'));
  });

  it('returns null for something that is not a colour', () => {
    expect(tint('rebeccapurple')).toBeNull();
    expect(tint('#fff')).toBeNull();
  });
});

function flatten(sheet: ExcelJS.Worksheet | undefined): string {
  if (!sheet) return '';

  const parts: string[] = [];
  sheet.eachRow((row) => {
    row.eachCell({ includeEmpty: false }, (cell) => parts.push(String(cell.value ?? '')));
  });

  return parts.join(' | ');
}
