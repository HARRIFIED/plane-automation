import { z } from 'zod';

import { EXPORT_COLUMN_KEYS } from '../export';
import { PLANE_PRIORITIES, PLANE_STATE_GROUPS } from '../plane';

/**
 * Validation for an incoming export request.
 *
 * Same schema library as the environment contract, for one way of describing a shape rather
 * than two. Values are validated but not resolved here — whether "In Progress" exists in a
 * given project is the resolver's business, since it depends on the project.
 */

const stringList = z.union([z.string(), z.array(z.string())]).transform((value) => (Array.isArray(value) ? value : [value]));

const dateRange = z
  .object({
    from: z.string().min(1).optional(),
    to: z.string().min(1).optional(),
  })
  .optional();

const filterSchema = z
  .object({
    states: stringList.optional(),
    stateGroups: z.union([z.enum(PLANE_STATE_GROUPS), z.array(z.enum(PLANE_STATE_GROUPS))])
      .transform((value) => (Array.isArray(value) ? value : [value]))
      .optional(),
    assignees: stringList.optional(),
    labels: stringList.optional(),
    modules: stringList.optional(),
    cycles: stringList.optional(),
    priorities: z.union([z.enum(PLANE_PRIORITIES), z.array(z.enum(PLANE_PRIORITIES))])
      .transform((value) => (Array.isArray(value) ? value : [value]))
      .optional(),
    createdBetween: dateRange,
    completedBetween: dateRange,
    updatedBetween: dateRange,
    search: z.string().optional(),
    excludeStates: stringList.optional(),
    excludeKeywords: stringList.optional(),
  })
  .optional();

/** 6-digit hex with an optional leading #, or Excel's 8-digit ARGB. */
const colour = z
  .string()
  .regex(/^#?([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, 'Use 6-digit hex such as #1F3A5F');

const themeSchema = z
  .object({
    headerColor: colour.optional(),
    headerTextColor: colour.optional(),
    groupColor: colour.optional(),
    bandColor: colour.optional(),
  })
  .optional();

export const exportRequestSchema = z.object({
  projects: stringList.refine((projects) => projects.length > 0, 'At least one project is required'),
  filter: filterSchema,
  columns: z
    .array(z.enum(EXPORT_COLUMN_KEYS))
    .nonempty('Specify at least one column, or omit the field for all of them')
    .optional(),
  groupBy: z.enum(['state', 'priority', 'assignee', 'assignees', 'module', 'cycle']).optional(),
  theme: themeSchema,
  forceRefresh: z.boolean().optional(),
  onUnmatchedFilter: z.enum(['refuse', 'warn']).optional(),
});

export type ExportRequestDto = z.infer<typeof exportRequestSchema>;
