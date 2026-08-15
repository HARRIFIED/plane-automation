import { Logger } from '@nestjs/common';

import type { PlaneClientConfig } from '../config';
import { PlaneAuthError, PlaneNotFoundError, PlaneNotImplementedError } from './errors';
import { PlaneApiClient } from './plane-api.client';
import type { FetchLike } from './plane-api.client';

const config: PlaneClientConfig = {
  apiUrl: 'https://plane.example.com/api/v1',
  appUrl: 'https://plane.example.com',
  apiKey: 'test-key',
  workspaceSlug: 'acme',
  rateLimitPerMinute: 1000, // effectively off; the throttle has its own tests
  pageSize: 100,
  maxPages: 10,
  requestTimeoutMs: 5000,
  maxRetries: 2,
  retryBaseMs: 1, // keep retry backoff imperceptible in tests
};

/** Minimal Response stand-in; the client only touches ok/status/headers/json/text. */
function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  const status = init.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(init.headers ?? {}),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

function envelope(results: unknown[], overrides: Record<string, unknown> = {}) {
  return {
    results,
    total_count: results.length,
    count: results.length,
    total_pages: 1,
    total_results: results.length,
    next_cursor: null,
    prev_cursor: null,
    next_page_results: false,
    prev_page_results: false,
    grouped_by: null,
    sub_grouped_by: null,
    extra_stats: null,
    ...overrides,
  };
}

function clientWith(fetchFn: FetchLike, overrides: Partial<PlaneClientConfig> = {}) {
  return new PlaneApiClient({ ...config, ...overrides }, fetchFn);
}

describe('PlaneApiClient', () => {
  describe('request construction', () => {
    it('authenticates with X-API-Key, not a bearer token', async () => {
      const fetchFn = jest.fn<Promise<Response>, [string, RequestInit?]>().mockResolvedValue(jsonResponse(envelope([])));

      await clientWith(fetchFn).listStates('project-1');

      const [, init] = fetchFn.mock.calls[0]!;
      const headers = init?.headers as Record<string, string>;
      expect(headers['X-API-Key']).toBe('test-key');
      expect(headers).not.toHaveProperty('Authorization');
    });

    it('builds workspace and project scoped paths', async () => {
      const fetchFn = jest.fn<Promise<Response>, [string, RequestInit?]>().mockResolvedValue(jsonResponse(envelope([])));

      await clientWith(fetchFn).listLabels('project-1');

      expect(fetchFn.mock.calls[0]![0]).toContain(
        '/api/v1/workspaces/acme/projects/project-1/labels/',
      );
    });

    it('requests work items ordered by sequence_id, since the cursor is offset based', async () => {
      const fetchFn = jest.fn<Promise<Response>, [string, RequestInit?]>().mockResolvedValue(jsonResponse(envelope([])));

      await clientWith(fetchFn).listAllWorkItems('project-1');

      const url = new URL(fetchFn.mock.calls[0]![0]);
      expect(url.searchParams.get('order_by')).toBe('sequence_id');
      expect(url.searchParams.get('per_page')).toBe('100');
    });

    it('trims membership lookups to ids only', async () => {
      const fetchFn = jest.fn<Promise<Response>, [string, RequestInit?]>().mockResolvedValue(jsonResponse(envelope([])));

      await clientWith(fetchFn).listModuleWorkItemIds('project-1', 'module-1');

      const url = new URL(fetchFn.mock.calls[0]![0]);
      expect(url.pathname).toContain('/modules/module-1/module-issues/');
      expect(url.searchParams.get('fields')).toBe('id');
    });
  });

  describe('pagination', () => {
    it('follows the cursor across pages and returns every row', async () => {
      const fetchFn = jest.fn<Promise<Response>, [string, RequestInit?]>().mockImplementation(async (url) => {
        const cursor = new URL(url).searchParams.get('cursor');
        return cursor === null
          ? jsonResponse(
              envelope([{ id: 'a' }], { total_count: 2, next_cursor: '100:1:0', next_page_results: true }),
            )
          : jsonResponse(envelope([{ id: 'b' }], { total_count: 2 }));
      });

      const items = await clientWith(fetchFn).listAllWorkItems('project-1');

      expect(items.map((item) => item.id)).toEqual(['a', 'b']);
      expect(fetchFn).toHaveBeenCalledTimes(2);
    });
  });

  describe('members', () => {
    it('handles the bare array this endpoint returns instead of a pagination envelope', async () => {
      const users = [{ id: 'user-1', display_name: 'ada', first_name: 'Ada', last_name: 'L', email: 'a@x.co' }];
      const fetchFn = jest.fn<Promise<Response>, [string, RequestInit?]>().mockResolvedValue(jsonResponse(users));

      const members = await clientWith(fetchFn).listMembers('project-1');

      expect(members).toHaveLength(1);
      expect(members[0]!.display_name).toBe('ada');
      // A bare array means no cursor to follow: exactly one call.
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('estimate points', () => {
    it('treats a 404 from /estimates/ as "this project has no estimates"', async () => {
      // Plane returns 404 with {"error":"Estimate not found"} when no scale is configured,
      // which is the common case — not a reason to fail an entire export.
      const fetchFn = jest
        .fn<Promise<Response>, [string, RequestInit?]>()
        .mockResolvedValue(jsonResponse({ error: 'Estimate not found' }, { status: 404 }));

      await expect(clientWith(fetchFn).listEstimatePoints('project-1')).resolves.toEqual([]);
      // Not retried: a 404 is an answer, not a transient failure.
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it('reads the single estimate object this endpoint returns, not a paginated envelope', async () => {
      const fetchFn = jest.fn<Promise<Response>, [string, RequestInit?]>().mockImplementation(async (url) => {
        if (url.includes('/estimate-points/')) {
          return jsonResponse([
            { id: 'ep-1', key: 1, value: '1', estimate: 'e-1' },
            { id: 'ep-3', key: 3, value: '3', estimate: 'e-1' },
          ]);
        }
        // A bare object, because a project has at most one estimate scale.
        return jsonResponse({ id: 'e-1', name: 'Fibonacci', type: 'points' });
      });

      const points = await clientWith(fetchFn).listEstimatePoints('project-1');

      expect(points.map((point) => point.value)).toEqual(['1', '3']);
      expect(fetchFn.mock.calls[1]![0]).toContain('/estimates/e-1/estimate-points/');
    });

    it('handles the bare array of points rather than expecting .results', async () => {
      const fetchFn = jest.fn<Promise<Response>, [string, RequestInit?]>().mockImplementation(async (url) =>
        url.includes('/estimate-points/')
          ? jsonResponse([{ id: 'ep-1', key: 1, value: 'S' }])
          : jsonResponse({ id: 'e-1', name: 'T-shirt' }),
      );

      await expect(clientWith(fetchFn).listEstimatePoints('project-1')).resolves.toHaveLength(1);
    });

    it('copes with the scale being deleted between the two calls', async () => {
      const fetchFn = jest.fn<Promise<Response>, [string, RequestInit?]>().mockImplementation(async (url) =>
        url.includes('/estimate-points/')
          ? jsonResponse({ error: 'Estimate not found' }, { status: 404 })
          : jsonResponse({ id: 'e-1', name: 'Fibonacci' }),
      );

      await expect(clientWith(fetchFn).listEstimatePoints('project-1')).resolves.toEqual([]);
    });

    it('still surfaces a real server error', async () => {
      const fetchFn = jest
        .fn<Promise<Response>, [string, RequestInit?]>()
        .mockResolvedValue(jsonResponse({ error: 'boom' }, { status: 500 }));

      await expect(clientWith(fetchFn).listEstimatePoints('project-1')).rejects.toThrow(/500/);
    });
  });

  describe('identifier resolution', () => {
    it('resolves PROJ-123 through the workspace scoped endpoint', async () => {
      const fetchFn = jest
        .fn<Promise<Response>, [string, RequestInit?]>()
        .mockResolvedValue(jsonResponse({ id: 'uuid-1', sequence_id: 123 }));

      const item = await clientWith(fetchFn).getWorkItemByIdentifier('proj-123');

      expect(item.id).toBe('uuid-1');
      // Uppercased, and no project UUID needed.
      expect(fetchFn.mock.calls[0]![0]).toContain('/workspaces/acme/work-items/PROJ-123/');
    });

    it('rejects a malformed identifier without spending a request', async () => {
      const fetchFn = jest.fn<Promise<Response>, [string, RequestInit?]>();

      await expect(clientWith(fetchFn).getWorkItemByIdentifier('not an id')).rejects.toThrow(/not a valid/);
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it('surfaces an unresolvable identifier as PlaneNotFoundError', async () => {
      const fetchFn = jest
        .fn<Promise<Response>, [string, RequestInit?]>()
        .mockResolvedValue(jsonResponse({ error: 'not found' }, { status: 404 }));

      await expect(clientWith(fetchFn).getWorkItemByIdentifier('PROJ-999')).rejects.toThrow(PlaneNotFoundError);
    });
  });

  describe('error handling', () => {
    it('explains a 401 in terms of the token, not the HTTP code', async () => {
      const fetchFn = jest
        .fn<Promise<Response>, [string, RequestInit?]>()
        .mockResolvedValue(jsonResponse({ error: 'unauthorised' }, { status: 401 }));

      await expect(clientWith(fetchFn).listStates('project-1')).rejects.toThrow(PlaneAuthError);
      // Auth failures are not transient: one attempt, no retries.
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it('retries a 429 and honours Retry-After', async () => {
      const fetchFn = jest
        .fn<Promise<Response>, [string, RequestInit?]>()
        .mockResolvedValueOnce(jsonResponse({ error: 'throttled' }, { status: 429, headers: { 'Retry-After': '0' } }))
        .mockResolvedValue(jsonResponse(envelope([{ id: 'a' }])));

      const states = await clientWith(fetchFn).listStates('project-1');

      expect(states).toHaveLength(1);
      expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it('retries a 5xx', async () => {
      const fetchFn = jest
        .fn<Promise<Response>, [string, RequestInit?]>()
        .mockResolvedValueOnce(jsonResponse({ error: 'boom' }, { status: 502 }))
        .mockResolvedValue(jsonResponse(envelope([])));

      await expect(clientWith(fetchFn).listStates('project-1')).resolves.toEqual([]);
      expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it('wraps a network failure with the method and path', async () => {
      const fetchFn = jest
        .fn<Promise<Response>, [string, RequestInit?]>()
        .mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(clientWith(fetchFn).listStates('project-1')).rejects.toThrow(/ECONNREFUSED/);
      // Retried to exhaustion: initial attempt plus maxRetries.
      expect(fetchFn).toHaveBeenCalledTimes(3);
    });
  });

  describe('rate limit headers', () => {
    it('does not read a response without rate limit headers as an exhausted budget', async () => {
      // Number(null) is 0, so a naive coercion treats "header absent" as "nothing left".
      const fetchFn = jest.fn<Promise<Response>, [string, RequestInit?]>().mockResolvedValue(jsonResponse(envelope([])));
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      await clientWith(fetchFn).listStates('project-1');

      expect(warn).not.toHaveBeenCalled();
    });

    it('stalls until the server reported reset when the budget is genuinely gone', async () => {
      const resetSeconds = Math.floor(Date.now() / 1000) + 30;
      const fetchFn = jest.fn<Promise<Response>, [string, RequestInit?]>().mockResolvedValue(
        jsonResponse(envelope([]), {
          headers: { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': String(resetSeconds) },
        }),
      );
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      await clientWith(fetchFn).listStates('project-1');

      expect(warn).toHaveBeenCalledWith(expect.stringContaining('no rate limit budget remaining'));
    });
  });

  describe('links', () => {
    it('builds a work item URL against the app host, not the API host', () => {
      const url = clientWith(jest.fn()).workItemUrl('project-1', 'item-1');

      expect(url).toBe('https://plane.example.com/acme/projects/project-1/issues/item-1');
    });
  });

  describe('Phase 2 write surface', () => {
    it('declares writes but refuses them until Phase 2', async () => {
      const client = clientWith(jest.fn());

      await expect(client.updateWorkItem('p', 'i', { state: 's' })).rejects.toThrow(PlaneNotImplementedError);
      await expect(client.transitionWorkItemState('p', 'i', 's')).rejects.toThrow(PlaneNotImplementedError);
    });

    it('explains that advanced search does not exist on v1.3.0', async () => {
      await expect(clientWith(jest.fn()).advancedSearch()).rejects.toThrow(/Cloud only/);
    });
  });
});
