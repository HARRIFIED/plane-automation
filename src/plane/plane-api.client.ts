import { Inject, Injectable, Logger } from '@nestjs/common';

import type { PlaneClientConfig } from '../config';
import {
  PlaneApiError,
  PlaneAuthError,
  PlaneNetworkError,
  PlaneNotFoundError,
  PlaneNotImplementedError,
  PlaneRateLimitError,
} from './errors';
import { RateLimiter } from './http/rate-limiter';
import { parseRetryAfter, withRetry } from './http/retry';
import { collectAllPages } from './pagination';
import type { PlaneApi } from './plane-api.interface';
import type {
  PlaneCycle,
  PlaneEstimate,
  PlaneEstimatePoint,
  PlaneLabel,
  PlaneListParams,
  PlaneMember,
  PlaneProjectModule,
  PlanePaginatedResponse,
  PlaneProject,
  PlaneState,
  PlaneWorkItem,
  PlaneWorkItemSearchResult,
  PlaneWorkItemUpdate,
  Uuid,
} from './types';

/** Injection tokens, so tests can supply a fake fetch and config without touching globals. */
export const PLANE_CONFIG = Symbol('PLANE_CONFIG');
export const PLANE_FETCH = Symbol('PLANE_FETCH');

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

type QueryValue = string | number | boolean | undefined;

interface RequestOptions {
  query?: Record<string, QueryValue>;
  body?: unknown;
}

/**
 * Typed client for the Plane REST API.
 *
 * Knows nothing about Excel, filters, or presets — it returns Plane's shapes and lets callers
 * decide what to do with them. Everything version specific about our self-hosted v1.3.0
 * instance is documented in docs/plane-api-findings.md; the surprising parts are commented
 * again at the point of use below.
 *
 * All requests funnel through `request()`, so the throttle and retry policy apply uniformly
 * no matter how many projects an export touches.
 */
@Injectable()
export class PlaneApiClient implements PlaneApi {
  private readonly logger = new Logger(PlaneApiClient.name);
  private readonly limiter: RateLimiter;

  constructor(
    @Inject(PLANE_CONFIG) private readonly config: PlaneClientConfig,
    @Inject(PLANE_FETCH) private readonly fetchFn: FetchLike,
  ) {
    this.limiter = new RateLimiter({ limit: config.rateLimitPerMinute, windowMs: 60_000 });
  }

  // ------------------------------------------------------------------ projects

  async listProjects(): Promise<PlaneProject[]> {
    return this.listAll<PlaneProject>(`${this.workspacePath()}/projects/`, 'projects');
  }

  async getProject(projectId: Uuid): Promise<PlaneProject> {
    return this.request<PlaneProject>('GET', `${this.projectPath(projectId)}/`);
  }

  // ----------------------------------------------------------------- work items

  /**
   * Pull every work item in a project.
   *
   * Ordered by sequence_id rather than the server default of -created_at: the cursor is
   * offset based, so a stable, unique sort key is what keeps pages from shifting under us.
   *
   * No `expand` is requested. Expanding state would inline the state object, but we build the
   * state lookup map anyway (filtering by state group needs states that have no items), and
   * expansion costs an extra query per row on the server. One shape, one resolution path.
   *
   * Not returned by this endpoint, by design on Plane's side: archived items, drafts, triage
   * items, and anything in an archived project.
   */
  async listAllWorkItems(projectId: Uuid): Promise<PlaneWorkItem[]> {
    return this.listAll<PlaneWorkItem>(`${this.projectPath(projectId)}/work-items/`, 'work items', {
      order_by: 'sequence_id',
    });
  }

  async getWorkItem(projectId: Uuid, workItemId: Uuid): Promise<PlaneWorkItem> {
    return this.request<PlaneWorkItem>('GET', `${this.projectPath(projectId)}/work-items/${workItemId}/`);
  }

  /**
   * Resolve "PROJ-123" to a full work item.
   *
   * Workspace scoped: no project UUID required, which is what removes the need for a local
   * identifier index in Phase 2.
   */
  async getWorkItemByIdentifier(identifier: string): Promise<PlaneWorkItem> {
    const normalised = identifier.trim().toUpperCase();

    if (!/^[A-Z0-9]+-\d+$/.test(normalised)) {
      throw new PlaneApiError(`"${identifier}" is not a valid work item identifier (expected e.g. PROJ-123)`, {
        method: 'GET',
        path: `${this.workspacePath()}/work-items/${identifier}/`,
      });
    }

    return this.request<PlaneWorkItem>('GET', `${this.workspacePath()}/work-items/${normalised}/`);
  }

  /**
   * Text search across name, sequence id and project identifier.
   *
   * Returns a trimmed row, not a work item, and takes a limit rather than a cursor — it is a
   * lookup aid, not a way to enumerate a project.
   */
  async searchWorkItems(
    query: string,
    options: { projectId?: Uuid; limit?: number } = {},
  ): Promise<PlaneWorkItemSearchResult[]> {
    const response = await this.request<{ issues: PlaneWorkItemSearchResult[] }>(
      'GET',
      `${this.workspacePath()}/work-items/search/`,
      {
        query: {
          search: query,
          limit: options.limit ?? 10,
          project_id: options.projectId,
          workspace_search: options.projectId ? 'false' : 'true',
        },
      },
    );

    return response.issues ?? [];
  }

  // -------------------------------------------------------------------- lookups

  async listStates(projectId: Uuid): Promise<PlaneState[]> {
    return this.listAll<PlaneState>(`${this.projectPath(projectId)}/states/`, 'states');
  }

  async listLabels(projectId: Uuid): Promise<PlaneLabel[]> {
    return this.listAll<PlaneLabel>(`${this.projectPath(projectId)}/labels/`, 'labels');
  }

  /**
   * Project members.
   *
   * The one list endpoint that does NOT use the pagination envelope — it returns a bare JSON
   * array of users. Do not route this through listAll(); it would read `.results` off an array
   * and get undefined.
   *
   * The `id` on each row is the user UUID, which is what a work item's `assignees` contains.
   */
  async listMembers(projectId: Uuid): Promise<PlaneMember[]> {
    const members = await this.request<PlaneMember[]>('GET', `${this.projectPath(projectId)}/members/`);
    return Array.isArray(members) ? members : [];
  }

  async listModules(projectId: Uuid): Promise<PlaneProjectModule[]> {
    return this.listAll<PlaneProjectModule>(`${this.projectPath(projectId)}/modules/`, 'modules');
  }

  async listCycles(projectId: Uuid): Promise<PlaneCycle[]> {
    return this.listAll<PlaneCycle>(`${this.projectPath(projectId)}/cycles/`, 'cycles');
  }

  /**
   * The project's estimate points, so the estimate column can show "3" rather than a UUID.
   *
   * Three things about these two endpoints are unlike every other list in this client, all
   * verified against the v1.3.0 source:
   *
   *  1. `GET /estimates/` returns a SINGLE estimate object, not a paginated envelope — a
   *     project has at most one estimate scale (creating a second returns 409).
   *  2. It returns **404 when the project has no estimate configured**, which is the common
   *     case rather than an error. Treated as "no estimates" and an empty result.
   *  3. `estimate-points/` returns a bare array, like `/members/`.
   *
   * Getting any of these wrong fails the whole export over one optional column, so the 404 is
   * swallowed deliberately here rather than left to the caller.
   */
  async listEstimatePoints(projectId: Uuid): Promise<PlaneEstimatePoint[]> {
    let estimate: PlaneEstimate | null = null;

    try {
      estimate = await this.request<PlaneEstimate>('GET', `${this.projectPath(projectId)}/estimates/`);
    } catch (error) {
      if (error instanceof PlaneNotFoundError) {
        this.logger.debug(`Project ${projectId} has no estimate configured; the estimate column will be empty`);
        return [];
      }
      throw error;
    }

    if (!estimate?.id) return [];

    try {
      const points = await this.request<PlaneEstimatePoint[]>(
        'GET',
        `${this.projectPath(projectId)}/estimates/${estimate.id}/estimate-points/`,
      );

      return Array.isArray(points) ? points : [];
    } catch (error) {
      // The scale can be deleted between the two calls; not worth failing an export over.
      if (error instanceof PlaneNotFoundError) return [];
      throw error;
    }
  }

  /**
   * Work item ids in a module.
   *
   * `fields=id` matters here: without it Plane serialises every full work item again, which
   * for a large module means re-downloading data we already hold. With it, each row is a
   * single id. Callers should only reach for this when the export actually needs the module
   * column or filter — see the cost note in docs/plane-api-findings.md §2.2.
   */
  async listModuleWorkItemIds(projectId: Uuid, moduleId: Uuid): Promise<Uuid[]> {
    const rows = await this.listAll<{ id: Uuid }>(
      `${this.projectPath(projectId)}/modules/${moduleId}/module-issues/`,
      'module work items',
      { fields: 'id' },
    );
    return rows.map((row) => row.id);
  }

  async listCycleWorkItemIds(projectId: Uuid, cycleId: Uuid): Promise<Uuid[]> {
    const rows = await this.listAll<{ id: Uuid }>(
      `${this.projectPath(projectId)}/cycles/${cycleId}/cycle-issues/`,
      'cycle work items',
      { fields: 'id' },
    );
    return rows.map((row) => row.id);
  }

  workItemUrl(projectId: Uuid, workItemId: Uuid): string {
    return `${this.config.appUrl}/${this.config.workspaceSlug}/projects/${projectId}/issues/${workItemId}`;
  }

  // ---------------------------------------------------- writes (Phase 2, unimplemented)

  async updateWorkItem(_projectId: Uuid, _workItemId: Uuid, _patch: PlaneWorkItemUpdate): Promise<PlaneWorkItem> {
    throw new PlaneNotImplementedError(
      'updateWorkItem',
      'Phase 2 (GitHub merge driven transitions) is not built yet. The endpoint is ' +
        'PATCH /workspaces/{slug}/projects/{id}/work-items/{id}/.',
    );
  }

  async transitionWorkItemState(_projectId: Uuid, _workItemId: Uuid, _stateId: Uuid): Promise<PlaneWorkItem> {
    throw new PlaneNotImplementedError('transitionWorkItemState', 'Phase 2 is not built yet.');
  }

  /**
   * Server side filtered search.
   *
   * Not on the interface because it does not exist on our instance: advanced-search is a Plane
   * Cloud endpoint and is absent from the v1.3.0 URL conf. Kept as a signpost so nobody spends
   * an afternoon rediscovering that, and so an upgrade has an obvious landing spot.
   */
  async advancedSearch(): Promise<never> {
    throw new PlaneNotImplementedError(
      'advancedSearch',
      'POST /work-items/advanced-search/ is Plane Cloud only and does not exist on self-hosted v1.3.0. ' +
        'Pull the full set and filter in memory instead.',
    );
  }

  // --------------------------------------------------------------------- internals

  private workspacePath(): string {
    return `/workspaces/${this.config.workspaceSlug}`;
  }

  private projectPath(projectId: Uuid): string {
    return `${this.workspacePath()}/projects/${projectId}`;
  }

  /** Page a list endpoint to exhaustion. */
  private async listAll<T extends { id: string }>(
    path: string,
    resource: string,
    params: PlaneListParams = {},
  ): Promise<T[]> {
    const { items, pagesFetched } = await collectAllPages<T>(
      (cursor) =>
        this.request<PlanePaginatedResponse<T>>('GET', path, {
          query: { ...params, per_page: this.config.pageSize, cursor },
        }),
      {
        maxPages: this.config.maxPages,
        resource,
        onWarning: (message) => this.logger.warn(message),
      },
    );

    this.logger.debug(`Fetched ${items.length} ${resource} from ${path} in ${pagesFetched} page(s)`);
    return items;
  }

  private buildUrl(path: string, query?: Record<string, QueryValue>): string {
    const url = new URL(`${this.config.apiUrl}${path}`);

    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    return url.toString();
  }

  /**
   * Single funnel for every HTTP call: throttle, send, classify failures, retry.
   *
   * Order matters — the throttle slot is taken inside the retry loop, so a retried request
   * waits its turn again instead of jumping the queue.
   */
  private async request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    const url = this.buildUrl(path, options.query);

    return withRetry(
      async () => {
        await this.limiter.acquire();

        let response: Response;
        try {
          response = await this.fetchFn(url, {
            method,
            headers: {
              'X-API-Key': this.config.apiKey,
              Accept: 'application/json',
              ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
            },
            body: options.body === undefined ? undefined : JSON.stringify(options.body),
            signal: AbortSignal.timeout(this.config.requestTimeoutMs),
          });
        } catch (cause) {
          const reason = cause instanceof Error ? cause.message : String(cause);
          throw new PlaneNetworkError(`${method} ${path} failed: ${reason}`, { method, path }, { cause });
        }

        this.observeRateLimitHeaders(response);

        if (!response.ok) throw await this.toError(response, method, path);

        // 204 on delete, and PATCH occasionally returns an empty body.
        if (response.status === 204) return undefined as T;

        return (await response.json()) as T;
      },
      {
        maxRetries: this.config.maxRetries,
        baseMs: this.config.retryBaseMs,
        onRetry: ({ attempt, delayMs, error }) => {
          const reason = error instanceof Error ? error.message : String(error);
          this.logger.warn(`Retry ${attempt}/${this.config.maxRetries} for ${method} ${path} in ${delayMs}ms: ${reason}`);
        },
      },
    );
  }

  /**
   * Keep the local throttle honest against the server's own counter.
   *
   * Our limiter counts what this process sent; the server counts everything sent with this API
   * key, including anything else using it. When the server says there is nothing left, believe
   * it and stall until its reset rather than continuing to spend a budget we do not have.
   */
  private observeRateLimitHeaders(response: Response): void {
    const remainingHeader = response.headers.get('X-RateLimit-Remaining');
    const resetHeader = response.headers.get('X-RateLimit-Reset');

    // Test both for null before coercing: Number(null) is 0, which would read a response
    // carrying no rate limit headers at all as "no budget left".
    if (remainingHeader === null || resetHeader === null) return;

    const remaining = Number(remainingHeader);
    const resetSeconds = Number(resetHeader);
    if (!Number.isFinite(remaining) || !Number.isFinite(resetSeconds)) return;

    if (remaining <= 0) {
      this.limiter.pauseUntil(resetSeconds * 1000);
      this.logger.warn(
        `Plane reports no rate limit budget remaining; pausing until the window resets at ${new Date(
          resetSeconds * 1000,
        ).toISOString()}`,
      );
    }
  }

  private async toError(response: Response, method: string, path: string): Promise<PlaneApiError> {
    // Truncated: Plane can return an HTML error page from the proxy rather than JSON.
    const body = (await response.text().catch(() => '')).slice(0, 500);
    const context = { method, path, status: response.status, body };

    switch (response.status) {
      case 401:
      case 403:
        return new PlaneAuthError(
          `${method} ${path} rejected with ${response.status}. Check PLANE_API_KEY and that the token's ` +
            'workspace matches PLANE_WORKSPACE_SLUG.',
          context,
        );

      case 404:
        return new PlaneNotFoundError(`${method} ${path} returned 404`, context);

      case 429: {
        const retryAfterMs = parseRetryAfter(response.headers.get('Retry-After'), this.config.retryBaseMs);
        this.limiter.pauseFor(retryAfterMs);
        return new PlaneRateLimitError(
          `${method} ${path} was rate limited; retrying in ${retryAfterMs}ms`,
          context,
          retryAfterMs,
        );
      }

      default:
        return new PlaneApiError(`${method} ${path} failed with ${response.status}: ${body}`, context);
    }
  }
}
