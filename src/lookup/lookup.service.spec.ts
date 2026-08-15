import { MemoryCacheStore } from '../cache';
import type { AppConfigService } from '../config';
import type { PlaneApiClient } from '../plane';
import { LookupService } from './lookup.service';

/** Only the members LookupService actually calls. */
type PlaneStub = Pick<
  PlaneApiClient,
  | 'listStates'
  | 'listLabels'
  | 'listMembers'
  | 'listModules'
  | 'listCycles'
  | 'listEstimatePoints'
  | 'listModuleWorkItemIds'
  | 'listCycleWorkItemIds'
>;

function makePlane(overrides: Partial<PlaneStub> = {}) {
  return {
    listStates: jest.fn().mockResolvedValue([{ id: 'state-1', name: 'Todo', group: 'unstarted' }]),
    listLabels: jest.fn().mockResolvedValue([{ id: 'label-1', name: 'bug' }]),
    listMembers: jest.fn().mockResolvedValue([{ id: 'user-1', display_name: 'ada' }]),
    listModules: jest.fn().mockResolvedValue([{ id: 'module-1', name: 'Billing' }]),
    listCycles: jest.fn().mockResolvedValue([{ id: 'cycle-1', name: 'Sprint 12' }]),
    listEstimatePoints: jest.fn().mockResolvedValue([{ id: 'estimate-1', key: 3, value: '3' }]),
    listModuleWorkItemIds: jest.fn().mockResolvedValue(['item-1', 'item-2']),
    listCycleWorkItemIds: jest.fn().mockResolvedValue(['item-2']),
    ...overrides,
  };
}

const config = {
  plane: { workspaceSlug: 'acme' },
  lookupCacheTtlSeconds: 300,
} as AppConfigService;

function makeService(plane: ReturnType<typeof makePlane>, cache = new MemoryCacheStore()) {
  return {
    service: new LookupService(plane as unknown as PlaneApiClient, config, cache),
    cache,
  };
}

describe('LookupService', () => {
  describe('getLookups', () => {
    it('loads all five lookup tables and resolves names through them', async () => {
      const plane = makePlane();
      const { service } = makeService(plane);

      const lookups = await service.getLookups('project-1');

      expect(lookups.stateName('state-1')).toBe('Todo');
      expect(lookups.labelName('label-1')).toBe('bug');
      expect(lookups.memberName('user-1')).toBe('ada');
      expect(lookups.moduleName('module-1')).toBe('Billing');
      expect(lookups.cycleName('cycle-1')).toBe('Sprint 12');
      // Without this table the estimate column could only show a UUID.
      expect(lookups.estimateValue('estimate-1')).toBe('3');
    });

    it('leaves the estimate blank rather than guessing when the point is unknown', async () => {
      const { service } = makeService(makePlane());

      const lookups = await service.getLookups('project-1');

      expect(lookups.estimateValue('estimate-missing')).toBe('');
      expect(lookups.estimateValue(null)).toBe('');
    });

    it('serves a second call from cache without touching Plane again', async () => {
      const plane = makePlane();
      const { service } = makeService(plane);

      await service.getLookups('project-1');
      await service.getLookups('project-1');

      expect(plane.listStates).toHaveBeenCalledTimes(1);
    });

    it('re-fetches when the caller forces a refresh', async () => {
      const plane = makePlane();
      const { service } = makeService(plane);

      await service.getLookups('project-1');
      await service.getLookups('project-1', { forceRefresh: true });

      expect(plane.listStates).toHaveBeenCalledTimes(2);
    });

    it('caches per project rather than globally', async () => {
      const plane = makePlane();
      const { service } = makeService(plane);

      await service.getLookups('project-1');
      await service.getLookups('project-2');

      expect(plane.listStates).toHaveBeenCalledTimes(2);
      expect(plane.listStates).toHaveBeenNthCalledWith(1, 'project-1');
      expect(plane.listStates).toHaveBeenNthCalledWith(2, 'project-2');
    });

    it('coalesces concurrent loads of the same project into one fetch', async () => {
      // Two exports starting at once must not each pull the same tables.
      const plane = makePlane();
      const { service } = makeService(plane);

      await Promise.all([
        service.getLookups('project-1'),
        service.getLookups('project-1'),
        service.getLookups('project-1'),
      ]);

      expect(plane.listStates).toHaveBeenCalledTimes(1);
    });

    it('still exports when estimates cannot be loaded at all', async () => {
      // The estimate column is optional; a state or member failure is not. One blank column
      // beats a failed export.
      const plane = makePlane({
        listEstimatePoints: jest.fn().mockRejectedValue(new Error('estimates exploded')),
      });
      const { service } = makeService(plane);

      const lookups = await service.getLookups('project-1');

      expect(lookups.stateName('state-1')).toBe('Todo');
      expect(lookups.estimateValue('estimate-1')).toBe('');
    });

    it('does fail the export when a table that affects every row is unavailable', async () => {
      const plane = makePlane({ listStates: jest.fn().mockRejectedValue(new Error('states down')) });
      const { service } = makeService(plane);

      await expect(service.getLookups('project-1')).rejects.toThrow('states down');
    });

    it('does not cache a failed load', async () => {
      const plane = makePlane({
        listStates: jest.fn().mockRejectedValueOnce(new Error('Plane is down')).mockResolvedValue([]),
      });
      const { service } = makeService(plane);

      await expect(service.getLookups('project-1')).rejects.toThrow('Plane is down');
      await expect(service.getLookups('project-1')).resolves.toBeDefined();
    });

    it('gives each export its own unresolved tally, even on a cache hit', async () => {
      const plane = makePlane();
      const { service } = makeService(plane);

      const first = await service.getLookups('project-1');
      first.memberName('missing-user');

      const second = await service.getLookups('project-1');

      expect(first.hasUnresolved()).toBe(true);
      expect(second.hasUnresolved()).toBe(false);
    });
  });

  describe('getMembership', () => {
    it('indexes work items by module and cycle', async () => {
      const plane = makePlane();
      const { service } = makeService(plane);

      const membership = await service.getMembership('project-1');

      expect(membership.modulesByWorkItem).toEqual({ 'item-1': ['module-1'], 'item-2': ['module-1'] });
      expect(membership.cycleByWorkItem).toEqual({ 'item-2': 'cycle-1' });
    });

    it('records every module an item belongs to', async () => {
      const plane = makePlane({
        listModules: jest.fn().mockResolvedValue([
          { id: 'module-1', name: 'Billing' },
          { id: 'module-2', name: 'Auth' },
        ]),
        listModuleWorkItemIds: jest.fn().mockResolvedValue(['item-1']),
      });
      const { service } = makeService(plane);

      const membership = await service.getMembership('project-1');

      expect(membership.modulesByWorkItem['item-1']).toEqual(['module-1', 'module-2']);
    });

    it('is not built as a side effect of loading lookups', async () => {
      // The whole point of separating them: membership costs a request per module and cycle.
      const plane = makePlane();
      const { service } = makeService(plane);

      await service.getLookups('project-1');

      expect(plane.listModuleWorkItemIds).not.toHaveBeenCalled();
      expect(plane.listCycleWorkItemIds).not.toHaveBeenCalled();
    });

    it('caches the index separately from the lookup tables', async () => {
      const plane = makePlane();
      const { service } = makeService(plane);

      await service.getMembership('project-1');
      await service.getMembership('project-1');

      expect(plane.listModuleWorkItemIds).toHaveBeenCalledTimes(1);
    });
  });

  describe('invalidate', () => {
    it('clears both cached entries for a project', async () => {
      const plane = makePlane();
      const { service } = makeService(plane);

      await service.getLookups('project-1');
      await service.getMembership('project-1');
      await service.invalidate('project-1');
      await service.getLookups('project-1');
      await service.getMembership('project-1');

      expect(plane.listStates).toHaveBeenCalledTimes(2);
      expect(plane.listModuleWorkItemIds).toHaveBeenCalledTimes(2);
    });
  });
});
