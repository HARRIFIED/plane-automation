import type { ExportFilter } from '../filter';
import type { ExportColumnKey } from './columns';

export interface ExportRequest {
  /** Project keys, names or UUIDs. One is the common case; several produce a tab each. */
  projects: string[];
  filter?: ExportFilter;
  /** Defaults to every column, in the documented order. */
  columns?: string[];
  /** Bypass the lookup cache for this run. */
  forceRefresh?: boolean;
  /**
   * How to treat filter values that match nothing.
   *
   * `refuse` fails the export — right for the CLI, where you can fix the typo and re-run.
   * `warn` proceeds and records it on the summary sheet.
   */
  onUnmatchedFilter?: 'refuse' | 'warn';
}

export interface ExportResult {
  buffer: Buffer;
  /** Suggested download name, e.g. "ENG-export-2026-08-09.xlsx". */
  filename: string;
  /** Rows written, after filtering, across all projects. */
  rowCount: number;
  /** Rows before filtering, useful for "12 of 340" style feedback. */
  totalBeforeFilter: number;
  warnings: string[];
}
