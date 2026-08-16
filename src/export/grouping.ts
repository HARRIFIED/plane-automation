import { PLANE_PRIORITIES } from '../plane';
import type { ExportRow } from './export-row';

/**
 * Splitting an export into labelled sections.
 *
 * The common request is "show me each state as its own block" rather than one flat list sorted
 * by state — the difference between reading a spreadsheet and reading a board.
 */

export const GROUP_BY_FIELDS = ['state', 'priority', 'assignees', 'module', 'cycle'] as const;
export type GroupByField = (typeof GROUP_BY_FIELDS)[number];

export interface RowGroup {
  /** Section heading, e.g. "In Progress". */
  label: string;
  rows: ExportRow[];
  /** Plane's colour for this group, when the field has one. Used to tint the header. */
  color: string | null;
}

/** Shown instead of an empty heading, so a section is never unlabelled. */
const EMPTY_LABELS: Record<GroupByField, string> = {
  state: '(no state)',
  priority: '(no priority)',
  assignees: '(unassigned)',
  module: '(no module)',
  cycle: '(no cycle)',
};

export function isGroupByField(value: string): value is GroupByField {
  return (GROUP_BY_FIELDS as readonly string[]).includes(value);
}

export function parseGroupBy(value: string | undefined): GroupByField | undefined {
  if (!value) return undefined;

  const normalised = value.trim().toLowerCase();
  // Tolerate the singular, since "--group-by assignee" is what people type.
  const candidate = normalised === 'assignee' ? 'assignees' : normalised;

  if (!isGroupByField(candidate)) {
    throw new Error(
      `Cannot group by "${value}". Available: ${GROUP_BY_FIELDS.join(', ')}.`,
    );
  }

  return candidate;
}

/**
 * Split rows into ordered sections.
 *
 * Grouping is on the **displayed** value, not the underlying id. That keeps multi-valued fields
 * honest: an item assigned to two people lands in one "Ada Lovelace, Grace Hopper" section
 * rather than being duplicated into two, so the section counts still add up to the row count.
 *
 * Ordering is meaningful rather than alphabetical wherever the field has an inherent order:
 * states follow the project's own workflow sequence, priorities run urgent → none. Everything
 * else is alphabetical, with the empty group last — it is a footnote, not a headline.
 */
export function groupRows(rows: readonly ExportRow[], field: GroupByField): RowGroup[] {
  const groups = new Map<string, RowGroup>();

  for (const row of rows) {
    const label = valueOf(row, field) || EMPTY_LABELS[field];

    let group = groups.get(label);
    if (!group) {
      group = { label, rows: [], color: field === 'state' ? row.stateColor : null };
      groups.set(label, group);
    }

    group.rows.push(row);
  }

  return [...groups.values()].sort((a, b) => compare(a, b, field, rows));
}

function valueOf(row: ExportRow, field: GroupByField): string {
  switch (field) {
    case 'state':
      return row.state;
    case 'priority':
      return capitalise(row.priority);
    case 'assignees':
      return row.assignees;
    case 'module':
      return row.module;
    case 'cycle':
      return row.cycle;
  }
}

function compare(a: RowGroup, b: RowGroup, field: GroupByField, rows: readonly ExportRow[]): number {
  const aEmpty = a.label.startsWith('(');
  const bEmpty = b.label.startsWith('(');
  if (aEmpty !== bEmpty) return aEmpty ? 1 : -1;

  if (field === 'state') {
    // Board order — Backlog, Todo, In Progress, Done — not alphabetical.
    const aSequence = sequenceOf(a, rows);
    const bSequence = sequenceOf(b, rows);
    if (aSequence !== bSequence) return aSequence - bSequence;
  }

  if (field === 'priority') {
    const order = (label: string): number => {
      const index = PLANE_PRIORITIES.indexOf(label.toLowerCase() as (typeof PLANE_PRIORITIES)[number]);
      return index === -1 ? PLANE_PRIORITIES.length : index;
    };

    const difference = order(a.label) - order(b.label);
    if (difference !== 0) return difference;
  }

  return a.label.localeCompare(b.label);
}

function sequenceOf(group: RowGroup, rows: readonly ExportRow[]): number {
  const match = rows.find((row) => row.state === group.label && row.stateSequence !== null);
  return match?.stateSequence ?? Number.MAX_SAFE_INTEGER;
}

function capitalise(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}
