import { ProjectLookups } from '../lookup';
import type { MembershipIndex } from '../lookup';
import type {
  PlaneCycle,
  PlaneEstimatePoint,
  PlaneLabel,
  PlaneMember,
  PlaneProjectModule,
  PlaneState,
  PlaneWorkItem,
} from '../plane';

/**
 * A small but realistic project, shared by the resolver and engine tests.
 *
 * Shaped to cover the cases that actually break filters: an unassigned item, an item in no
 * cycle, multiple assignees on one item, multiple labels, an item with no state, an item that
 * was never completed, and a label whose name collides with the "none" sentinel.
 */

const PROJECT_ID = 'project-1';

function state(id: string, name: string, group: PlaneState['group']): PlaneState {
  return {
    id,
    name,
    group,
    color: '#888888',
    sequence: 1,
    description: '',
    default: false,
    project: PROJECT_ID,
    workspace: 'workspace-1',
  };
}

function label(id: string, name: string): PlaneLabel {
  return {
    id,
    name,
    color: '#ff0000',
    description: '',
    parent: null,
    sort_order: 1,
    project: PROJECT_ID,
    workspace: 'workspace-1',
  };
}

function member(id: string, first: string, last: string, email: string, handle: string): PlaneMember {
  return {
    id,
    first_name: first,
    last_name: last,
    email,
    display_name: handle,
    avatar: null,
    avatar_url: null,
  };
}

export const STATES = {
  backlog: state('state-backlog', 'Backlog', 'backlog'),
  todo: state('state-todo', 'Todo', 'unstarted'),
  doing: state('state-doing', 'In Progress', 'started'),
  review: state('state-review', 'In Review', 'started'),
  done: state('state-done', 'Done', 'completed'),
  cancelled: state('state-cancelled', 'Cancelled', 'cancelled'),
};

export const LABELS = {
  bug: label('label-bug', 'bug'),
  frontend: label('label-frontend', 'frontend'),
  /** Deliberately named "none" to prove a real entity beats the absence sentinel. */
  none: label('label-none', 'none'),
};

export const MEMBERS = {
  ada: member('user-ada', 'Ada', 'Lovelace', 'ada@sagegreytech.com', 'ada'),
  grace: member('user-grace', 'Grace', 'Hopper', 'grace@sagegreytech.com', 'grace'),
};

export const MODULES = {
  billing: { id: 'module-billing', name: 'Billing' } as PlaneProjectModule,
  auth: { id: 'module-auth', name: 'Auth' } as PlaneProjectModule,
};

export const CYCLES = {
  sprint12: { id: 'cycle-12', name: 'Sprint 12' } as PlaneCycle,
  sprint13: { id: 'cycle-13', name: 'Sprint 13' } as PlaneCycle,
};

export const ESTIMATE_POINTS = {
  three: { id: 'estimate-3', key: 3, value: '3' } as PlaneEstimatePoint,
  five: { id: 'estimate-5', key: 5, value: '5' } as PlaneEstimatePoint,
};

export function makeLookups(): ProjectLookups {
  return new ProjectLookups({
    projectId: PROJECT_ID,
    fetchedAt: '2026-08-09T09:00:00.000Z',
    states: Object.values(STATES),
    labels: Object.values(LABELS),
    members: Object.values(MEMBERS),
    modules: Object.values(MODULES),
    cycles: Object.values(CYCLES),
    estimatePoints: Object.values(ESTIMATE_POINTS),
  });
}

function workItem(overrides: Partial<PlaneWorkItem> & Pick<PlaneWorkItem, 'id' | 'name' | 'sequence_id'>): PlaneWorkItem {
  return {
    description_html: '<p></p>',
    priority: 'none',
    sort_order: 1,
    state: STATES.todo.id,
    assignees: [],
    labels: [],
    parent: null,
    project: PROJECT_ID,
    workspace: 'workspace-1',
    estimate_point: null,
    point: null,
    start_date: null,
    target_date: null,
    completed_at: null,
    archived_at: null,
    is_draft: false,
    created_at: '2026-06-01T10:00:00.000Z',
    updated_at: '2026-06-01T10:00:00.000Z',
    created_by: MEMBERS.ada.id,
    updated_by: null,
    external_source: null,
    external_id: null,
    ...overrides,
  };
}

export const WORK_ITEMS: PlaneWorkItem[] = [
  workItem({
    id: 'item-1',
    sequence_id: 1,
    name: 'Login page hangs on SSO',
    description_html: '<p>Users report the <strong>login</strong> page hangs.</p>',
    state: STATES.doing.id,
    priority: 'urgent',
    assignees: [MEMBERS.ada.id],
    labels: [LABELS.bug.id, LABELS.frontend.id],
    created_at: '2026-07-01T09:00:00.000Z',
    updated_at: '2026-08-01T11:00:00.000Z',
  }),
  workItem({
    id: 'item-2',
    sequence_id: 2,
    name: 'Add invoice export',
    description_html: '<p>Finance wants a CSV of invoices.</p>',
    state: STATES.todo.id,
    priority: 'high',
    assignees: [MEMBERS.grace.id, MEMBERS.ada.id],
    labels: [],
    created_at: '2026-07-15T09:00:00.000Z',
    updated_at: '2026-08-02T14:00:00.000Z',
  }),
  workItem({
    id: 'item-3',
    sequence_id: 3,
    name: 'Nobody owns this',
    state: STATES.backlog.id,
    priority: 'low',
    assignees: [],
    labels: [LABELS.bug.id],
    created_at: '2026-05-02T09:00:00.000Z',
    // Untouched since it was filed: the item a weekly "what moved" report should exclude.
    updated_at: '2026-05-02T09:00:00.000Z',
  }),
  workItem({
    id: 'item-4',
    sequence_id: 4,
    name: 'Ship billing rewrite',
    state: STATES.done.id,
    priority: 'medium',
    assignees: [MEMBERS.grace.id],
    labels: [],
    created_at: '2026-04-01T09:00:00.000Z',
    completed_at: '2026-07-20T16:30:00.000Z',
    updated_at: '2026-07-20T16:30:00.000Z',
  }),
  workItem({
    id: 'item-5',
    sequence_id: 5,
    name: 'Old cancelled thing',
    state: STATES.cancelled.id,
    priority: 'none',
    created_at: '2026-03-01T09:00:00.000Z',
    completed_at: '2026-03-15T09:00:00.000Z',
    // Filed in March, moved in August — the case that makes "updated" the right filter for a
    // weekly report, since filtering on created_at would miss it entirely.
    updated_at: '2026-08-01T08:00:00.000Z',
  }),
  workItem({
    id: 'item-6',
    sequence_id: 6,
    // No state at all: rare, but the API allows it and a filter must not crash on it.
    name: 'Stateless oddity',
    state: null,
    priority: 'urgent',
    assignees: [MEMBERS.ada.id],
    created_at: '2026-07-25T09:00:00.000Z',
    updated_at: '2026-07-25T09:00:00.000Z',
  }),
];

/** item-1 and item-2 are in modules; item-1 and item-4 are in cycles. */
export const MEMBERSHIP: MembershipIndex = {
  modulesByWorkItem: {
    'item-1': [MODULES.billing.id, MODULES.auth.id],
    'item-2': [MODULES.billing.id],
  },
  cycleByWorkItem: {
    'item-1': CYCLES.sprint12.id,
    'item-4': CYCLES.sprint13.id,
  },
  fetchedAt: '2026-08-09T09:00:00.000Z',
};
