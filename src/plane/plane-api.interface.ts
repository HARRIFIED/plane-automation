import type {
  PlaneCycle,
  PlaneEstimatePoint,
  PlaneLabel,
  PlaneMember,
  PlaneProjectModule,
  PlaneProject,
  PlaneState,
  PlaneWorkItem,
  PlaneWorkItemSearchResult,
  PlaneWorkItemUpdate,
  Uuid,
} from './types';

/**
 * The full surface of the Plane client, reads and writes.
 *
 * The write half is declared here but throws PlaneNotImplementedError in the client, per the
 * brief: Phase 2 consumes the same client to move work items between states, so settling the
 * signatures now means Phase 2 adds implementations rather than reshaping the interface. The
 * exporter only ever touches the read half, and knows nothing about Excel in return.
 */
export interface PlaneApi {
  // ---------------------------------------------------------------- reads

  listProjects(): Promise<PlaneProject[]>;
  getProject(projectId: Uuid): Promise<PlaneProject>;

  /** Full work item set for a project, paged to exhaustion. */
  listAllWorkItems(projectId: Uuid): Promise<PlaneWorkItem[]>;
  getWorkItem(projectId: Uuid, workItemId: Uuid): Promise<PlaneWorkItem>;

  /**
   * Resolve a human identifier such as "PROJ-123".
   *
   * Workspace scoped, so the project UUID is not needed. This is what makes the local
   * identifier index table planned for Phase 2 unnecessary.
   */
  getWorkItemByIdentifier(identifier: string): Promise<PlaneWorkItem>;

  /** Text search over name, sequence id and project identifier. Capped by `limit`. */
  searchWorkItems(query: string, options?: { projectId?: Uuid; limit?: number }): Promise<PlaneWorkItemSearchResult[]>;

  listStates(projectId: Uuid): Promise<PlaneState[]>;
  /** Flattened across estimate scales; a work item's estimate_point resolves against these. */
  listEstimatePoints(projectId: Uuid): Promise<PlaneEstimatePoint[]>;
  listLabels(projectId: Uuid): Promise<PlaneLabel[]>;
  listMembers(projectId: Uuid): Promise<PlaneMember[]>;
  listModules(projectId: Uuid): Promise<PlaneProjectModule[]>; 
  listCycles(projectId: Uuid): Promise<PlaneCycle[]>;

  /**
   * Work item ids belonging to a module.
   *
   * Membership is not on the work item payload, so it has to be read from this direction.
   * Returns ids only — the full rows come from listAllWorkItems.
   */
  listModuleWorkItemIds(projectId: Uuid, moduleId: Uuid): Promise<Uuid[]>;
  listCycleWorkItemIds(projectId: Uuid, cycleId: Uuid): Promise<Uuid[]>;

  /** Web URL for a work item, for the spreadsheet's link column. */
  workItemUrl(projectId: Uuid, workItemId: Uuid): string;

  // ------------------------------------------------- writes (Phase 2, unimplemented)

  updateWorkItem(projectId: Uuid, workItemId: Uuid, patch: PlaneWorkItemUpdate): Promise<PlaneWorkItem>;

  /** Convenience wrapper over updateWorkItem for the merge-driven transitions. */
  transitionWorkItemState(projectId: Uuid, workItemId: Uuid, stateId: Uuid): Promise<PlaneWorkItem>;
}
