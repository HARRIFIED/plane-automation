/**
 * The exportable columns, and which ones an export uses by default.
 *
 * Keeping this as data rather than hardcoding the sheet layout is what makes the column set
 * configurable per export, and lets the service work out ahead of time whether it needs the
 * expensive module/cycle membership index.
 */

export const EXPORT_COLUMN_KEYS = [
  'identifier',
  'name',
  'description',
  'state',
  'priority',
  'assignees',
  'labels',
  'module',
  'cycle',
  'createdAt',
  'updatedAt',
  'startDate',
  'completedAt',
  'targetDate',
  'estimate',
  'createdBy',
  'link',
] as const;

export type ExportColumnKey = (typeof EXPORT_COLUMN_KEYS)[number];

/** How a value should be written into the cell. */
export type ColumnFormat = 'text' | 'longText' | 'date' | 'dateTime' | 'url';

export interface ColumnDefinition {
  key: ExportColumnKey;
  header: string;
  format: ColumnFormat;
  /** Starting width in characters; auto-sizing may narrow it but never exceeds `maxWidth`. */
  width: number;
  maxWidth: number;
}

export const COLUMN_DEFINITIONS: Record<ExportColumnKey, ColumnDefinition> = {
  identifier: { key: 'identifier', header: 'ID', format: 'text', width: 12, maxWidth: 16 },
  name: { key: 'name', header: 'Name', format: 'text', width: 45, maxWidth: 70 },
  // Capped hard: a description can be thousands of characters and would otherwise make the
  // sheet unusable. Excel keeps the full value in the cell either way.
  description: { key: 'description', header: 'Description', format: 'longText', width: 50, maxWidth: 60 },
  state: { key: 'state', header: 'State', format: 'text', width: 16, maxWidth: 24 },
  priority: { key: 'priority', header: 'Priority', format: 'text', width: 10, maxWidth: 12 },
  assignees: { key: 'assignees', header: 'Assignees', format: 'text', width: 26, maxWidth: 40 },
  labels: { key: 'labels', header: 'Labels', format: 'text', width: 22, maxWidth: 40 },
  module: { key: 'module', header: 'Module', format: 'text', width: 20, maxWidth: 32 },
  cycle: { key: 'cycle', header: 'Cycle', format: 'text', width: 18, maxWidth: 28 },
  createdAt: { key: 'createdAt', header: 'Created', format: 'dateTime', width: 18, maxWidth: 20 },
  updatedAt: { key: 'updatedAt', header: 'Updated', format: 'dateTime', width: 18, maxWidth: 20 },
  // Plane has no "started at" timestamp. start_date is the closest thing: a date the assignee
  // sets, not an automatic record of when work began. Named accordingly to avoid implying more.
  startDate: { key: 'startDate', header: 'Start date', format: 'date', width: 14, maxWidth: 16 },
  completedAt: { key: 'completedAt', header: 'Completed', format: 'dateTime', width: 18, maxWidth: 20 },
  targetDate: { key: 'targetDate', header: 'Target date', format: 'date', width: 14, maxWidth: 16 },
  estimate: { key: 'estimate', header: 'Estimate', format: 'text', width: 10, maxWidth: 12 },
  createdBy: { key: 'createdBy', header: 'Created by', format: 'text', width: 22, maxWidth: 32 },
  link: { key: 'link', header: 'Link', format: 'url', width: 14, maxWidth: 16 },
};

/** Everything, in the order the brief specifies. */
export const DEFAULT_COLUMNS: readonly ExportColumnKey[] = EXPORT_COLUMN_KEYS;

/**
 * Columns whose values come from the membership index rather than the work item.
 *
 * This is the other half of the auto-detect: selecting either column pays for the index,
 * and leaving both out costs nothing.
 */
const MEMBERSHIP_COLUMNS: readonly ExportColumnKey[] = ['module', 'cycle'];

export function columnsNeedMembership(columns: readonly ExportColumnKey[]): boolean {
  return columns.some((column) => MEMBERSHIP_COLUMNS.includes(column));
}

/**
 * Validate and normalise a requested column set.
 *
 * Order is preserved as given, so `--columns identifier,name,state` produces exactly those
 * three in that order. Duplicates are dropped rather than repeating a column.
 */
export function resolveColumns(requested?: readonly string[]): ExportColumnKey[] {
  if (!requested || requested.length === 0) return [...DEFAULT_COLUMNS];

  const seen = new Set<ExportColumnKey>();
  const unknown: string[] = [];

  for (const raw of requested) {
    const key = raw.trim();
    if (!key) continue;

    if (!isColumnKey(key)) {
      unknown.push(key);
      continue;
    }

    seen.add(key);
  }

  if (unknown.length > 0) {
    throw new Error(
      `Unknown column(s): ${unknown.join(', ')}. Available columns: ${EXPORT_COLUMN_KEYS.join(', ')}`,
    );
  }

  if (seen.size === 0) throw new Error('No valid columns were requested');

  return [...seen];
}

function isColumnKey(value: string): value is ExportColumnKey {
  return (EXPORT_COLUMN_KEYS as readonly string[]).includes(value);
}
