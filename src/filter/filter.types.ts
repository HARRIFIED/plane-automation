import type { PlanePriority, PlaneStateGroup, Uuid } from '../plane';

/**
 * A filter as a human writes it: names, emails and dates, never UUIDs.
 *
 * This is the shape that arrives from the CLI or the REST body, and the shape that gets
 * stored as a named preset in step 7. Storing names rather than resolved UUIDs is the point —
 * a preset called "my open bugs" should keep working after a label is recreated, and should
 * be readable in the database by a person.
 *
 * Composition, per the brief: values within one field are OR'd, different fields are AND'd.
 * So `{ states: ['Todo', 'In Progress'], priorities: ['urgent'] }` means
 * "(Todo OR In Progress) AND urgent".
 */
export interface ExportFilter {
  /** State names, e.g. "In Progress". Case-insensitive. */
  states?: string[];
  /** State groups. OR'd together with `states` — both select states. */
  stateGroups?: PlaneStateGroup[];

  /** Email, @handle, full name or first name. `unassigned` selects items with no assignee. */
  assignees?: string[];

  /** Label names. `none` selects unlabelled items. */
  labels?: string[];
  /** Module names. `none` selects items in no module. */
  modules?: string[];
  /** Cycle names. `none` selects items in no cycle. */
  cycles?: string[];

  priorities?: PlanePriority[];

  createdBetween?: DateRange;
  completedBetween?: DateRange;

  /**
   * Last-modified range — the one to reach for in a weekly report.
   *
   * Plane sets `updated_at` when a work item is created and bumps it on every subsequent
   * change, so "updated this week" already covers both halves of "created or moved this week"
   * without needing to OR two separate filters. A ticket created in week 1 and moved in week 3
   * lands in week 3's export, which is what a weekly review wants.
   */
  updatedBetween?: DateRange;

  /** Case-insensitive substring match against name and the stripped description. */
  search?: string;

  // ------------------------------------------------------------- exclusions
  //
  // Exclusions are applied AFTER the inclusive filters above and always win. "Everything
  // started, except Blocked" is one filter plus one exclusion, which is far easier to write
  // than enumerating every state you do want.

  /** State names to drop. Applied after `states` / `stateGroups`. */
  excludeStates?: string[];

  /**
   * Drop any work item whose name or description contains one of these, case-insensitively.
   *
   * The motivating case is machine-generated noise — tickets opened by an AI code reviewer all
   * carrying a marker like "Detected by AI" — which nobody wants in a human progress report.
   * Multiple keywords are OR-ed: matching any one of them excludes the item.
   */
  excludeKeywords?: string[];
}

/**
 * Inclusive on both ends. Either bound may be omitted for an open range.
 *
 * Accepts three forms:
 *  - "YYYY-MM-DD"          — whole day, UTC
 *  - a full ISO timestamp  — used exactly as given
 *  - "7d" / "2w"           — relative: N days or weeks ago, from the start of that day
 *
 * The relative form exists for recurring exports: `{ from: "7d" }` means the same thing every
 * week, so a scheduled weekly export needs no editing.
 */
export interface DateRange {
  from?: string;
  to?: string;
}

/**
 * Sentinel values meaning "the absence of this thing".
 *
 * The brief calls out unassigned and no-cycle specifically, since those are what people
 * actually go looking for. Applied to labels and modules too, for consistency.
 *
 * A real entity with one of these names wins: the sentinel only applies when nothing matched.
 * A label genuinely called "none" is filterable; an imaginary one means "unlabelled".
 */
export const UNASSIGNED_TOKENS = ['unassigned', 'none'] as const;
export const NONE_TOKENS = ['none', 'null'] as const;

/** A filter value that matched nothing in the project. Almost always a typo. */
export interface UnmatchedFilterValue {
  field: keyof ExportFilter;
  value: string;
  /** Suggestions from the project's actual data, when something looks close. */
  didYouMean?: string[];
}

/**
 * A filter with every name turned into ids, ready to run against work items.
 *
 * `undefined` means the dimension is not filtered at all, which is different from an empty
 * set — an empty set would match nothing.
 */
export interface ResolvedFilter {
  stateIds?: ReadonlySet<Uuid>;

  assigneeIds?: ReadonlySet<Uuid>;
  includeUnassigned: boolean;

  labelIds?: ReadonlySet<Uuid>;
  includeUnlabelled: boolean;

  moduleIds?: ReadonlySet<Uuid>;
  includeNoModule: boolean;

  cycleIds?: ReadonlySet<Uuid>;
  includeNoCycle: boolean;

  priorities?: ReadonlySet<PlanePriority>;

  createdRange?: MillisecondRange;
  completedRange?: MillisecondRange;
  updatedRange?: MillisecondRange;

  /** Already lowercased. */
  search?: string;

  excludeStateIds?: ReadonlySet<Uuid>;
  /** Already lowercased. */
  excludeKeywords?: readonly string[];

  /** Values that resolved to nothing. Callers decide whether to warn or refuse. */
  unmatched: UnmatchedFilterValue[];
}

export interface MillisecondRange {
  fromMs?: number;
  toMs?: number;
}

/** True when running this filter needs the module/cycle membership index. */
export function filterNeedsMembership(filter: ExportFilter): boolean {
  return (filter.modules?.length ?? 0) > 0 || (filter.cycles?.length ?? 0) > 0;
}
