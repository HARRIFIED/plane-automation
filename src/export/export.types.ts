import type { ExportFilter } from '../filter';
import type { ExportColumnKey } from './columns';
import type { ThemeOptions } from './theme';

export interface ExportRequest {
  /** Project keys, names or UUIDs. One is the common case; several produce a tab each. */
  projects: string[];
  filter?: ExportFilter;
  /** Defaults to every column, in the documented order. */
  columns?: string[];
  /** Split each sheet into labelled sections: state, priority, assignees, module or cycle. */
  groupBy?: string;

  /**
   * Add a counted breakdown to the summary tab for each of these keywords.
   *
   * Independent of `filter.excludeKeywords`: the same phrase can keep items out of the rows
   * and still be counted here.
   */
  reportKeywords?: string[];

  /**
   * Whether keyword reports respect the export's filters.
   *
   * `filtered` (default) counts within the same window and filters as the export.
   * `all` counts across the whole project, which is what a running total needs.
   */
  reportScope?: 'filtered' | 'all';
  /** Header, group and banding colours. Defaults apply to anything omitted. */
  theme?: ThemeOptions;
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
