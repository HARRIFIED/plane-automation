import { Injectable, Logger } from '@nestjs/common';

import { applyFilter, assertNoUnmatched, filterNeedsMembership, resolveFilter } from '../filter';
import type { ExportFilter } from '../filter';
import { LookupService } from '../lookup';
import type { MembershipIndex } from '../lookup';
import { PlaneApiClient } from '../plane';
import type { PlaneProject } from '../plane';
import { columnsNeedMembership, resolveColumns } from './columns';
import type { ExportColumnKey } from './columns';
import { describeFilter } from './filter-description';
import { buildRows } from './export-row';
import type { ExportRequest, ExportResult } from './export.types';
import { parseGroupBy } from './grouping';
import { ProjectResolver } from './project-resolver';
import { resolveTheme } from './theme';
import { buildWorkbook } from './workbook-builder';
import type { SheetData } from './workbook-builder';

/**
 * Assembles an export: resolve projects, load lookups, pull work items, filter, write.
 *
 * The order is deliberate and matches the brief's fetching strategy — the whole project is
 * pulled once and filtered in memory, so a narrow filter costs the same as a broad one and
 * ten filter combinations over one project cost one pull.
 */
@Injectable()
export class ExportService {
  private readonly logger = new Logger(ExportService.name);

  constructor(
    private readonly plane: PlaneApiClient,
    private readonly lookups: LookupService,
    private readonly projects: ProjectResolver,
  ) {}

  async export(request: ExportRequest): Promise<ExportResult> {
    const startedAt = Date.now();

    const columns = resolveColumns(request.columns);
    // Both throw on bad input, and both run before any network call so a typo in a colour or a
    // group field fails immediately rather than after a minute of paging.
    const groupBy = parseGroupBy(request.groupBy);
    const theme = resolveTheme(request.theme);

    const filter = request.filter ?? {};
    const forceRefresh = request.forceRefresh ?? false;
    const onUnmatched = request.onUnmatchedFilter ?? 'refuse';

    const projects = await this.projects.resolveMany(request.projects, { forceRefresh });

    /**
     * The auto-detect. Membership costs one request per module plus one per cycle, so it is
     * only loaded when something actually needs it: either a module/cycle column is being
     * written, or a module/cycle filter is being applied.
     */
    const needsMembership = columnsNeedMembership(columns) || filterNeedsMembership(filter);

    if (needsMembership) {
      this.logger.debug('Export needs module/cycle membership; it will be loaded per project');
    }

    const warnings: string[] = [];
    const sheets: SheetData[] = [];
    let totalBeforeFilter = 0;

    for (const project of projects) {
      const sheet = await this.buildProjectSheet({
        project,
        filter,
        columns,
        forceRefresh,
        needsMembership,
        onUnmatched,
        warnings,
      });

      totalBeforeFilter += sheet.totalBeforeFilter;
      sheets.push(sheet.data);
    }

    const generatedAt = new Date();
    const buffer = await buildWorkbook({
      columns,
      groupBy,
      theme,
      summary: {
        generatedAt,
        filterDescription: describeFilter(request.filter, { groupBy }),
        warnings,
        sheets,
      },
    });

    const rowCount = sheets.reduce((total, sheet) => total + sheet.rows.length, 0);

    this.logger.log(
      `Exported ${rowCount} of ${totalBeforeFilter} work item(s) from ` +
        `${projects.map((project) => project.identifier).join(', ')} in ${Date.now() - startedAt}ms`,
    );

    return {
      buffer,
      filename: this.filename(projects, generatedAt),
      rowCount,
      totalBeforeFilter,
      warnings,
    };
  }

  private async buildProjectSheet(context: {
    project: PlaneProject;
    filter: ExportFilter;
    columns: readonly ExportColumnKey[];
    forceRefresh: boolean;
    needsMembership: boolean;
    onUnmatched: 'refuse' | 'warn';
    warnings: string[];
  }): Promise<{ data: SheetData; totalBeforeFilter: number }> {
    const { project, filter, forceRefresh, needsMembership, onUnmatched, warnings } = context;

    // Lookups first: filters are written in names, so they cannot be resolved without them.
    const lookups = await this.lookups.getLookups(project.id, { forceRefresh });

    const resolved = resolveFilter(filter, lookups);

    if (resolved.unmatched.length > 0) {
      if (onUnmatched === 'refuse') {
        // Fail loudly. An empty export caused by a typo is indistinguishable from a truthful
        // "nothing matches", which is the worst outcome for anything used for reporting.
        assertNoUnmatched(resolved);
      }

      for (const miss of resolved.unmatched) {
        const suggestion = miss.didYouMean?.length ? ` (did you mean ${miss.didYouMean.join(', ')}?)` : '';
        warnings.push(`${project.identifier}: ${miss.field} value "${miss.value}" matched nothing${suggestion}`);
      }
    }

    let membership: MembershipIndex | undefined;
    if (needsMembership) {
      membership = await this.lookups.getMembership(project.id, { forceRefresh });
    }

    const items = await this.plane.listAllWorkItems(project.id);
    const filtered = applyFilter(items, resolved, { membership });

    const rows = buildRows(filtered, {
      project,
      lookups,
      membership,
      workItemUrl: (projectId, workItemId) => this.plane.workItemUrl(projectId, workItemId),
    });

    // Resolution records unresolvable ids as a side effect, so this has to be read after the
    // rows are built. Surfacing it explains an otherwise baffling "Unknown user" cell.
    if (lookups.hasUnresolved()) {
      const unresolved = lookups.unresolved();
      for (const [kind, ids] of Object.entries(unresolved)) {
        warnings.push(
          `${project.identifier}: ${ids.length} ${kind} reference(s) could not be resolved — ` +
            'most often someone who has left the project, or an entity deleted after the fact',
        );
      }
    }

    return {
      data: { projectName: project.name, projectIdentifier: project.identifier, rows },
      totalBeforeFilter: items.length,
    };
  }

  /** e.g. ENG-export-2026-08-09.xlsx, or multi-project-export-2026-08-09.xlsx. */
  private filename(projects: readonly PlaneProject[], generatedAt: Date): string {
    const date = generatedAt.toISOString().slice(0, 10);
    const stem =
      projects.length === 1 && projects[0] ? projects[0].identifier : `${projects.length}-projects`;

    return `${stem}-export-${date}.xlsx`;
  }
}
