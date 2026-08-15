import type { ProjectLookups } from '../lookup';
import { applyFilter } from './filter-engine';
import { makeLookups, MEMBERSHIP, WORK_ITEMS } from './filter.fixtures';
import { resolveFilter } from './filter-resolver';
import { filterNeedsMembership } from './filter.types';
import type { ExportFilter, FilterContext } from './index';

/** Run a human-written filter end to end and return the matching identifiers. */
function run(filter: ExportFilter, lookups: ProjectLookups, context: FilterContext = {}): string[] {
  return applyFilter(WORK_ITEMS, resolveFilter(filter, lookups), context).map((item) => item.id);
}

describe('applyFilter', () => {
  let lookups: ProjectLookups;

  beforeEach(() => {
    lookups = makeLookups();
  });

  it('returns everything when nothing is filtered', () => {
    expect(run({}, lookups)).toHaveLength(WORK_ITEMS.length);
  });

  describe('composition', () => {
    it('ORs values within one dimension', () => {
      expect(run({ priorities: ['urgent', 'high'] }, lookups).sort()).toEqual(['item-1', 'item-2', 'item-6']);
    });

    it('ANDs across dimensions', () => {
      // urgent AND assigned to Ada: item-6 is urgent but so is item-1; both are Ada's here,
      // so narrow further by state to prove the AND.
      expect(run({ priorities: ['urgent'], states: ['In Progress'] }, lookups)).toEqual(['item-1']);
    });

    it('returns nothing when dimensions contradict each other', () => {
      expect(run({ states: ['Done'], priorities: ['urgent'] }, lookups)).toEqual([]);
    });
  });

  describe('state', () => {
    it('filters by name', () => {
      expect(run({ states: ['Done'] }, lookups)).toEqual(['item-4']);
    });

    it('filters by group', () => {
      expect(run({ stateGroups: ['started'] }, lookups)).toEqual(['item-1']);
    });

    it('excludes an item with no state rather than crashing', () => {
      expect(run({ stateGroups: ['backlog'] }, lookups)).toEqual(['item-3']);
    });
  });

  describe('assignee', () => {
    it('matches any of an item\'s assignees', () => {
      // item-2 has two assignees; matching either should include it.
      expect(run({ assignees: ['grace'] }, lookups).sort()).toEqual(['item-2', 'item-4']);
    });

    it('finds unassigned work', () => {
      expect(run({ assignees: ['unassigned'] }, lookups).sort()).toEqual(['item-3', 'item-5']);
    });

    it('combines unassigned with a named person', () => {
      expect(run({ assignees: ['unassigned', 'grace'] }, lookups).sort()).toEqual([
        'item-2',
        'item-3',
        'item-4',
        'item-5',
      ]);
    });
  });

  describe('label', () => {
    it('matches any label on the item', () => {
      expect(run({ labels: ['bug'] }, lookups).sort()).toEqual(['item-1', 'item-3']);
    });

    it('finds unlabelled work when no label is named "none"', () => {
      // The fixture has a real "none" label, so ask for absence via "null".
      expect(run({ labels: ['null'] }, lookups).sort()).toEqual(['item-2', 'item-4', 'item-5', 'item-6']);
    });
  });

  describe('module and cycle', () => {
    const context = { membership: MEMBERSHIP };

    it('filters by module membership', () => {
      expect(run({ modules: ['Billing'] }, lookups, context).sort()).toEqual(['item-1', 'item-2']);
    });

    it('matches an item that belongs to several modules', () => {
      expect(run({ modules: ['Auth'] }, lookups, context)).toEqual(['item-1']);
    });

    it('filters by cycle', () => {
      expect(run({ cycles: ['Sprint 12'] }, lookups, context)).toEqual(['item-1']);
    });

    it('finds work in no cycle, which is what people actually look for', () => {
      expect(run({ cycles: ['none'] }, lookups, context).sort()).toEqual([
        'item-2',
        'item-3',
        'item-5',
        'item-6',
      ]);
    });

    it('finds work in no module', () => {
      expect(run({ modules: ['none'] }, lookups, context).sort()).toEqual([
        'item-3',
        'item-4',
        'item-5',
        'item-6',
      ]);
    });

    it('refuses to run a membership filter without the index, rather than returning nothing', () => {
      // Silently returning zero rows here would look exactly like "no work in that module".
      expect(() => run({ modules: ['Billing'] }, lookups)).toThrow(/membership index/);
    });
  });

  describe('priority', () => {
    it('filters by priority', () => {
      expect(run({ priorities: ['low'] }, lookups)).toEqual(['item-3']);
    });

    it('treats "none" priority as a value like any other', () => {
      expect(run({ priorities: ['none'] }, lookups).sort()).toEqual(['item-5']);
    });
  });

  describe('date ranges', () => {
    it('filters by creation date, inclusive of both boundary days', () => {
      expect(run({ createdBetween: { from: '2026-07-01', to: '2026-07-15' } }, lookups).sort()).toEqual([
        'item-1',
        'item-2',
      ]);
    });

    it('filters by completion date', () => {
      expect(run({ completedBetween: { from: '2026-07-01', to: '2026-07-31' } }, lookups)).toEqual(['item-4']);
    });

    it('excludes never-completed work from a completion range', () => {
      // A completed-date filter doubles as "only finished work".
      const results = run({ completedBetween: { from: '2026-01-01' } }, lookups);

      expect(results.sort()).toEqual(['item-4', 'item-5']);
    });

    it('supports an open-ended range', () => {
      expect(run({ createdBetween: { to: '2026-05-01' } }, lookups).sort()).toEqual(['item-4', 'item-5']);
    });

    describe('updated range — the weekly report case', () => {
      it('matches only work modified inside the window', () => {
        expect(run({ updatedBetween: { from: '2026-07-28', to: '2026-08-03' } }, lookups).sort()).toEqual([
          'item-1',
          'item-2',
          'item-5',
        ]);
      });

      it('excludes work not touched since it was filed', () => {
        // item-3 has sat untouched since May; a "what moved this week" report must skip it.
        expect(run({ updatedBetween: { from: '2026-07-28' } }, lookups)).not.toContain('item-3');
      });

      it('excludes everything when nothing moved in the window', () => {
        expect(run({ updatedBetween: { from: '2026-08-05' } }, lookups)).toEqual([]);
      });

      it('catches an item created long ago but moved recently', () => {
        // The reason "updated" is the right filter: item-5 was filed in March and moved in
        // August, so a created-date filter for August would miss it entirely.
        const window = { from: '2026-08-01', to: '2026-08-03' };

        expect(run({ updatedBetween: window }, lookups)).toContain('item-5');
        expect(run({ createdBetween: window }, lookups)).not.toContain('item-5');
      });

      it('covers newly created work too, since Plane sets updated_at on creation', () => {
        // Which is why one filter answers both halves of "created or moved this week".
        expect(run({ updatedBetween: { from: '2026-07-25', to: '2026-07-25' } }, lookups)).toEqual(['item-6']);
      });

      it('ANDs with assignees, for "what these people touched this week"', () => {
        const results = run(
          { updatedBetween: { from: '2026-07-28', to: '2026-08-03' }, assignees: ['ada', 'grace'] },
          lookups,
        );

        // item-5 moved in the window but is unassigned, so it drops out.
        expect(results.sort()).toEqual(['item-1', 'item-2']);
      });
    });
  });

  describe('free text search', () => {
    it('matches the name, case-insensitively', () => {
      expect(run({ search: 'LOGIN' }, lookups)).toEqual(['item-1']);
    });

    it('matches the description, ignoring its markup', () => {
      // "invoices" only appears inside description_html.
      expect(run({ search: 'invoices' }, lookups)).toEqual(['item-2']);
    });

    it('does not match on HTML tag names', () => {
      expect(run({ search: 'strong' }, lookups)).toEqual([]);
    });

    it('returns nothing for a term that appears nowhere', () => {
      expect(run({ search: 'kubernetes' }, lookups)).toEqual([]);
    });
  });

  describe('a realistic combination', () => {
    it('answers "unfinished bugs assigned to Ada, created in July"', () => {
      const results = run(
        {
          labels: ['bug'],
          assignees: ['ada'],
          stateGroups: ['started', 'unstarted'],
          createdBetween: { from: '2026-07-01', to: '2026-07-31' },
        },
        lookups,
      );

      expect(results).toEqual(['item-1']);
    });
  });
});

describe('filterNeedsMembership', () => {
  it('is true only when modules or cycles are involved', () => {
    // This is what drives the auto-detect: no module or cycle filter, no extra requests.
    expect(filterNeedsMembership({ modules: ['Billing'] })).toBe(true);
    expect(filterNeedsMembership({ cycles: ['none'] })).toBe(true);
    expect(filterNeedsMembership({ states: ['Done'], assignees: ['ada'] })).toBe(false);
    expect(filterNeedsMembership({})).toBe(false);
    expect(filterNeedsMembership({ modules: [] })).toBe(false);
  });
});
