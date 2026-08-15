import type { ExportFilter } from '../filter';

/**
 * Describe a filter in plain English for the summary sheet.
 *
 * The point is that a spreadsheet forwarded to somebody else still explains what it contains.
 * "states: In Progress, In Review" is readable; a JSON blob pasted into a cell is not.
 */
export function describeFilter(filter: ExportFilter | undefined): string[] {
  if (!filter) return [];

  const lines: string[] = [];

  list(lines, 'State', filter.states);
  list(lines, 'State group', filter.stateGroups);
  list(lines, 'Assignee', filter.assignees);
  list(lines, 'Label', filter.labels);
  list(lines, 'Module', filter.modules);
  list(lines, 'Cycle', filter.cycles);
  list(lines, 'Priority', filter.priorities);

  range(lines, 'Created', filter.createdBetween);
  range(lines, 'Completed', filter.completedBetween);
  range(lines, 'Updated', filter.updatedBetween);

  if (filter.search?.trim()) lines.push(`Text match: "${filter.search.trim()}"`);

  return lines;
}

function list(lines: string[], label: string, values: readonly string[] | undefined): void {
  if (!values || values.length === 0) return;

  // Spelling out the OR removes any doubt about how multiple values combined.
  const joined = values.length === 1 ? values[0] : `${values.join(' or ')}`;
  lines.push(`${label}: ${joined}`);
}

function range(lines: string[], label: string, value: { from?: string; to?: string } | undefined): void {
  if (!value || (!value.from && !value.to)) return;

  // "Updated in the last 7 days" rather than "Updated on or after 7d": the summary sheet is
  // read by people, and a relative bound is meaningless to them as written.
  if (value.from && !value.to) {
    const relative = describeRelative(value.from);
    lines.push(relative ? `${label} in the ${relative}` : `${label} on or after ${value.from}`);
    return;
  }

  if (value.from && value.to) {
    lines.push(`${label} between ${resolveLabel(value.from)} and ${resolveLabel(value.to)} (inclusive)`);
    return;
  }

  lines.push(`${label} on or before ${resolveLabel(value.to as string)}`);
}

const RELATIVE = /^(\d+)([dw])$/i;

/** "7d" → "last 7 days". Returns null for an absolute date. */
function describeRelative(value: string): string | null {
  const match = RELATIVE.exec(value.trim());
  if (!match) return null;

  const amount = Number(match[1]);
  const unit = match[2]?.toLowerCase() === 'w' ? 'week' : 'day';

  return `last ${amount} ${unit}${amount === 1 ? '' : 's'}`;
}

function resolveLabel(value: string): string {
  const relative = describeRelative(value);
  return relative ? `${value} (${relative})` : value;
}
