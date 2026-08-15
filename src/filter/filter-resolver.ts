import type { ProjectLookups } from '../lookup';
import { PLANE_PRIORITIES } from '../plane';
import type { PlanePriority, Uuid } from '../plane';
import { NONE_TOKENS, UNASSIGNED_TOKENS } from './filter.types';
import type {
  DateRange,
  ExportFilter,
  MillisecondRange,
  ResolvedFilter,
  UnmatchedFilterValue,
} from './filter.types';

/**
 * Turn a human-written filter into ids.
 *
 * Nothing here throws on a value that matches nothing. A typo like "In Progres" would
 * otherwise produce an empty export that looks exactly like "no work matches", which is the
 * worst possible failure for a reporting tool — it is indistinguishable from a true answer.
 * Instead every miss is collected in `unmatched`, with suggestions, and the caller decides
 * whether to refuse the export or warn on the summary sheet.
 */
export function resolveFilter(filter: ExportFilter, lookups: ProjectLookups): ResolvedFilter {
  const unmatched: UnmatchedFilterValue[] = [];

  const stateIds = resolveStates(filter, lookups, unmatched);
  const assignees = resolveAssignees(filter, lookups, unmatched);
  const labels = resolveLabels(filter, lookups, unmatched);
  const modules = resolveModules(filter, lookups, unmatched);
  const cycles = resolveCycles(filter, lookups, unmatched);

  return {
    stateIds,
    assigneeIds: assignees.ids,
    includeUnassigned: assignees.includeAbsent,
    labelIds: labels.ids,
    includeUnlabelled: labels.includeAbsent,
    moduleIds: modules.ids,
    includeNoModule: modules.includeAbsent,
    cycleIds: cycles.ids,
    includeNoCycle: cycles.includeAbsent,
    priorities: resolvePriorities(filter, unmatched),
    createdRange: resolveRange(filter.createdBetween, 'createdBetween', unmatched),
    completedRange: resolveRange(filter.completedBetween, 'completedBetween', unmatched),
    updatedRange: resolveRange(filter.updatedBetween, 'updatedBetween', unmatched),
    search: filter.search?.trim() ? filter.search.trim().toLowerCase() : undefined,
    unmatched,
  };
}

/** Convenience for callers that want unmatched values to be a hard error. */
export function assertNoUnmatched(resolved: ResolvedFilter): void {
  if (resolved.unmatched.length === 0) return;

  const details = resolved.unmatched
    .map((miss) => {
      const suggestion = miss.didYouMean?.length ? ` — did you mean ${miss.didYouMean.join(', ')}?` : '';
      return `  - ${miss.field}: "${miss.value}" matched nothing in this project${suggestion}`;
    })
    .join('\n');

  throw new Error(`Filter refers to values that do not exist:\n${details}`);
}

// ----------------------------------------------------------------- dimensions

/**
 * States by name and by group, OR'd into one set.
 *
 * Both select states, so they are one dimension rather than two AND'd conditions —
 * `states: ['Done'], stateGroups: ['started']` means "Done or anything in progress".
 */
function resolveStates(
  filter: ExportFilter,
  lookups: ProjectLookups,
  unmatched: UnmatchedFilterValue[],
): Set<Uuid> | undefined {
  const names = filter.states ?? [];
  const groups = filter.stateGroups ?? [];
  if (names.length === 0 && groups.length === 0) return undefined;

  const ids = new Set<Uuid>();

  for (const name of names) {
    const matches = lookups.findStatesByName(name);
    if (matches.length === 0) {
      unmatched.push({
        field: 'states',
        value: name,
        didYouMean: suggest(name, lookups.states.map((state) => state.name)),
      });
      continue;
    }
    for (const match of matches) ids.add(match.id);
  }

  for (const group of groups) {
    const matches = lookups.findStatesByGroup(group);
    if (matches.length === 0) {
      // Not necessarily a typo: a project may simply have no cancelled states.
      unmatched.push({ field: 'stateGroups', value: group });
      continue;
    }
    for (const match of matches) ids.add(match.id);
  }

  return ids;
}

interface AbsenceAware {
  ids?: Set<Uuid>;
  includeAbsent: boolean;
}

function resolveAssignees(
  filter: ExportFilter,
  lookups: ProjectLookups,
  unmatched: UnmatchedFilterValue[],
): AbsenceAware {
  return resolveWithAbsence(filter.assignees, {
    field: 'assignees',
    absenceTokens: UNASSIGNED_TOKENS,
    find: (value) => lookups.findMembers(value).map((member) => member.id),
    candidates: () => lookups.members.map((member) => member.email || member.display_name),
    unmatched,
  });
}

function resolveLabels(filter: ExportFilter, lookups: ProjectLookups, unmatched: UnmatchedFilterValue[]): AbsenceAware {
  return resolveWithAbsence(filter.labels, {
    field: 'labels',
    absenceTokens: NONE_TOKENS,
    find: (value) => lookups.findLabelsByName(value).map((label) => label.id),
    candidates: () => lookups.labels.map((label) => label.name),
    unmatched,
  });
}

function resolveModules(
  filter: ExportFilter,
  lookups: ProjectLookups,
  unmatched: UnmatchedFilterValue[],
): AbsenceAware {
  return resolveWithAbsence(filter.modules, {
    field: 'modules',
    absenceTokens: NONE_TOKENS,
    find: (value) => lookups.findModulesByName(value).map((module) => module.id),
    candidates: () => lookups.modules.map((module) => module.name),
    unmatched,
  });
}

function resolveCycles(filter: ExportFilter, lookups: ProjectLookups, unmatched: UnmatchedFilterValue[]): AbsenceAware {
  return resolveWithAbsence(filter.cycles, {
    field: 'cycles',
    absenceTokens: NONE_TOKENS,
    find: (value) => lookups.findCyclesByName(value).map((cycle) => cycle.id),
    candidates: () => lookups.cycles.map((cycle) => cycle.name),
    unmatched,
  });
}

interface AbsenceResolution {
  field: keyof ExportFilter;
  absenceTokens: readonly string[];
  find: (value: string) => Uuid[];
  candidates: () => string[];
  unmatched: UnmatchedFilterValue[];
}

/**
 * Shared resolution for the dimensions that support an "absent" sentinel.
 *
 * Order matters: a real entity always wins over the sentinel, so a label actually named
 * "none" stays filterable and only an imaginary one means "unlabelled".
 */
function resolveWithAbsence(values: string[] | undefined, options: AbsenceResolution): AbsenceAware {
  if (!values || values.length === 0) return { includeAbsent: false };

  const ids = new Set<Uuid>();
  let includeAbsent = false;

  for (const value of values) {
    const matches = options.find(value);
    if (matches.length > 0) {
      for (const id of matches) ids.add(id);
      continue;
    }

    if (options.absenceTokens.includes(value.trim().toLowerCase())) {
      includeAbsent = true;
      continue;
    }

    options.unmatched.push({
      field: options.field,
      value,
      didYouMean: suggest(value, options.candidates()),
    });
  }

  // An empty set with includeAbsent set is meaningful ("only unassigned"), so return
  // undefined for the ids only when there are genuinely no id constraints at all.
  return { ids: ids.size > 0 ? ids : undefined, includeAbsent };
}

function resolvePriorities(
  filter: ExportFilter,
  unmatched: UnmatchedFilterValue[],
): Set<PlanePriority> | undefined {
  if (!filter.priorities || filter.priorities.length === 0) return undefined;

  const priorities = new Set<PlanePriority>();

  for (const priority of filter.priorities) {
    const normalised = String(priority).trim().toLowerCase() as PlanePriority;

    if (!PLANE_PRIORITIES.includes(normalised)) {
      unmatched.push({
        field: 'priorities',
        value: String(priority),
        didYouMean: [...PLANE_PRIORITIES],
      });
      continue;
    }

    priorities.add(normalised);
  }

  return priorities;
}

// ---------------------------------------------------------------------- dates

/**
 * Parse a date range to millisecond bounds.
 *
 * A date-only bound covers the whole day: "2026-08-09" as `from` starts at 00:00:00.000 and
 * as `to` ends at 23:59:59.999, because "completed between the 1st and the 9th" obviously
 * includes work finished on the afternoon of the 9th.
 *
 * Bounds are interpreted in UTC, matching the timestamps Plane returns. For a team an hour or
 * two off UTC this can put late-evening work on the following day; if that starts to matter,
 * this is the single place to introduce a configurable export timezone.
 */
function resolveRange(
  range: DateRange | undefined,
  field: keyof ExportFilter,
  unmatched: UnmatchedFilterValue[],
): MillisecondRange | undefined {
  if (!range || (!range.from && !range.to)) return undefined;

  const fromMs = parseBound(range.from, 'start', field, unmatched);
  const toMs = parseBound(range.to, 'end', field, unmatched);

  if (fromMs === undefined && toMs === undefined) return undefined;

  if (fromMs !== undefined && toMs !== undefined && fromMs > toMs) {
    unmatched.push({ field, value: `${range.from} to ${range.to} (start is after end)` });
    return undefined;
  }

  return { fromMs, toMs };
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
/** "7d" or "2w" — N days or weeks ago. */
const RELATIVE = /^(\d+)([dw])$/i;

function parseBound(
  value: string | undefined,
  edge: 'start' | 'end',
  field: keyof ExportFilter,
  unmatched: UnmatchedFilterValue[],
  now: Date = new Date(),
): number | undefined {
  if (!value) return undefined;

  const trimmed = value.trim();

  const relative = RELATIVE.exec(trimmed);
  if (relative) {
    const amount = Number(relative[1]);
    const days = relative[2]?.toLowerCase() === 'w' ? amount * 7 : amount;

    // Snapped to a day boundary rather than "exactly N×24h ago", so a weekly export run on
    // Monday morning covers whole days and does not clip work by however late it ran.
    const target = new Date(now.getTime() - days * 86_400_000);
    const day = target.toISOString().slice(0, 10);

    return Date.parse(`${day}T${edge === 'start' ? '00:00:00.000' : '23:59:59.999'}Z`);
  }

  const iso = DATE_ONLY.test(trimmed)
    ? `${trimmed}T${edge === 'start' ? '00:00:00.000' : '23:59:59.999'}Z`
    : trimmed;

  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) {
    unmatched.push({ field, value: `${value} (not a valid date)` });
    return undefined;
  }

  return parsed;
}

// ----------------------------------------------------------------- suggestions

/**
 * Cheap "did you mean" for a mistyped filter value.
 *
 * Substring containment in either direction, which catches the realistic mistakes —
 * "progress" for "In Progress", "Ada" for "ada@…" — without the weight of edit distance.
 */
function suggest(value: string, candidates: string[]): string[] | undefined {
  const needle = value.trim().toLowerCase();
  if (!needle) return undefined;

  const hits = candidates
    .filter((candidate) => {
      const other = candidate.trim().toLowerCase();
      return other.includes(needle) || needle.includes(other);
    })
    .slice(0, 3);

  return hits.length > 0 ? hits : undefined;
}
