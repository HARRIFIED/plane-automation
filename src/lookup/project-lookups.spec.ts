import type {
  PlaneCycle,
  PlaneEstimatePoint,
  PlaneLabel,
  PlaneMember,
  PlaneProjectModule,
  PlaneState,
} from '../plane';
import { ProjectLookups } from './project-lookups';
import type { ProjectLookupTables } from './project-lookups';

const state = (overrides: Partial<PlaneState> & Pick<PlaneState, 'id' | 'name' | 'group'>): PlaneState => ({
  color: '#000000',
  sequence: 1,
  description: '',
  default: false,
  project: 'project-1',
  workspace: 'workspace-1',
  ...overrides,
});

const member = (overrides: Partial<PlaneMember> & Pick<PlaneMember, 'id'>): PlaneMember => ({
  first_name: '',
  last_name: '',
  email: '',
  display_name: '',
  avatar: null,
  avatar_url: null,
  ...overrides,
});

const tables: ProjectLookupTables = {
  projectId: 'project-1',
  fetchedAt: '2026-08-09T10:00:00.000Z',
  states: [
    state({ id: 'state-todo', name: 'Todo', group: 'unstarted' }),
    state({ id: 'state-doing', name: 'In Progress', group: 'started' }),
    state({ id: 'state-review', name: 'In Review', group: 'started' }),
    state({ id: 'state-done', name: 'Done', group: 'completed' }),
  ],
  labels: [
    { id: 'label-bug', name: 'bug', color: '#f00', description: '', parent: null, sort_order: 1, project: 'project-1', workspace: 'workspace-1' } as PlaneLabel,
  ],
  members: [
    member({ id: 'user-ada', first_name: 'Ada', last_name: 'Lovelace', email: 'ada@sagegreytech.com', display_name: 'ada' }),
    member({ id: 'user-handle', display_name: 'grace', email: 'grace@sagegreytech.com' }),
    member({ id: 'user-email-only', email: 'contractor@example.com' }),
  ],
  modules: [{ id: 'module-1', name: 'Billing' } as PlaneProjectModule],
  cycles: [{ id: 'cycle-1', name: 'Sprint 12' } as PlaneCycle],
  estimatePoints: [{ id: 'estimate-1', key: 3, value: '3' } as PlaneEstimatePoint],
};

describe('ProjectLookups', () => {
  let lookups: ProjectLookups;

  beforeEach(() => {
    lookups = new ProjectLookups(tables);
  });

  describe('resolving UUIDs to names', () => {
    it('resolves states, labels, modules and cycles', () => {
      expect(lookups.stateName('state-doing')).toBe('In Progress');
      expect(lookups.labelName('label-bug')).toBe('bug');
      expect(lookups.moduleName('module-1')).toBe('Billing');
      expect(lookups.cycleName('cycle-1')).toBe('Sprint 12');
    });

    it('prefers a full name for a person', () => {
      expect(lookups.memberName('user-ada')).toBe('Ada Lovelace');
    });

    it('falls back to the handle, then the email, when names are unset', () => {
      // Both are optional on a Plane account, so neither can be assumed present.
      expect(lookups.memberName('user-handle')).toBe('grace');
      expect(lookups.memberName('user-email-only')).toBe('contractor@example.com');
    });

    it('returns an empty cell for a work item with no state', () => {
      expect(lookups.stateName(null)).toBe('');
    });

    it('resolves arrays for the joined assignee and label columns', () => {
      expect(lookups.memberNames(['user-ada', 'user-handle'])).toEqual(['Ada Lovelace', 'grace']);
      expect(lookups.labelNames([])).toEqual([]);
    });
  });

  describe('unresolvable ids', () => {
    it('degrades to a readable placeholder rather than undefined', () => {
      // Routine: a work item keeps its assignee after that person leaves the project.
      expect(lookups.memberName('7f3e9a11-dead-beef-0000-000000000000')).toBe('Unknown user (7f3e9a11)');
      expect(lookups.labelName('deadbeef-0000-0000-0000-000000000000')).toBe('Unknown label (deadbeef)');
    });

    it('records what could not be resolved, so the summary sheet can explain it', () => {
      lookups.memberName('7f3e9a11-dead-beef-0000-000000000000');
      lookups.memberName('7f3e9a11-dead-beef-0000-000000000000'); // same id twice
      lookups.stateName('cafebabe-0000-0000-0000-000000000000');

      expect(lookups.hasUnresolved()).toBe(true);
      expect(lookups.unresolved()).toEqual({
        user: ['7f3e9a11-dead-beef-0000-000000000000'],
        state: ['cafebabe-0000-0000-0000-000000000000'],
      });
    });

    it('reports nothing unresolved when everything matched', () => {
      lookups.memberName('user-ada');

      expect(lookups.hasUnresolved()).toBe(false);
      expect(lookups.unresolved()).toEqual({});
    });
  });

  describe('resolving human input to UUIDs', () => {
    it('matches a state name case-insensitively', () => {
      expect(lookups.findStatesByName('in progress').map((s) => s.id)).toEqual(['state-doing']);
      expect(lookups.findStatesByName('  IN PROGRESS  ').map((s) => s.id)).toEqual(['state-doing']);
    });

    it('expands a state group to every state in it', () => {
      expect(lookups.findStatesByGroup('started').map((s) => s.id)).toEqual(['state-doing', 'state-review']);
    });

    it('matches a person by email, handle, full name or first name', () => {
      expect(lookups.findMembers('ada@sagegreytech.com').map((m) => m.id)).toEqual(['user-ada']);
      expect(lookups.findMembers('ada').map((m) => m.id)).toEqual(['user-ada']);
      expect(lookups.findMembers('Ada Lovelace').map((m) => m.id)).toEqual(['user-ada']);
      expect(lookups.findMembers('grace').map((m) => m.id)).toEqual(['user-handle']);
    });

    it('returns nothing rather than guessing when there is no match', () => {
      expect(lookups.findMembers('nobody')).toEqual([]);
      expect(lookups.findStatesByName('Shipped')).toEqual([]);
    });

    it('knows whether an id is a current member', () => {
      expect(lookups.isKnownMember('user-ada')).toBe(true);
      expect(lookups.isKnownMember('user-departed')).toBe(false);
    });
  });

  it('exposes the state group, which the filter engine needs', () => {
    expect(lookups.stateGroup('state-done')).toBe('completed');
    expect(lookups.stateGroup(null)).toBeNull();
    expect(lookups.stateGroup('unknown')).toBeNull();
  });

  it('carries the fetch timestamp through for the summary sheet', () => {
    expect(lookups.fetchedAt).toBe('2026-08-09T10:00:00.000Z');
  });
});
