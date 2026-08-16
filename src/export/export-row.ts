import type { MembershipIndex, ProjectLookups } from '../lookup';
import type { PlanePriority, PlaneProject, PlaneStateGroup, PlaneWorkItem } from '../plane';
import { htmlToText } from '../util/html-to-text';

/**
 * A work item flattened into displayable values.
 *
 * Every UUID is already resolved and every timestamp is a real Date, so the workbook layer
 * only has to decide formatting — it never has to look anything up. That separation is what
 * makes both halves testable: rows without Excel, formatting without the API.
 */
export interface ExportRow {
  identifier: string;
  name: string;
  description: string;
  state: string;
  /** Plane's own state colour, reused for the conditional fill. */
  stateColor: string | null;
  stateGroup: PlaneStateGroup | null;
  /**
   * The state's position in the project's own workflow.
   *
   * Kept so that grouping by state can present sections in board order — Backlog, Todo, In
   * Progress, Done — rather than alphabetically, which would put "Done" before "In Progress".
   */
  stateSequence: number | null;
  priority: PlanePriority;
  assignees: string;
  labels: string;
  module: string;
  cycle: string;
  createdAt: Date | null;
  updatedAt: Date | null;
  startDate: Date | null;
  completedAt: Date | null;
  targetDate: Date | null;
  estimate: string;
  createdBy: string;
  link: string;
}

export interface BuildRowsOptions {
  project: PlaneProject;
  lookups: ProjectLookups;
  /** Required only when the module or cycle columns are included. */
  membership?: MembershipIndex;
  /** Absolute URL builder, supplied by the client so the app host stays in one place. */
  workItemUrl: (projectId: string, workItemId: string) => string;
}

export function buildRows(items: readonly PlaneWorkItem[], options: BuildRowsOptions): ExportRow[] {
  return items.map((item) => buildRow(item, options));
}

export function buildRow(item: PlaneWorkItem, options: BuildRowsOptions): ExportRow {
  const { project, lookups, membership } = options;
  const state = lookups.state(item.state);

  const moduleIds = membership?.modulesByWorkItem[item.id] ?? [];
  const cycleId = membership?.cycleByWorkItem[item.id];

  return {
    // Plane shows work items as PROJ-123; sequence_id alone means nothing to a reader.
    identifier: `${project.identifier}-${item.sequence_id}`,
    name: item.name,
    // description_stripped is not exposed by the API, so this is derived. Flattened to a
    // single line: a cell containing newlines renders as one long line in most viewers
    // anyway, and keeps row heights uniform.
    description: htmlToText(item.description_html, { singleLine: true }),
    state: lookups.stateName(item.state),
    stateColor: state?.color ?? null,
    stateGroup: state?.group ?? null,
    stateSequence: state?.sequence ?? null,
    priority: item.priority,
    // Comma separated so the cell reads as a sentence rather than needing to be parsed.
    assignees: lookups.memberNames(item.assignees).join(', '),
    labels: lookups.labelNames(item.labels).join(', '),
    module: moduleIds.map((id) => lookups.moduleName(id)).join(', '),
    cycle: cycleId ? lookups.cycleName(cycleId) : '',
    createdAt: toDate(item.created_at),
    updatedAt: toDate(item.updated_at),
    startDate: toDate(item.start_date),
    completedAt: toDate(item.completed_at),
    targetDate: toDate(item.target_date),
    estimate: lookups.estimateValue(item.estimate_point),
    createdBy: item.created_by ? lookups.memberName(item.created_by) : '',
    link: options.workItemUrl(project.id, item.id),
  };
}

/**
 * Parse a Plane timestamp into a Date.
 *
 * Returns null rather than an Invalid Date so the workbook writes a blank cell — an Invalid
 * Date reaches Excel as the string "Invalid Date", which is worse than nothing.
 */
function toDate(value: string | null): Date | null {
  if (!value) return null;

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
