import { MemoryCacheStore } from '../cache';
import type { AppConfigService } from '../config';
import type { PlaneApiClient, PlaneProject } from '../plane';
import { ProjectResolver } from './project-resolver';

const PROJECTS = [
  { id: '11111111-1111-1111-1111-111111111111', identifier: 'ENG', name: 'Engineering' },
  { id: '22222222-2222-2222-2222-222222222222', identifier: 'PLAT', name: 'Platform Infrastructure' },
] as PlaneProject[];

const config = { plane: { workspaceSlug: 'sagegrey' }, lookupCacheTtlSeconds: 300 } as AppConfigService;

function makeResolver(listProjects = jest.fn().mockResolvedValue(PROJECTS)) {
  const plane = { listProjects } as unknown as PlaneApiClient;
  return { resolver: new ProjectResolver(plane, config, new MemoryCacheStore()), listProjects };
}

describe('ProjectResolver', () => {
  it('resolves by project key, which is how people refer to projects', async () => {
    const { resolver } = makeResolver();

    await expect(resolver.resolve('ENG')).resolves.toMatchObject({ identifier: 'ENG' });
  });

  it('is case-insensitive', async () => {
    const { resolver } = makeResolver();

    await expect(resolver.resolve('eng')).resolves.toMatchObject({ identifier: 'ENG' });
  });

  it('resolves by full name', async () => {
    const { resolver } = makeResolver();

    await expect(resolver.resolve('Platform Infrastructure')).resolves.toMatchObject({ identifier: 'PLAT' });
  });

  it('resolves by UUID, for scripts that already have one', async () => {
    const { resolver } = makeResolver();

    await expect(resolver.resolve('11111111-1111-1111-1111-111111111111')).resolves.toMatchObject({
      identifier: 'ENG',
    });
  });

  it('lists what is available when nothing matches', async () => {
    // The usual cause is a typo or a project this token cannot see; both are obvious from the list.
    const { resolver } = makeResolver();

    await expect(resolver.resolve('NOPE')).rejects.toThrow(/ENG \(Engineering\), PLAT \(Platform Infrastructure\)/);
  });

  it('caches the project list across resolutions', async () => {
    const { resolver, listProjects } = makeResolver();

    await resolver.resolve('ENG');
    await resolver.resolve('PLAT');

    expect(listProjects).toHaveBeenCalledTimes(1);
  });

  it('re-fetches on a forced refresh, so a new project is findable immediately', async () => {
    const { resolver, listProjects } = makeResolver();

    await resolver.resolve('ENG');
    await resolver.resolve('ENG', { forceRefresh: true });

    expect(listProjects).toHaveBeenCalledTimes(2);
  });

  describe('resolveMany', () => {
    it('resolves several references in order', async () => {
      const { resolver } = makeResolver();

      const resolved = await resolver.resolveMany(['PLAT', 'ENG']);

      expect(resolved.map((project) => project.identifier)).toEqual(['PLAT', 'ENG']);
    });

    it('drops a duplicate rather than producing two identical tabs', async () => {
      const { resolver } = makeResolver();

      const resolved = await resolver.resolveMany(['ENG', 'eng', '11111111-1111-1111-1111-111111111111']);

      expect(resolved).toHaveLength(1);
    });

    it('refuses an empty request', async () => {
      const { resolver } = makeResolver();

      await expect(resolver.resolveMany([])).rejects.toThrow(/No projects/);
    });
  });
});
