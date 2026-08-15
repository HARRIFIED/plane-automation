import ExcelJS from 'exceljs';

import { makeLookups, MEMBERSHIP, WORK_ITEMS } from '../filter/filter.fixtures';
import type { LookupService } from '../lookup';
import type { PlaneApiClient, PlaneProject } from '../plane';
import { ExportService } from './export.service';
import type { ProjectResolver } from './project-resolver';

const ENGINEERING = { id: 'project-1', identifier: 'ENG', name: 'Engineering' } as PlaneProject;
const PLATFORM = { id: 'project-2', identifier: 'PLAT', name: 'Platform' } as PlaneProject;

function makeDependencies() {
  const plane = {
    listAllWorkItems: jest.fn().mockResolvedValue(WORK_ITEMS),
    workItemUrl: jest.fn((projectId: string, itemId: string) => `https://plane.test/${projectId}/${itemId}`),
  };

  const lookups = {
    getLookups: jest.fn().mockImplementation(async () => makeLookups()),
    getMembership: jest.fn().mockResolvedValue(MEMBERSHIP),
  };

  const projects = {
    resolveMany: jest.fn().mockResolvedValue([ENGINEERING]),
  };

  return { plane, lookups, projects };
}

function makeService(dependencies = makeDependencies()) {
  const service = new ExportService(
    dependencies.plane as unknown as PlaneApiClient,
    dependencies.lookups as unknown as LookupService,
    dependencies.projects as unknown as ProjectResolver,
  );

  return { service, ...dependencies };
}

async function sheetOf(buffer: Buffer, name: string): Promise<ExcelJS.Worksheet | undefined> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  return workbook.getWorksheet(name);
}

describe('ExportService', () => {
  it('exports a whole project when no filter is given', async () => {
    const { service } = makeService();

    const result = await service.export({ projects: ['ENG'] });

    expect(result.rowCount).toBe(WORK_ITEMS.length);
    expect(result.totalBeforeFilter).toBe(WORK_ITEMS.length);
    expect(result.buffer.length).toBeGreaterThan(0);
  });

  it('names the file after the project and the date', async () => {
    const { service } = makeService();

    const result = await service.export({ projects: ['ENG'] });

    expect(result.filename).toMatch(/^ENG-export-\d{4}-\d{2}-\d{2}\.xlsx$/);
  });

  it('applies filters and reports both counts', async () => {
    const { service } = makeService();

    const result = await service.export({ projects: ['ENG'], filter: { priorities: ['urgent'] } });

    expect(result.rowCount).toBe(2);
    expect(result.totalBeforeFilter).toBe(WORK_ITEMS.length);
  });

  it('pulls the project once regardless of how narrow the filter is', async () => {
    const { service, plane } = makeService();

    await service.export({ projects: ['ENG'], filter: { states: ['Done'] } });

    expect(plane.listAllWorkItems).toHaveBeenCalledTimes(1);
  });

  describe('membership auto-detect', () => {
    it('loads membership when a module or cycle column is included', async () => {
      const { service, lookups } = makeService();

      await service.export({ projects: ['ENG'], columns: ['identifier', 'cycle'] });

      expect(lookups.getMembership).toHaveBeenCalledTimes(1);
    });

    it('skips membership entirely when nothing needs it', async () => {
      // The whole point of the auto-detect: a request per module and per cycle, not paid for.
      const { service, lookups } = makeService();

      await service.export({ projects: ['ENG'], columns: ['identifier', 'name', 'state'] });

      expect(lookups.getMembership).not.toHaveBeenCalled();
    });

    it('loads membership for a module filter even when the column is not shown', async () => {
      const { service, lookups } = makeService();

      await service.export({
        projects: ['ENG'],
        columns: ['identifier'],
        filter: { modules: ['Billing'] },
      });

      expect(lookups.getMembership).toHaveBeenCalledTimes(1);
    });

    it('loads membership by default, since the default columns include both', async () => {
      const { service, lookups } = makeService();

      await service.export({ projects: ['ENG'] });

      expect(lookups.getMembership).toHaveBeenCalledTimes(1);
    });
  });

  describe('unmatched filter values', () => {
    it('refuses by default rather than returning a misleading empty export', async () => {
      const { service } = makeService();

      await expect(
        service.export({ projects: ['ENG'], filter: { states: ['In Progres'] } }),
      ).rejects.toThrow(/do not exist/);
    });

    it('proceeds and warns when asked to', async () => {
      const { service } = makeService();

      const result = await service.export({
        projects: ['ENG'],
        filter: { states: ['In Progres'] },
        onUnmatchedFilter: 'warn',
      });

      expect(result.warnings.some((warning) => warning.includes('matched nothing'))).toBe(true);
    });

    it('records the warning on the summary sheet, not just in the response', async () => {
      const { service } = makeService();

      const result = await service.export({
        projects: ['ENG'],
        filter: { labels: ['bugg'] },
        onUnmatchedFilter: 'warn',
      });

      const sheet = await sheetOf(result.buffer, 'Summary');
      const text: string[] = [];
      sheet?.eachRow((row) => row.eachCell({ includeEmpty: false }, (cell) => text.push(String(cell.value ?? ''))));

      expect(text.join(' ')).toContain('matched nothing');
    });
  });

  it('warns about references it could not resolve', async () => {
    // An assignee who has left the project still appears on their old work items.
    const { service, plane } = makeService();
    plane.listAllWorkItems.mockResolvedValue([
      { ...WORK_ITEMS[0]!, assignees: ['user-departed-000000000000000000000000'] },
    ]);

    const result = await service.export({ projects: ['ENG'] });

    expect(result.warnings.some((warning) => warning.includes('could not be resolved'))).toBe(true);
  });

  it('gives each project its own tab', async () => {
    const dependencies = makeDependencies();
    dependencies.projects.resolveMany.mockResolvedValue([ENGINEERING, PLATFORM]);
    const { service } = makeService(dependencies);

    const result = await service.export({ projects: ['ENG', 'PLAT'] });

    expect(await sheetOf(result.buffer, 'Engineering')).toBeDefined();
    expect(await sheetOf(result.buffer, 'Platform')).toBeDefined();
    expect(result.rowCount).toBe(WORK_ITEMS.length * 2);
    expect(result.filename).toMatch(/^2-projects-export/);
  });

  it('passes a forced refresh through to the lookups', async () => {
    const { service, lookups } = makeService();

    await service.export({ projects: ['ENG'], forceRefresh: true });

    expect(lookups.getLookups).toHaveBeenCalledWith('project-1', { forceRefresh: true });
  });

  it('rejects an unknown column before doing any work', async () => {
    const { service, plane } = makeService();

    await expect(service.export({ projects: ['ENG'], columns: ['nope'] })).rejects.toThrow(/Unknown column/);
    expect(plane.listAllWorkItems).not.toHaveBeenCalled();
  });

  it('still produces a valid workbook when nothing matches', async () => {
    const { service } = makeService();

    const result = await service.export({ projects: ['ENG'], filter: { search: 'nothing matches this' } });

    expect(result.rowCount).toBe(0);
    expect(await sheetOf(result.buffer, 'Engineering')).toBeDefined();
  });
});
