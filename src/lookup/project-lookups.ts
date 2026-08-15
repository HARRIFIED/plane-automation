import type {
  PlaneCycle,
  PlaneEstimatePoint,
  PlaneLabel,
  PlaneMember,
  PlaneProjectModule,
  PlaneState,
  PlaneStateGroup,
  Uuid,
} from '../plane';

/**
 * The raw lookup tables for one project, exactly as fetched.
 *
 * This is the shape that goes into the cache: plain arrays, because Maps do not survive
 * JSON serialisation. ProjectLookups builds the indexes on the way out.
 */
export interface ProjectLookupTables {
  projectId: Uuid;
  states: PlaneState[];
  labels: PlaneLabel[];
  members: PlaneMember[];
  modules: PlaneProjectModule[];
  cycles: PlaneCycle[];
  /** Flattened across estimate scales. Empty when the project uses no estimates. */
  estimatePoints: PlaneEstimatePoint[];
  /** When these tables were pulled from Plane. Shown on the export's summary sheet. */
  fetchedAt: string;
}

/**
 * Which modules and cycles each work item belongs to.
 *
 * Built separately and lazily: neither is a field on a work item, so this costs one request
 * per module and per cycle. Only worth paying when the export actually uses those columns
 * or filters. See docs/plane-api-findings.md §2.2.
 */
export interface MembershipIndex {
  /** Work item id → module ids. An item can be in several modules. */
  modulesByWorkItem: Record<Uuid, Uuid[]>;
  /** Work item id → cycle id. The data model allows at most one. */
  cycleByWorkItem: Record<Uuid, Uuid>;
  fetchedAt: string;
}

/** How an unresolvable UUID is rendered. Never leave a bare UUID in a spreadsheet. */
function unknown(kind: string, id: Uuid): string {
  return `Unknown ${kind} (${id.slice(0, 8)})`;
}

/**
 * Indexed, queryable view over a project's lookup tables.
 *
 * Two jobs: turn UUIDs into names for the export, and turn names back into UUIDs for the
 * filter engine, which receives human input like "In Progress" or "ada@example.com".
 *
 * On unresolvable ids — these happen routinely and are not bugs. `projects/{id}/members/`
 * returns *current* members, but a work item keeps its assignee reference after someone
 * leaves the project, and the same goes for a label or module deleted after the fact. Every
 * resolver therefore degrades to a readable placeholder rather than `undefined`, and
 * `unresolved()` reports what could not be matched so the summary sheet can say so.
 */
export class ProjectLookups {
  readonly projectId: Uuid;
  readonly fetchedAt: string;

  private readonly statesById: Map<Uuid, PlaneState>;
  private readonly labelsById: Map<Uuid, PlaneLabel>;
  private readonly membersById: Map<Uuid, PlaneMember>;
  private readonly modulesById: Map<Uuid, PlaneProjectModule>;
  private readonly cyclesById: Map<Uuid, PlaneCycle>;
  private readonly estimatePointsById: Map<Uuid, PlaneEstimatePoint>;

  /** Ids we were asked to resolve and could not, by kind. */
  private readonly missing = new Map<string, Set<Uuid>>();

  constructor(private readonly tables: ProjectLookupTables) {
    this.projectId = tables.projectId;
    this.fetchedAt = tables.fetchedAt;

    this.statesById = index(tables.states);
    this.labelsById = index(tables.labels);
    this.membersById = index(tables.members);
    this.modulesById = index(tables.modules);
    this.cyclesById = index(tables.cycles);
    // Tolerate an older cached entry that predates this table rather than throwing.
    this.estimatePointsById = index(tables.estimatePoints ?? []);
  }

  // ------------------------------------------------------------- raw tables

  get states(): readonly PlaneState[] {
    return this.tables.states;
  }

  get labels(): readonly PlaneLabel[] {
    return this.tables.labels;
  }

  get members(): readonly PlaneMember[] {
    return this.tables.members;
  }

  get modules(): readonly PlaneProjectModule[] {
    return this.tables.modules;
  }

  get cycles(): readonly PlaneCycle[] {
    return this.tables.cycles;
  }

  // ------------------------------------------------------- UUID → human name

  stateName(id: Uuid | null): string {
    if (!id) return '';
    const state = this.statesById.get(id);
    if (!state) return this.miss('state', id);
    return state.name;
  }

  stateGroup(id: Uuid | null): PlaneStateGroup | null {
    if (!id) return null;
    return this.statesById.get(id)?.group ?? null;
  }

  state(id: Uuid | null): PlaneState | undefined {
    return id ? this.statesById.get(id) : undefined;
  }

  /**
   * Display name for a person.
   *
   * Prefers the full name; falls back to Plane's display_name (the @handle) and then the
   * email, because first_name and last_name are both optional on a Plane account.
   */
  memberName(id: Uuid): string {
    const member = this.membersById.get(id);
    if (!member) return this.miss('user', id);
    return ProjectLookups.nameOf(member);
  }

  static nameOf(member: PlaneMember): string {
    const fullName = [member.first_name, member.last_name].filter(Boolean).join(' ').trim();
    return fullName || member.display_name || member.email;
  }

  labelName(id: Uuid): string {
    const label = this.labelsById.get(id);
    if (!label) return this.miss('label', id);
    return label.name;
  }

  moduleName(id: Uuid): string {
    const module = this.modulesById.get(id);
    if (!module) return this.miss('module', id);
    return module.name;
  }

  /**
   * The displayable estimate, e.g. "3" or "M".
   *
   * Unlike the other resolvers this returns an empty string for an unknown id rather than a
   * placeholder: an estimate scale that has been reconfigured leaves stale references behind,
   * and "Unknown estimate (a1b2c3d4)" in a numeric column is worse than a blank cell.
   */
  estimateValue(id: Uuid | null): string {
    if (!id) return '';
    return this.estimatePointsById.get(id)?.value ?? '';
  }

  cycleName(id: Uuid): string {
    const cycle = this.cyclesById.get(id);
    if (!cycle) return this.miss('cycle', id);
    return cycle.name;
  }

  memberNames(ids: readonly Uuid[]): string[] {
    return ids.map((id) => this.memberName(id));
  }

  labelNames(ids: readonly Uuid[]): string[] {
    return ids.map((id) => this.labelName(id));
  }

  // ------------------------------------------------- human input → UUID(s)

  /** Case-insensitive exact match on state name. */
  findStatesByName(name: string): PlaneState[] {
    const needle = normalise(name);
    return this.tables.states.filter((state) => normalise(state.name) === needle);
  }

  /** Every state in a group, for filters like "everything still in backlog". */
  findStatesByGroup(group: PlaneStateGroup): PlaneState[] {
    return this.tables.states.filter((state) => state.group === group);
  }

  findLabelsByName(name: string): PlaneLabel[] {
    const needle = normalise(name);
    return this.tables.labels.filter((label) => normalise(label.name) === needle);
  }

  findModulesByName(name: string): PlaneProjectModule[] {
    const needle = normalise(name);
    return this.tables.modules.filter((module) => normalise(module.name) === needle);
  }

  findCyclesByName(name: string): PlaneCycle[] {
    const needle = normalise(name);
    return this.tables.cycles.filter((cycle) => normalise(cycle.name) === needle);
  }

  /**
   * Match a person by anything a human would reasonably type: email, @handle, full name,
   * or first name alone. Ambiguity is returned rather than guessed at — the caller decides
   * whether two matches is an error or a wider filter.
   */
  findMembers(query: string): PlaneMember[] {
    const needle = normalise(query);

    return this.tables.members.filter((member) => {
      const fullName = normalise(ProjectLookups.nameOf(member));
      return (
        normalise(member.email) === needle ||
        normalise(member.display_name) === needle ||
        fullName === needle ||
        normalise(member.first_name) === needle
      );
    });
  }

  /** True when the id belongs to a current project member. */
  isKnownMember(id: Uuid): boolean {
    return this.membersById.has(id);
  }

  // ------------------------------------------------------------ diagnostics

  /**
   * Ids that could not be resolved, grouped by kind.
   *
   * Populated as a side effect of resolving, so call it after building the rows. Feeds the
   * summary sheet: "3 assignees are no longer members of this project" is useful; a cell
   * reading "Unknown user (a1b2c3d4)" with no explanation is not.
   */
  unresolved(): Record<string, Uuid[]> {
    const result: Record<string, Uuid[]> = {};
    for (const [kind, ids] of this.missing) {
      result[kind] = [...ids];
    }
    return result;
  }

  hasUnresolved(): boolean {
    return this.missing.size > 0;
  }

  private miss(kind: string, id: Uuid): string {
    let ids = this.missing.get(kind);
    if (!ids) {
      ids = new Set();
      this.missing.set(kind, ids);
    }
    ids.add(id);

    return unknown(kind, id);
  }
}

function index<T extends { id: Uuid }>(rows: readonly T[]): Map<Uuid, T> {
  return new Map(rows.map((row) => [row.id, row]));
}

function normalise(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}
