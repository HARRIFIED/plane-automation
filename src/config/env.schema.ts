import { z } from 'zod';

/**
 * Environment contract for the service.
 *
 * Validated once at boot (see ConfigModule) so a missing or malformed value fails
 * the process immediately rather than surfacing as a confusing 401 on the first export.
 */

/** Base URLs are stored without a trailing slash so path joining is unambiguous. */
const url = () =>
  z
    .string()
    .url()
    .transform((value) => value.replace(/\/+$/, ''));

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  /**
   * Root of the Plane REST API, including the version prefix.
   * We run self-hosted Plane Community v1.3.0, so this is our own domain rather
   * than api.plane.so. See docs/plane-api-findings.md.
   */
  PLANE_API_URL: url(),

  /** Root of the Plane web app, used to build the "link to item" column. */
  PLANE_APP_URL: url(),

  /** Workspace scoped personal access token, sent as the X-API-Key header. */
  PLANE_API_KEY: z.string().min(1, 'PLANE_API_KEY is required'),

  /** Workspace slug as it appears in the Plane URL. */
  PLANE_WORKSPACE_SLUG: z.string().min(1, 'PLANE_WORKSPACE_SLUG is required'),

  /**
   * Requests per minute the client will allow itself.
   *
   * Plane throttles per API key. On self-hosted 1.3.0 the server side value comes from
   * the API container's own API_KEY_RATE_LIMIT env var and defaults to 60/minute, so this
   * is a mirror of a value we control — keep the two in step, and keep this one lower.
   */
  PLANE_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(55),

  /** Page size for list endpoints. Plane caps this at 100 and ignores anything larger. */
  PLANE_PAGE_SIZE: z.coerce.number().int().min(1).max(100).default(100),

  /** Safety cap so a misbehaving cursor cannot loop forever. */
  PLANE_MAX_PAGES: z.coerce.number().int().positive().default(500),

  PLANE_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),

  /** Retry attempts after the initial try, for 429s, 5xx and network failures. */
  PLANE_MAX_RETRIES: z.coerce.number().int().min(0).default(4),
  PLANE_RETRY_BASE_MS: z.coerce.number().int().positive().default(500),

  /**
   * How long a project's lookup tables stay cached.
   *
   * Deliberately short: states, labels and members change rarely but people notice
   * immediately when a rename does not show up in a report. Callers can force a refresh.
   */
  LOOKUP_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(300),

  /** Required from step 7 (filter presets). Optional until then. */
  DATABASE_URL: z.string().url().optional(),

  /** Required from step 3 (lookup caching). Falls back to an in-memory cache when unset. */
  REDIS_URL: z.string().url().optional(),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Parse and validate the raw environment.
 *
 * Wired into @nestjs/config as its `validate` hook, so the returned object becomes the
 * config source and Nest never sees an unvalidated value.
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);

  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');

    throw new Error(
      `Invalid environment configuration:\n${problems}\n\n` +
        'See .env.example for the full list of variables.',
    );
  }

  return result.data;
}
