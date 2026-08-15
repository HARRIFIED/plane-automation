import { validateEnv } from './env.schema';

const validEnv = {
  PLANE_API_URL: 'https://plane.example.com/api/v1',
  PLANE_APP_URL: 'https://plane.example.com',
  PLANE_API_KEY: 'plane_api_test_key',
  PLANE_WORKSPACE_SLUG: 'acme',
};

describe('validateEnv', () => {
  it('accepts a minimal valid environment and applies defaults', () => {
    const env = validateEnv({ ...validEnv });

    expect(env.PLANE_API_KEY).toBe('plane_api_test_key');
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.PLANE_RATE_LIMIT_PER_MINUTE).toBe(55);
    expect(env.PLANE_PAGE_SIZE).toBe(100);
  });

  it('fails fast when the API token is missing', () => {
    const { PLANE_API_KEY: _omitted, ...withoutToken } = validEnv;

    expect(() => validateEnv(withoutToken)).toThrow(/PLANE_API_KEY/);
  });

  it('names every problem at once rather than one per boot', () => {
    expect(() => validateEnv({})).toThrow(/PLANE_API_KEY[\s\S]*PLANE_WORKSPACE_SLUG/);
  });

  it('coerces numeric strings, since env vars are always strings', () => {
    const env = validateEnv({ ...validEnv, PORT: '8080', PLANE_MAX_PAGES: '25' });

    expect(env.PORT).toBe(8080);
    expect(env.PLANE_MAX_PAGES).toBe(25);
  });

  it('rejects a page size above the server cap of 100', () => {
    expect(() => validateEnv({ ...validEnv, PLANE_PAGE_SIZE: '250' })).toThrow(/PLANE_PAGE_SIZE/);
  });

  it('rejects a malformed API URL', () => {
    expect(() => validateEnv({ ...validEnv, PLANE_API_URL: 'plane.example.com' })).toThrow(/PLANE_API_URL/);
  });

  it('strips trailing slashes so path joining is unambiguous', () => {
    const env = validateEnv({
      ...validEnv,
      PLANE_API_URL: 'https://plane.example.com/api/v1/',
      PLANE_APP_URL: 'https://plane.example.com//',
    });

    expect(env.PLANE_API_URL).toBe('https://plane.example.com/api/v1');
    expect(env.PLANE_APP_URL).toBe('https://plane.example.com');
  });
});
