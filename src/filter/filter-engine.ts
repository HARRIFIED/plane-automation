import type { MembershipIndex } from '../lookup';
import type { PlaneWorkItem, Uuid } from '../plane';
import { htmlToText } from '../util/html-to-text';
import type { MillisecondRange, ResolvedFilter } from './filter.types';

export interface FilterContext {
  /**
   * Required only when the filter touches modules or cycles, because membership is not on
   * the work item payload. Omitting it while filtering on either is a programming error
   * rather than an empty result — see the throw below.
   */
  membership?: MembershipIndex;
}

/**
 * Apply a resolved filter to a set of work items.
 *
 * Values within a dimension are OR'd, dimensions are AND'd. A dimension left undefined is not
 * a constraint at all, so an unfiltered export returns everything.
 *
 * Pure and synchronous: everything it needs was fetched before it ran. That is what makes the
 * fetch-everything-then-filter strategy cheap — the filtering itself costs no API calls, so
 * ten different filter combinations over one project cost one pull, not ten.
 */
export function applyFilter(
  items: readonly PlaneWorkItem[],
  filter: ResolvedFilter,
  context: FilterContext = {},
): PlaneWorkItem[] {
  const needsMembership = filter.moduleIds || filter.includeNoModule || filter.cycleIds || filter.includeNoCycle;

  if (needsMembership && !context.membership) {
    throw new Error(
      'This filter references modules or cycles, but no membership index was supplied. ' +
        'Load it with LookupService.getMembership() first — see filterNeedsMembership().',
    );
  }

  return items.filter((item) => matches(item, filter, context));
}

function matches(item: PlaneWorkItem, filter: ResolvedFilter, context: FilterContext): boolean {
  if (filter.stateIds && !(item.state && filter.stateIds.has(item.state))) return false;

  if (!matchesAssignees(item, filter)) return false;
  if (!matchesLabels(item, filter)) return false;
  if (!matchesModules(item, filter, context)) return false;
  if (!matchesCycle(item, filter, context)) return false;

  if (filter.priorities && !filter.priorities.has(item.priority)) return false;

  if (!inRange(item.created_at, filter.createdRange)) return false;
  if (!inRange(item.completed_at, filter.completedRange)) return false;
  if (!inRange(item.updated_at, filter.updatedRange)) return false;

  // Exclusions run last and always win: "everything started, except Blocked".
  if (filter.excludeStateIds && item.state && filter.excludeStateIds.has(item.state)) return false;

  if (filter.search || filter.excludeKeywords) {
    // Stripping the description is the one expensive step here, so it happens once and only
    // when a text filter is actually in play.
    const haystack = searchableText(item);

    if (filter.search && !haystack.includes(filter.search)) return false;
    if (filter.excludeKeywords?.some((keyword) => haystack.includes(keyword))) return false;
  }

  return true;
}

/**
 * Assignees, with explicit support for unassigned.
 *
 * `assignees: ['unassigned', 'ada@…']` reads as "unassigned OR Ada", so the two combine
 * rather than the sentinel overriding the names.
 */
function matchesAssignees(item: PlaneWorkItem, filter: ResolvedFilter): boolean {
  if (!filter.assigneeIds && !filter.includeUnassigned) return true;

  if (filter.includeUnassigned && item.assignees.length === 0) return true;
  if (!filter.assigneeIds) return false;

  return item.assignees.some((id) => filter.assigneeIds?.has(id));
}

function matchesLabels(item: PlaneWorkItem, filter: ResolvedFilter): boolean {
  if (!filter.labelIds && !filter.includeUnlabelled) return true;

  if (filter.includeUnlabelled && item.labels.length === 0) return true;
  if (!filter.labelIds) return false;

  return item.labels.some((id) => filter.labelIds?.has(id));
}

function matchesModules(item: PlaneWorkItem, filter: ResolvedFilter, context: FilterContext): boolean {
  if (!filter.moduleIds && !filter.includeNoModule) return true;

  const moduleIds: Uuid[] = context.membership?.modulesByWorkItem[item.id] ?? [];

  if (filter.includeNoModule && moduleIds.length === 0) return true;
  if (!filter.moduleIds) return false;

  return moduleIds.some((id) => filter.moduleIds?.has(id));
}

function matchesCycle(item: PlaneWorkItem, filter: ResolvedFilter, context: FilterContext): boolean {
  if (!filter.cycleIds && !filter.includeNoCycle) return true;

  const cycleId = context.membership?.cycleByWorkItem[item.id];

  if (filter.includeNoCycle && !cycleId) return true;
  if (!filter.cycleIds || !cycleId) return false;

  return filter.cycleIds.has(cycleId);
}

/**
 * Inclusive range check.
 *
 * A null timestamp never matches a range: an item that was never completed is not "completed
 * between the 1st and the 9th", so the completed-date filter doubles as "only finished work".
 */
function inRange(timestamp: string | null, range: MillisecondRange | undefined): boolean {
  if (!range) return true;
  if (!timestamp) return false;

  const value = Date.parse(timestamp);
  if (!Number.isFinite(value)) return false;

  if (range.fromMs !== undefined && value < range.fromMs) return false;
  if (range.toMs !== undefined && value > range.toMs) return false;

  return true;
}

/**
 * Name plus stripped description, lowercased — the text both `search` and `excludeKeywords`
 * match against.
 *
 * Markup is stripped first, so a search for "strong" does not match `<strong>`, and an
 * exclusion for a phrase spanning inline formatting still matches.
 */
function searchableText(item: PlaneWorkItem): string {
  const description = htmlToText(item.description_html, { singleLine: true });
  return `${item.name}\n${description}`.toLowerCase();
}
