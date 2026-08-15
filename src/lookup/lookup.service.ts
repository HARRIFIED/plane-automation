import { Inject, Injectable, Logger } from '@nestjs/common';

import { CACHE_STORE } from '../cache';
import type { CacheStore } from '../cache';
import { AppConfigService } from '../config';
import { PlaneApiClient } from '../plane';
import type { Uuid } from '../plane';
import { ProjectLookups } from './project-lookups';
import type { MembershipIndex, ProjectLookupTables } from './project-lookups';

/**
 * Bumped whenever the cached shape changes, so a deploy cannot read an old entry into a new
 * structure. Cheaper and less error-prone than a migration for data with a five minute TTL.
 */
const CACHE_SCHEMA_VERSION = 'v2';

export interface LookupOptions {
  /** Skip the cache and re-fetch from Plane. Exposed to callers per the brief. */
  forceRefresh?: boolean;
}

/**
 * Loads and caches the per-project lookup tables that turn UUIDs into names.
 *
 * Two independently cached things, because they cost wildly different amounts:
 *
 *  - The lookup tables (states, labels, members, modules, cycles) are five requests, always
 *    loaded before an export runs.
 *  - The membership index is one request per module plus one per cycle, and is only built
 *    when the export actually needs the module or cycle column. On a project with a dozen
 *    modules that is the difference between 5 requests and 25 against a 60/minute budget.
 */
@Injectable()
export class LookupService {
  private readonly logger = new Logger(LookupService.name);

  /**
   * In-flight loads, keyed by cache key.
   *
   * Without this, exporting five projects that share a lookup, or two people requesting the
   * same export at once, would each miss the cache and fetch the same tables concurrently —
   * multiplying requests against the rate limit for identical data.
   */
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(
    private readonly plane: PlaneApiClient,
    private readonly config: AppConfigService,
    @Inject(CACHE_STORE) private readonly cache: CacheStore,
  ) {}

  /** Lookup tables for a project, from cache when warm. */
  async getLookups(projectId: Uuid, options: LookupOptions = {}): Promise<ProjectLookups> {
    const key = this.lookupKey(projectId);

    const tables = await this.loadCached<ProjectLookupTables>(
      key,
      options.forceRefresh ?? false,
      () => this.fetchLookupTables(projectId),
      `lookup tables for project ${projectId}`,
    );

    // A fresh ProjectLookups per call: it accumulates unresolved ids as a side effect of
    // resolving, and that tally belongs to one export, not to the cached snapshot.
    return new ProjectLookups(tables);
  }

  /**
   * Module and cycle membership for a project.
   *
   * Call only when the export needs it — see the cost note on the class.
   */
  async getMembership(projectId: Uuid, options: LookupOptions = {}): Promise<MembershipIndex> {
    const key = this.membershipKey(projectId);

    return this.loadCached<MembershipIndex>(
      key,
      options.forceRefresh ?? false,
      () => this.fetchMembershipIndex(projectId, options),
      `membership index for project ${projectId}`,
    );
  }

  /** Drop both cached entries for a project. */
  async invalidate(projectId: Uuid): Promise<void> {
    await Promise.all([
      this.cache.delete(this.lookupKey(projectId)),
      this.cache.delete(this.membershipKey(projectId)),
    ]);
    this.logger.log(`Invalidated cached lookups for project ${projectId}`);
  }

  // --------------------------------------------------------------- internals

  private async loadCached<T>(
    key: string,
    forceRefresh: boolean,
    fetch: () => Promise<T>,
    description: string,
  ): Promise<T> {
    if (!forceRefresh) {
      const cached = await this.cache.get<T>(key);
      if (cached) {
        this.logger.debug(`Cache hit for ${description}`);
        return cached;
      }

      // Join an identical load already running rather than starting a second one.
      const pending = this.inFlight.get(key) as Promise<T> | undefined;
      if (pending) {
        this.logger.debug(`Joining in-flight load of ${description}`);
        return pending;
      }
    }

    const load = (async () => {
      const value = await fetch();
      await this.cache.set(key, value, this.config.lookupCacheTtlSeconds);
      return value;
    })();

    this.inFlight.set(key, load);

    try {
      return await load;
    } finally {
      // Always clear, including on failure, so one error does not poison later attempts.
      this.inFlight.delete(key);
    }
  }

  private async fetchLookupTables(projectId: Uuid): Promise<ProjectLookupTables> {
    this.logger.debug(`Fetching lookup tables for project ${projectId}`);

    // Issued together; the client's throttle serialises them under the rate limit anyway.
    const [states, labels, members, modules, cycles, estimatePoints] = await Promise.all([
      this.plane.listStates(projectId),
      this.plane.listLabels(projectId),
      this.plane.listMembers(projectId),
      this.plane.listModules(projectId),
      this.plane.listCycles(projectId),
      // Estimates are the one optional table: the column is blank without them, whereas a
      // missing state or member table would put wrong names in every row. So this one degrades
      // instead of failing the export. (A project with no estimate scale 404s, which the client
      // already treats as empty — this catch is for anything worse than that.)
      this.plane.listEstimatePoints(projectId).catch((error: unknown) => {
        const reason = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Could not load estimate points for project ${projectId}; column will be empty: ${reason}`);
        return [];
      }),
    ]);

    this.logger.log(
      `Loaded lookups for project ${projectId}: ${states.length} states, ${labels.length} labels, ` +
        `${members.length} members, ${modules.length} modules, ${cycles.length} cycles, ` +
        `${estimatePoints.length} estimate points`,
    );

    return {
      projectId,
      states,
      labels,
      members,
      modules,
      cycles,
      estimatePoints,
      fetchedAt: new Date().toISOString(),
    };
  }

  /**
   * Build the work-item → module/cycle index.
   *
   * Reads membership from the module and cycle side because a work item does not carry it.
   * Sequential rather than parallel: these are the most numerous calls we make, and letting
   * them queue on the throttle keeps a big project's export from monopolising the budget in
   * one burst.
   */
  private async fetchMembershipIndex(projectId: Uuid, options: LookupOptions): Promise<MembershipIndex> {
    const lookups = await this.getLookups(projectId, options);

    const modulesByWorkItem: Record<Uuid, Uuid[]> = {};
    const cycleByWorkItem: Record<Uuid, Uuid> = {};

    this.logger.debug(
      `Building membership index for project ${projectId}: ${lookups.modules.length} modules, ` +
        `${lookups.cycles.length} cycles (one request each, at minimum)`,
    );

    for (const module of lookups.modules) {
      const workItemIds = await this.plane.listModuleWorkItemIds(projectId, module.id);
      for (const workItemId of workItemIds) {
        (modulesByWorkItem[workItemId] ??= []).push(module.id);
      }
    }

    for (const cycle of lookups.cycles) {
      const workItemIds = await this.plane.listCycleWorkItemIds(projectId, cycle.id);
      for (const workItemId of workItemIds) {
        // Plane allows one cycle per item. If we somehow see two, the last wins and we say so.
        if (cycleByWorkItem[workItemId] && cycleByWorkItem[workItemId] !== cycle.id) {
          this.logger.warn(
            `Work item ${workItemId} appears in more than one cycle; keeping ${cycle.id}`,
          );
        }
        cycleByWorkItem[workItemId] = cycle.id;
      }
    }

    return { modulesByWorkItem, cycleByWorkItem, fetchedAt: new Date().toISOString() };
  }

  private lookupKey(projectId: Uuid): string {
    return `plane:lookups:${CACHE_SCHEMA_VERSION}:${this.config.plane.workspaceSlug}:${projectId}`;
  }

  private membershipKey(projectId: Uuid): string {
    return `plane:membership:${CACHE_SCHEMA_VERSION}:${this.config.plane.workspaceSlug}:${projectId}`;
  }
}
