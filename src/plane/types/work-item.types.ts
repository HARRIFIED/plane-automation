import type { IsoDate, IsoDateTime, Uuid } from './common.types';

export const PLANE_PRIORITIES = ['urgent', 'high', 'medium', 'low', 'none'] as const;
export type PlanePriority = (typeof PLANE_PRIORITIES)[number];

/**
 * Fixed set from the server's StateGroup enum.
 *
 * `triage` is included for completeness but never appears in list results — the default
 * queryset filters triage items out. See docs/plane-api-findings.md §3.2.
 */
export const PLANE_STATE_GROUPS = [
  'backlog',
  'unstarted',
  'started',
  'completed',
  'cancelled',
  'triage',
] as const;
export type PlaneStateGroup = (typeof PLANE_STATE_GROUPS)[number];

/** Groups that can actually appear in an export, i.e. everything the API will hand us. */
export const EXPORTABLE_STATE_GROUPS = PLANE_STATE_GROUPS.filter(
  (group): group is Exclude<PlaneStateGroup, 'triage'> => group !== 'triage',
);

/**
 * A work item exactly as v1.3.0 serializes it.
 *
 * Two absences that matter and are not oversights:
 *
 *  - `description_stripped` is a real database column but the serializer explicitly
 *    excludes it, so plain text has to be derived from `description_html` on our side.
 *  - There is no `module` or `cycle` field. Membership is only readable in reverse, via
 *    modules/{id}/module-issues/ and cycles/{id}/cycle-issues/.
 *
 * Both are documented in docs/plane-api-findings.md §2.1 and §2.2.
 */
export interface PlaneWorkItem {
  id: Uuid;
  name: string;
  /** Rich text markup. Defaults to "<p></p>" rather than empty when there is no description. */
  description_html: string | null;
  priority: PlanePriority;
  /** Numeric part of the human identifier: sequence_id 123 in project PROJ is "PROJ-123". */
  sequence_id: number;
  sort_order: number;

  /** State UUID. Resolve against the project's state table. */
  state: Uuid | null;
  /** User UUIDs. Always an array — empty means unassigned, never null. */
  assignees: Uuid[];
  /** Label UUIDs. Always an array. */
  labels: Uuid[];
  parent: Uuid | null;

  project: Uuid;
  workspace: Uuid;

  /** EstimatePoint UUID, not the estimate's value. Resolve if the column is wanted. */
  estimate_point: Uuid | null;
  /** Legacy numeric estimate, superseded by estimate_point. Usually null. */
  point: number | null;

  start_date: IsoDate | null;
  target_date: IsoDate | null;
  completed_at: IsoDateTime | null;
  archived_at: IsoDate | null;
  is_draft: boolean;

  created_at: IsoDateTime;
  updated_at: IsoDateTime;
  created_by: Uuid | null;
  updated_by: Uuid | null;

  external_source: string | null;
  external_id: string | null;
  type_id?: Uuid | null;
}

/** Trimmed row returned by the text search endpoint. Not the same shape as a work item. */
export interface PlaneWorkItemSearchResult {
  id: Uuid;
  name: string;
  sequence_id: number;
  project_id: Uuid;
  project__identifier: string;
  workspace__slug: string;
}

/** Fields the update endpoint accepts. Phase 2 only needs `state`. */
export interface PlaneWorkItemUpdate {
  state?: Uuid;
  name?: string;
  priority?: PlanePriority;
  assignees?: Uuid[];
  labels?: Uuid[];
  target_date?: IsoDate | null;
  start_date?: IsoDate | null;
}
