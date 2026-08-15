import ExcelJS from 'exceljs';

import type { PlanePriority } from '../plane';
import { COLUMN_DEFINITIONS } from './columns';
import type { ColumnDefinition, ExportColumnKey } from './columns';
import type { ExportRow } from './export-row';

/** House accent for header fills. */
const ACCENT_FILL = 'FF1F3A5F';
const ACCENT_TEXT = 'FFFFFFFF';

/** Priority fills, warm to cool so severity reads at a glance. */
const PRIORITY_FILLS: Record<PlanePriority, string | null> = {
  urgent: 'FFFFC7CE',
  high: 'FFFFD8A8',
  medium: 'FFFFF2CC',
  low: 'FFD9E7F5',
  none: null,
};

/** Excel number formats. Readable dates, never ISO strings or raw serial numbers. */
const DATE_FORMAT = 'dd mmm yyyy';
const DATE_TIME_FORMAT = 'dd mmm yyyy hh:mm';

export interface SheetData {
  /** Becomes the tab name, sanitised. */
  projectName: string;
  projectIdentifier: string;
  rows: ExportRow[];
}

export interface SummaryData {
  generatedAt: Date;
  /** Human readable description of the filter that produced this export. */
  filterDescription: string[];
  /** Anything the filter referred to that did not exist, if the caller chose to warn. */
  warnings: string[];
  sheets: SheetData[];
}

export interface BuildWorkbookOptions {
  columns: readonly ExportColumnKey[];
  summary: SummaryData;
}

/**
 * Build the workbook.
 *
 * Summary sheet first, then one sheet per project. Pure in the sense that matters: it takes
 * resolved rows and returns a buffer, with no knowledge of Plane, filters or HTTP.
 */
export async function buildWorkbook(options: BuildWorkbookOptions): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'plane-automation';
  workbook.created = options.summary.generatedAt;

  addSummarySheet(workbook, options.summary, options.columns);

  for (const sheet of options.summary.sheets) {
    addProjectSheet(workbook, sheet, options.columns);
  }

  // ExcelJS declares its own Buffer type that does not line up with Node's, so go through
  // the underlying bytes rather than asserting between two incompatible declarations.
  const written = await workbook.xlsx.writeBuffer();
  return Buffer.from(written as unknown as ArrayBuffer);
}

// ------------------------------------------------------------------ project sheets

function addProjectSheet(
  workbook: ExcelJS.Workbook,
  sheet: SheetData,
  columns: readonly ExportColumnKey[],
): void {
  const worksheet = workbook.addWorksheet(uniqueSheetName(workbook, sheet.projectName || sheet.projectIdentifier), {
    // Freeze the header so it stays visible while scrolling a few thousand rows.
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  const definitions = columns.map((key) => COLUMN_DEFINITIONS[key]);

  worksheet.columns = definitions.map((definition) => ({
    header: definition.header,
    key: definition.key,
    width: definition.width,
  }));

  styleHeaderRow(worksheet.getRow(1));

  for (const row of sheet.rows) {
    const added = worksheet.addRow(buildCellValues(row, definitions));
    styleDataRow(added, row, definitions);
  }

  autoSizeColumns(worksheet, definitions);

  // Filter dropdowns on the header: the export is already filtered, but people slice further.
  if (sheet.rows.length > 0) {
    worksheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: definitions.length },
    };
  }
}

function buildCellValues(row: ExportRow, definitions: ColumnDefinition[]): Record<string, unknown> {
  const values: Record<string, unknown> = {};

  for (const definition of definitions) {
    const value = row[definition.key];

    if (definition.format === 'url') {
      // A hyperlink object rather than raw text, so the cell is clickable.
      values[definition.key] = typeof value === 'string' && value ? { text: 'Open', hyperlink: value } : '';
      continue;
    }

    if (definition.key === 'priority') {
      values[definition.key] = capitalise(row.priority);
      continue;
    }

    values[definition.key] = value ?? '';
  }

  return values;
}

function styleHeaderRow(row: ExcelJS.Row): void {
  row.font = { bold: true, color: { argb: ACCENT_TEXT } };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ACCENT_FILL } };
  row.alignment = { vertical: 'middle' };
  row.height = 20;
}

function styleDataRow(row: ExcelJS.Row, data: ExportRow, definitions: ColumnDefinition[]): void {
  definitions.forEach((definition, offset) => {
    const cell = row.getCell(offset + 1);

    switch (definition.format) {
      case 'date':
        cell.numFmt = DATE_FORMAT;
        break;
      case 'dateTime':
        cell.numFmt = DATE_TIME_FORMAT;
        break;
      case 'url':
        cell.font = { color: { argb: 'FF0563C1' }, underline: true };
        break;
      default:
        break;
    }

    if (definition.key === 'priority') {
      const fill = PRIORITY_FILLS[data.priority];
      if (fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
    }

    if (definition.key === 'state' && data.stateColor) {
      // Plane already assigns every state a colour and people recognise them from the board,
      // so reuse it rather than inventing a second scheme. Tinted, because the raw colour is
      // chosen for a dark UI and is too saturated behind black spreadsheet text.
      const argb = tint(data.stateColor);
      if (argb) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
    }
  });
}

/**
 * Size columns to their content, within the per-column cap.
 *
 * Excel has no real auto-fit for generated files — the width has to be computed — so this
 * measures the longest value and clamps it. Without the cap a single long description would
 * push every other column off the screen.
 */
function autoSizeColumns(worksheet: ExcelJS.Worksheet, definitions: ColumnDefinition[]): void {
  definitions.forEach((definition, offset) => {
    const column = worksheet.getColumn(offset + 1);

    let longest = definition.header.length;

    column.eachCell?.({ includeEmpty: false }, (cell) => {
      const length = measure(cell.value);
      if (length > longest) longest = length;
    });

    // +2 for padding so text is not flush against the cell border.
    const width = Math.min(Math.max(longest + 2, 8), definition.maxWidth);

    // ExcelJS treats 9 as its default column width and omits the <col> element entirely when
    // a width matches it, so the column comes back undefined on read and inherits the sheet
    // default instead. Visually identical, but it makes the intent vanish from the file — so
    // nudge to 10 rather than leaving a column silently unsized.
    column.width = width === 9 ? 10 : width;
  });
}

function measure(value: ExcelJS.CellValue): number {
  if (value === null || value === undefined) return 0;
  if (value instanceof Date) return DATE_TIME_FORMAT.length;
  if (typeof value === 'object' && 'text' in value) return String(value.text).length;
  return String(value).length;
}

// ------------------------------------------------------------------ summary sheet

/**
 * The summary tab.
 *
 * First tab deliberately: it answers "what am I looking at" before anyone scrolls a data
 * sheet. It carries the filter criteria and the generation timestamp so a spreadsheet
 * forwarded by email is still self-describing a week later.
 */
function addSummarySheet(
  workbook: ExcelJS.Workbook,
  summary: SummaryData,
  columns: readonly ExportColumnKey[],
): void {
  const sheet = workbook.addWorksheet('Summary');
  sheet.columns = [{ width: 34 }, { width: 16 }, { width: 60 }];

  title(sheet, 'Plane work item export');

  const allRows = summary.sheets.flatMap((entry) => entry.rows);

  const generatedRow = keyValue(sheet, 'Generated', summary.generatedAt);
  generatedRow.getCell(2).numFmt = DATE_TIME_FORMAT;
  keyValue(sheet, 'Projects', summary.sheets.map((entry) => entry.projectIdentifier).join(', '));
  keyValue(sheet, 'Total work items', allRows.length);
  keyValue(sheet, 'Columns', columns.length);

  blank(sheet);
  title(sheet, 'Filter criteria');
  if (summary.filterDescription.length === 0) {
    sheet.addRow(['No filters — full project export']);
  } else {
    for (const line of summary.filterDescription) sheet.addRow([line]);
  }

  if (summary.warnings.length > 0) {
    blank(sheet);
    title(sheet, 'Warnings');
    for (const warning of summary.warnings) {
      const row = sheet.addRow([warning]);
      row.getCell(1).font = { color: { argb: 'FFB45309' } };
    }
  }

  // Per-project counts only earn their space when there is more than one project.
  if (summary.sheets.length > 1) {
    blank(sheet);
    breakdown(
      sheet,
      'By project',
      summary.sheets.map((entry) => [entry.projectIdentifier, entry.rows.length] as const),
    );
  }

  blank(sheet);
  breakdown(sheet, 'By state', tally(allRows, (row) => row.state || '(no state)'));
  blank(sheet);
  breakdown(sheet, 'By priority', tally(allRows, (row) => capitalise(row.priority)));
  blank(sheet);
  breakdown(
    sheet,
    'By assignee',
    tally(allRows, (row) => row.assignees || '(unassigned)'),
  );

  blank(sheet);
  const note = sheet.addRow([
    'Note: Plane\'s API does not return archived, draft or triage work items, so they are absent from this export.',
  ]);
  note.getCell(1).font = { italic: true, color: { argb: 'FF6B7280' } };
}

function title(sheet: ExcelJS.Worksheet, text: string): void {
  const row = sheet.addRow([text]);
  row.getCell(1).font = { bold: true, size: 12, color: { argb: ACCENT_FILL } };
}

function keyValue(sheet: ExcelJS.Worksheet, label: string, value: unknown): ExcelJS.Row {
  const row = sheet.addRow([label, value as ExcelJS.CellValue]);
  row.getCell(1).font = { bold: true };
  return row;
}

function blank(sheet: ExcelJS.Worksheet): void {
  sheet.addRow([]);
}

function breakdown(sheet: ExcelJS.Worksheet, heading: string, entries: readonly (readonly [string, number])[]): void {
  title(sheet, heading);

  const header = sheet.addRow([heading.replace('By ', '').replace(/^./, (c) => c.toUpperCase()), 'Count']);
  header.eachCell((cell, column) => {
    if (column > 2) return;
    cell.font = { bold: true, color: { argb: ACCENT_TEXT } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ACCENT_FILL } };
  });

  if (entries.length === 0) {
    sheet.addRow(['(none)', 0]);
    return;
  }

  for (const [name, count] of entries) sheet.addRow([name, count]);
}

/** Count rows by a key, ordered by count descending so the biggest bucket is first. */
function tally(rows: readonly ExportRow[], keyOf: (row: ExportRow) => string): (readonly [string, number])[] {
  const counts = new Map<string, number>();

  for (const row of rows) {
    const key = keyOf(row);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

// ------------------------------------------------------------------------ helpers

/**
 * Excel sheet names cannot exceed 31 characters, cannot contain : \ / ? * [ ], and must be
 * unique within a workbook. A project called "Platform / Infrastructure" would otherwise
 * throw, and two similarly named projects would collide, so both are handled here.
 */
export function uniqueSheetName(workbook: ExcelJS.Workbook, desired: string): string {
  const base = sanitiseSheetName(desired);

  if (!workbook.getWorksheet(base)) return base;

  for (let suffix = 2; suffix < 100; suffix += 1) {
    const tag = ` (${suffix})`;
    const candidate = `${base.slice(0, 31 - tag.length)}${tag}`;
    if (!workbook.getWorksheet(candidate)) return candidate;
  }

  return base.slice(0, 28) + '999';
}

export function sanitiseSheetName(name: string): string {
  const cleaned = name.replace(/[:\\/?*[\]]/g, '-').trim();
  return (cleaned || 'Sheet').slice(0, 31);
}

function capitalise(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

/**
 * Lighten a Plane state colour for use as a cell fill.
 *
 * Plane's palette is picked for a dark UI, so used directly it fights with the black text
 * Excel puts on top. Mixing it towards white keeps the hue recognisable and the text legible.
 */
export function tint(hex: string, amount = 0.72): string | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match?.[1]) return null;

  const value = parseInt(match[1], 16);
  const channels = [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];

  const lightened = channels.map((channel) => Math.round(channel + (255 - channel) * amount));

  return `FF${lightened.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}
