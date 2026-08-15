import { Logger, LogLevel } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { writeFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import { parseArgs } from 'node:util';

import { AppModule } from '../app.module';
import { EXPORT_COLUMN_KEYS, ExportService } from '../export';
import type { ExportRequest } from '../export';
import type { ExportFilter } from '../filter';

/**
 * CLI entry point, so exports can be run locally without deploying the service.
 *
 * Argument parsing uses Node's built-in `parseArgs` rather than a CLI library — the surface is
 * a dozen flags and this keeps the dependency list to what the brief listed.
 */

const USAGE = `
Export Plane work items to Excel.

Usage:
  npm run export -- --project ENG [options]

Required:
  --project <key>            Project key, name or UUID. Repeat for multiple projects
                             (each gets its own tab).

Filters (repeat a flag or comma-separate to OR its values; different flags are AND'ed):
  --state <name>             State name, e.g. "In Progress"
  --state-group <group>      backlog | unstarted | started | completed | cancelled
  --assignee <who>           Email, @handle, full name, or "unassigned".
                             Several: --assignee victor,harrison,buchi
  --label <name>             Label name, or "none" for unlabelled
  --module <name>            Module name, or "none" for no module
  --cycle <name>             Cycle name, or "none" for no cycle
  --priority <level>         urgent | high | medium | low | none
  --updated-from <date>      Last modified on or after. Covers created AND moved
  --updated-to <date>        Last modified on or before
  --created-from <date>      YYYY-MM-DD (inclusive)
  --created-to <date>        YYYY-MM-DD (inclusive)
  --completed-from <date>    YYYY-MM-DD (inclusive)
  --completed-to <date>      YYYY-MM-DD (inclusive)
  --search <text>            Match against name and description

Dates accept YYYY-MM-DD, a full ISO timestamp, or a relative "7d" / "2w"
(N days or weeks ago) — handy for a weekly export that never needs editing.

Options:
  --out <path>               Output file. Defaults to <PROJECT>-export-<date>.xlsx
  --columns <list>           Comma separated subset of columns to include
  --refresh                  Bypass the lookup cache
  --warn-unmatched           Continue despite filter values that match nothing
                             (default is to stop and tell you)
  --quiet                    Only log warnings and errors
  --help                     Show this message

Available columns:
  ${EXPORT_COLUMN_KEYS.join(', ')}

Examples:
  npm run export -- --project ENG
  npm run export -- --project ENG --state-group started --assignee unassigned
  npm run export -- --project ENG --label bug --created-from 2026-07-01 --out bugs.xlsx
  npm run export -- --project ENG --columns identifier,name,state,assignees

  # This week's movement — anything created or moved in the last 7 days
  npm run export -- --project ENG --updated-from 7d

  # Only what these three worked on, this week
  npm run export -- --project ENG --updated-from 7d --assignee victor,harrison,buchi
`;

async function main(): Promise<void> {
  const { values } = parseArgs({
    // process.argv[2] onward; parseArgs handles the rest.
    options: {
      project: { type: 'string', multiple: true },
      state: { type: 'string', multiple: true },
      'state-group': { type: 'string', multiple: true },
      assignee: { type: 'string', multiple: true },
      label: { type: 'string', multiple: true },
      module: { type: 'string', multiple: true },
      cycle: { type: 'string', multiple: true },
      priority: { type: 'string', multiple: true },
      'created-from': { type: 'string' },
      'created-to': { type: 'string' },
      'completed-from': { type: 'string' },
      'completed-to': { type: 'string' },
      'updated-from': { type: 'string' },
      'updated-to': { type: 'string' },
      search: { type: 'string' },
      out: { type: 'string' },
      columns: { type: 'string' },
      refresh: { type: 'boolean', default: false },
      'warn-unmatched': { type: 'boolean', default: false },
      quiet: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    allowPositionals: false,
  });

  if (values.help || !values.project || values.project.length === 0) {
    process.stdout.write(USAGE);
    // Asking for help is a success; forgetting --project is not.
    finish(values.help ? 0 : 1);
    return;
  }

  const filter: ExportFilter = {
    states: split(values.state),
    stateGroups: split(values['state-group']) as ExportFilter['stateGroups'],
    assignees: split(values.assignee),
    labels: split(values.label),
    modules: split(values.module),
    cycles: split(values.cycle),
    priorities: split(values.priority) as ExportFilter['priorities'],
    createdBetween: range(values['created-from'], values['created-to']),
    completedBetween: range(values['completed-from'], values['completed-to']),
    updatedBetween: range(values['updated-from'], values['updated-to']),
    search: values.search,
  };

  const request: ExportRequest = {
    projects: values.project,
    filter,
    columns: values.columns?.split(',').map((column) => column.trim()),
    forceRefresh: values.refresh,
    onUnmatchedFilter: values['warn-unmatched'] ? 'warn' : 'refuse',
  };

  // Quiet by default about framework noise: this is a command, not a server.
  const logLevels: LogLevel[] = values.quiet ? ['warn', 'error'] : ['log', 'warn', 'error'];
  const app = await NestFactory.createApplicationContext(AppModule, { logger: logLevels });
  const logger = new Logger('Export');

  try {
    const result = await app.get(ExportService).export(request);
    const destination = resolvePath(process.cwd(), values.out ?? result.filename);

    await writeFile(destination, result.buffer);

    for (const warning of result.warnings) logger.warn(warning);

    // Straight to stdout rather than through the logger: where the file landed is the whole
    // point of running the command, so --quiet must not suppress it.
    process.stdout.write(`\nWrote ${result.rowCount} of ${result.totalBeforeFilter} work item(s)\n${destination}\n\n`);

    if (result.rowCount === 0) {
      logger.warn('The export is empty. Check the filters — or the project genuinely has no matching work items.');
    }
  } finally {
    await app.close();
  }
}

/**
 * Set the exit status and let the event loop drain.
 *
 * Calling process.exit() directly here trips a libuv assertion on Windows when a handle is
 * still closing (the HTTP agent's keep-alive sockets, or Redis). Setting exitCode lets Node
 * finish cleanly; the unref'd timer is a backstop that only fires if something is still
 * holding the loop open, and never keeps the process alive on its own.
 */
function finish(code: number): void {
  process.exitCode = code;

  const backstop = setTimeout(() => process.exit(code), 2000);
  backstop.unref();
}

function range(from?: string, to?: string): { from?: string; to?: string } | undefined {
  return from || to ? { from, to } : undefined;
}

/**
 * Accept both `--assignee a --assignee b` and `--assignee a,b`.
 *
 * Comma-separating is how people naturally type a list, and repeating a flag three times to
 * name three teammates is tedious. The trade-off: a state or label whose name genuinely
 * contains a comma cannot be filtered this way. That is rare enough to accept, and the
 * unmatched-value guard catches it with a suggestion rather than silently returning nothing.
 */
function split(values: string[] | undefined): string[] | undefined {
  if (!values || values.length === 0) return undefined;

  const flattened = values
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  return flattened.length > 0 ? flattened : undefined;
}

void main().catch((error: unknown) => {
  // A stack trace is noise for a CLI misuse; the message carries what to fix.
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`\nExport failed: ${message}\n\n`);
  finish(1);
});
