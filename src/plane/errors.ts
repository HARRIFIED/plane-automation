/** Errors raised by the Plane API client. All carry enough context to debug from a log line alone. */

export interface PlaneErrorContext {
  method: string;
  path: string;
  status?: number;
  /** Response body, truncated. Plane returns `{"error": "..."}` on most failures. */
  body?: string;
}

export class PlaneApiError extends Error {
  readonly method: string;
  readonly path: string;
  readonly status?: number;
  readonly body?: string;

  constructor(message: string, context: PlaneErrorContext, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
    this.method = context.method;
    this.path = context.path;
    this.status = context.status;
    this.body = context.body;
  }
}

/** 401/403. Almost always a missing, revoked, or wrong-workspace API key. */
export class PlaneAuthError extends PlaneApiError {}

/** 404. Also raised when an identifier like PROJ-123 does not resolve. */
export class PlaneNotFoundError extends PlaneApiError {}

/** 429. Carries the server's Retry-After so the caller does not have to guess. */
export class PlaneRateLimitError extends PlaneApiError {
  readonly retryAfterMs: number;

  constructor(message: string, context: PlaneErrorContext, retryAfterMs: number) {
    super(message, context);
    this.retryAfterMs = retryAfterMs;
  }
}

/** Connection refused, DNS failure, TLS error, or our own request timeout. */
export class PlaneNetworkError extends PlaneApiError {}

/**
 * Raised by methods that are deliberately not wired up yet.
 *
 * Two distinct cases, both intentional:
 *  - Phase 2 write methods, present in the interface so the shape is settled but unimplemented.
 *  - Endpoints that do not exist on self-hosted v1.3.0, such as advanced search.
 */
export class PlaneNotImplementedError extends Error {
  constructor(operation: string, reason: string) {
    super(`${operation} is not available: ${reason}`);
    this.name = 'PlaneNotImplementedError';
  }
}

/**
 * The page cap in pagination.ts tripped.
 *
 * Either the project is far larger than expected or a cursor is not advancing. Both are
 * worth failing loudly for rather than returning a silently short export.
 */
export class PlanePaginationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlanePaginationError';
  }
}
