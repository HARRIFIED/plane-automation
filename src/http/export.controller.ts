import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Logger,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';

import { EXPORT_COLUMN_KEYS, ExportService } from '../export';
import type { ExportRequest } from '../export';
import { PLANE_PRIORITIES, PLANE_STATE_GROUPS } from '../plane';
import { exportRequestSchema } from './export-request.dto';

/**
 * HTTP surface for exports.
 *
 * Two shapes for two callers: POST with a JSON body for anything programmatic, and GET with
 * query parameters so an export is a shareable URL someone can bookmark.
 *
 * Unmatched filter values default to `warn` here, unlike the CLI's `refuse`. A browser
 * download that fails with a 400 loses the work; one that arrives with the problem recorded on
 * the summary sheet does not. Pass onUnmatchedFilter to override.
 */
@Controller('exports')
export class ExportController {
  private readonly logger = new Logger(ExportController.name);

  constructor(private readonly exports: ExportService) {}

  /** Self-describing metadata, so a caller can discover the filter vocabulary. */
  @Get('schema')
  schema(): Record<string, unknown> {
    return {
      columns: EXPORT_COLUMN_KEYS,
      stateGroups: PLANE_STATE_GROUPS.filter((group) => group !== 'triage'),
      priorities: PLANE_PRIORITIES,
      absenceTokens: {
        assignees: 'unassigned',
        labels: 'none',
        modules: 'none',
        cycles: 'none',
      },
      notes: [
        'Values within one filter field are OR-ed; different fields are AND-ed.',
        'Dates accept YYYY-MM-DD (whole day, UTC) or a full ISO timestamp.',
        'Archived, draft and triage work items are not returned by the Plane API.',
      ],
    };
  }

  // 200, not Nest's default 201 for POST: this returns a file, it does not create a resource.
  @Post()
  @HttpCode(200)
  async create(@Body() body: unknown, @Res({ passthrough: true }) response: Response): Promise<void> {
    await this.run(this.parse(body), response);
  }

  /**
   * GET form, e.g.
   *   /exports?project=ENG&stateGroup=started&assignee=unassigned
   *
   * Repeated parameters become arrays, which Express handles natively.
   */
  @Get()
  @Header('Cache-Control', 'no-store')
  async download(@Query() query: Record<string, unknown>, @Res({ passthrough: true }) response: Response): Promise<void> {
    const request = this.parse({
      projects: toArray(query.project ?? query.projects),
      filter: {
        states: toArray(query.state),
        stateGroups: toArray(query.stateGroup),
        assignees: toArray(query.assignee),
        labels: toArray(query.label),
        modules: toArray(query.module),
        cycles: toArray(query.cycle),
        priorities: toArray(query.priority),
        createdBetween: range(query.createdFrom, query.createdTo),
        completedBetween: range(query.completedFrom, query.completedTo),
        updatedBetween: range(query.updatedFrom, query.updatedTo),
        search: query.search,
      },
      columns: typeof query.columns === 'string' ? query.columns.split(',') : undefined,
      forceRefresh: query.refresh === 'true' || query.refresh === '1',
      onUnmatchedFilter: query.onUnmatchedFilter,
    });

    await this.run(request, response);
  }

  private parse(input: unknown): ExportRequest {
    const result = exportRequestSchema.safeParse(input);

    if (!result.success) {
      throw new BadRequestException({
        message: 'Invalid export request',
        problems: result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
      });
    }

    return { onUnmatchedFilter: 'warn', ...result.data } as ExportRequest;
  }

  private async run(request: ExportRequest, response: Response): Promise<void> {
    const result = await this.exports.export(request);

    for (const warning of result.warnings) this.logger.warn(warning);

    response.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    response.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    response.setHeader('Content-Length', result.buffer.length);
    // Surfaced as headers so a caller can see what happened without opening the file.
    response.setHeader('X-Export-Row-Count', String(result.rowCount));
    response.setHeader('X-Export-Total-Before-Filter', String(result.totalBeforeFilter));

    response.end(result.buffer);
  }
}

/**
 * Normalise a query parameter into a list.
 *
 * Both `?assignee=a&assignee=b` and `?assignee=a,b` work, matching the CLI. The same caveat
 * applies: a value containing a comma cannot be expressed this way.
 */
function toArray(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;

  const raw = Array.isArray(value) ? value.map(String) : [String(value)];

  const flattened = raw
    .flatMap((entry) => entry.split(','))
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return flattened.length > 0 ? flattened : undefined;
}

function range(from: unknown, to: unknown): { from?: string; to?: string } | undefined {
  const parsedFrom = typeof from === 'string' && from ? from : undefined;
  const parsedTo = typeof to === 'string' && to ? to : undefined;

  return parsedFrom || parsedTo ? { from: parsedFrom, to: parsedTo } : undefined;
}
