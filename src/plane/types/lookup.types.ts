import type { IsoDate, IsoDateTime, Uuid } from './common.types';
import type { PlaneStateGroup } from './work-item.types';

/**
 * The lookup tables an export needs in order to turn UUIDs into names.
 *
 * Note the v1.3.0 instance has none of the `*-lite` endpoints added in 1.4.0, so these are
 * the full serializations. That is fine at our scale — tens of rows per project, not thousands.
 */

export interface PlaneState {
  id: Uuid;
  name: string;
  /** Hex colour, e.g. "#ffa500". Reused for the conditional fill in the spreadsheet. */
  color: string;
  group: PlaneStateGroup;
  sequence: number;
  description: string;
  default: boolean;
  project: Uuid;
  workspace: Uuid;
}

export interface PlaneLabel {
  id: Uuid;
  name: string;
  color: string | null;
  description: string;
  parent: Uuid | null;
  sort_order: number;
  project: Uuid;
  workspace: Uuid;
}

/**
 * A project member.
 *
 * Returned by `projects/{id}/members/` as a bare array of users — this endpoint is the one
 * exception to the pagination envelope. `id` here is the user UUID, which is what a work
 * item's `assignees` array contains.
 */
export interface PlaneMember {
  id: Uuid;
  first_name: string;
  last_name: string;
  email: string;
  display_name: string;
  avatar: string | null;
  avatar_url: string | null;
}

/**
 * A Plane module (a grouping of work items within a project).
 *
 * Named PlaneProjectModule rather than PlaneModule so it cannot be confused with — or
 * collide with — the NestJS `PlaneModule` class that both are exported from src/plane.
 */
export interface PlaneProjectModule {
  id: Uuid;
  name: string;
  description: string;
  status: 'backlog' | 'planned' | 'in-progress' | 'paused' | 'completed' | 'cancelled';
  start_date: IsoDate | null;
  target_date: IsoDate | null;
  lead: Uuid | null;
  members: Uuid[];
  archived_at: IsoDateTime | null;
  project: Uuid;
  workspace: Uuid;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface PlaneCycle {
  id: Uuid;
  name: string;
  description: string;
  start_date: IsoDate | null;
  end_date: IsoDate | null;
  owned_by: Uuid | null;
  archived_at: IsoDateTime | null;
  project: Uuid;
  workspace: Uuid;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

/** An estimate system configured on a project, e.g. "Fibonacci" or "T-shirt". */
export interface PlaneEstimate {
  id: Uuid;
  name: string;
  description: string;
  type: string;
  project: Uuid;
  workspace: Uuid;
}

/**
 * One point on an estimate scale.
 *
 * A work item's `estimate_point` is a UUID pointing here, so the displayable value ("3",
 * "M") only exists on this row. Resolving it takes a list of estimates plus one call per
 * estimate — see PlaneApiClient.listEstimatePoints.
 */
export interface PlaneEstimatePoint {
  id: Uuid;
  /** Ordering key within the scale. */
  key: number;
  /** The display value, capped at 20 characters by Plane. */
  value: string;
  description: string;
  estimate: Uuid;
  project: Uuid;
  workspace: Uuid;
}

export interface PlaneProject {
  id: Uuid;
  name: string;
  /** The short key that prefixes work item identifiers, e.g. "PROJ" in PROJ-123. */
  identifier: string;
  description: string;
  network: number;
  archived_at: IsoDateTime | null;
  workspace: Uuid;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}
