import { CYCLES, LABELS, makeLookups, MEMBERS, MODULES, STATES } from './filter.fixtures';
import { assertNoUnmatched, resolveFilter } from './filter-resolver';
import type { ProjectLookups } from '../lookup';

describe('resolveFilter', () => {
  let lookups: ProjectLookups;

  beforeEach(() => {
    lookups = makeLookups();
  });

  describe('states', () => {
    it('resolves state names case-insensitively', () => {
      const resolved = resolveFilter({ states: ['in progress'] }, lookups);

      expect([...(resolved.stateIds ?? [])]).toEqual([STATES.doing.id]);
      expect(resolved.unmatched).toEqual([]);
    });

    it('expands a state group to every state in it', () => {
      const resolved = resolveFilter({ stateGroups: ['started'] }, lookups);

      expect([...(resolved.stateIds ?? [])].sort()).toEqual([STATES.doing.id, STATES.review.id].sort());
    });

    it('ORs names and groups into one dimension', () => {
      // "Done or anything in progress", not "Done AND in progress" — which matches nothing.
      const resolved = resolveFilter({ states: ['Done'], stateGroups: ['started'] }, lookups);

      expect([...(resolved.stateIds ?? [])].sort()).toEqual(
        [STATES.done.id, STATES.doing.id, STATES.review.id].sort(),
      );
    });

    it('reports a mistyped state with a suggestion instead of silently matching nothing', () => {
      const resolved = resolveFilter({ states: ['Progress'] }, lookups);

      expect(resolved.unmatched).toEqual([
        { field: 'states', value: 'Progress', didYouMean: ['In Progress'] },
      ]);
    });
  });

  describe('assignees', () => {
    it('resolves by email, handle and full name', () => {
      expect([...(resolveFilter({ assignees: ['ada@sagegreytech.com'] }, lookups).assigneeIds ?? [])]).toEqual([
        MEMBERS.ada.id,
      ]);
      expect([...(resolveFilter({ assignees: ['grace'] }, lookups).assigneeIds ?? [])]).toEqual([MEMBERS.grace.id]);
      expect([...(resolveFilter({ assignees: ['Ada Lovelace'] }, lookups).assigneeIds ?? [])]).toEqual([
        MEMBERS.ada.id,
      ]);
    });

    it('recognises "unassigned" as an explicit option', () => {
      const resolved = resolveFilter({ assignees: ['unassigned'] }, lookups);

      expect(resolved.includeUnassigned).toBe(true);
      expect(resolved.assigneeIds).toBeUndefined();
      expect(resolved.unmatched).toEqual([]);
    });

    it('combines unassigned with named people rather than overriding them', () => {
      const resolved = resolveFilter({ assignees: ['unassigned', 'ada'] }, lookups);

      expect(resolved.includeUnassigned).toBe(true);
      expect([...(resolved.assigneeIds ?? [])]).toEqual([MEMBERS.ada.id]);
    });

    it('flags an unknown person', () => {
      const resolved = resolveFilter({ assignees: ['nobody@example.com'] }, lookups);

      expect(resolved.unmatched[0]).toMatchObject({ field: 'assignees', value: 'nobody@example.com' });
    });
  });

  describe('the absence sentinel', () => {
    it('treats "none" as unlabelled when no such label exists', () => {
      const resolved = resolveFilter({ cycles: ['none'] }, lookups);

      expect(resolved.includeNoCycle).toBe(true);
      expect(resolved.cycleIds).toBeUndefined();
    });

    it('prefers a real entity named "none" over the sentinel', () => {
      // The fixture project has a label literally called "none".
      const resolved = resolveFilter({ labels: ['none'] }, lookups);

      expect(resolved.includeUnlabelled).toBe(false);
      expect([...(resolved.labelIds ?? [])]).toEqual([LABELS.none.id]);
    });

    it('supports no-module as well as no-cycle', () => {
      const resolved = resolveFilter({ modules: ['none'] }, lookups);

      expect(resolved.includeNoModule).toBe(true);
    });
  });

  describe('labels, modules and cycles', () => {
    it('resolves names to ids', () => {
      expect([...(resolveFilter({ labels: ['bug'] }, lookups).labelIds ?? [])]).toEqual([LABELS.bug.id]);
      expect([...(resolveFilter({ modules: ['Billing'] }, lookups).moduleIds ?? [])]).toEqual([MODULES.billing.id]);
      expect([...(resolveFilter({ cycles: ['Sprint 12'] }, lookups).cycleIds ?? [])]).toEqual([CYCLES.sprint12.id]);
    });

    it('ORs several values within one dimension', () => {
      const resolved = resolveFilter({ labels: ['bug', 'frontend'] }, lookups);

      expect([...(resolved.labelIds ?? [])].sort()).toEqual([LABELS.bug.id, LABELS.frontend.id].sort());
    });
  });

  describe('priorities', () => {
    it('normalises case', () => {
      const resolved = resolveFilter({ priorities: ['URGENT' as 'urgent'] }, lookups);

      expect([...(resolved.priorities ?? [])]).toEqual(['urgent']);
    });

    it('rejects a value Plane does not have, listing the real ones', () => {
      const resolved = resolveFilter({ priorities: ['critical' as 'urgent'] }, lookups);

      expect(resolved.unmatched[0]).toMatchObject({ field: 'priorities', value: 'critical' });
      expect(resolved.unmatched[0]?.didYouMean).toContain('urgent');
    });
  });

  describe('date ranges', () => {
    it('covers the whole of both boundary days for a date-only range', () => {
      const resolved = resolveFilter({ createdBetween: { from: '2026-07-01', to: '2026-07-31' } }, lookups);

      expect(resolved.createdRange).toEqual({
        fromMs: Date.parse('2026-07-01T00:00:00.000Z'),
        toMs: Date.parse('2026-07-31T23:59:59.999Z'),
      });
    });

    it('accepts a full ISO timestamp unchanged', () => {
      const resolved = resolveFilter({ createdBetween: { from: '2026-07-01T12:00:00.000Z' } }, lookups);

      expect(resolved.createdRange).toEqual({ fromMs: Date.parse('2026-07-01T12:00:00.000Z'), toMs: undefined });
    });

    it('allows an open-ended range', () => {
      expect(resolveFilter({ createdBetween: { to: '2026-07-01' } }, lookups).createdRange?.fromMs).toBeUndefined();
    });

    it('resolves the updated range', () => {
      const resolved = resolveFilter({ updatedBetween: { from: '2026-08-01', to: '2026-08-07' } }, lookups);

      expect(resolved.updatedRange).toEqual({
        fromMs: Date.parse('2026-08-01T00:00:00.000Z'),
        toMs: Date.parse('2026-08-07T23:59:59.999Z'),
      });
    });

    describe('relative bounds', () => {
      it('reads "7d" as seven days ago, snapped to the start of that day', () => {
        // Snapped rather than exactly 168h ago, so a weekly run does not clip work depending
        // on the hour it happened to execute.
        const resolved = resolveFilter({ updatedBetween: { from: '7d' } }, lookups);
        const expected = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);

        expect(resolved.updatedRange?.fromMs).toBe(Date.parse(`${expected}T00:00:00.000Z`));
      });

      it('reads "2w" as fourteen days ago', () => {
        const resolved = resolveFilter({ updatedBetween: { from: '2w' } }, lookups);
        const expected = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);

        expect(resolved.updatedRange?.fromMs).toBe(Date.parse(`${expected}T00:00:00.000Z`));
      });

      it('is case-insensitive', () => {
        expect(resolveFilter({ updatedBetween: { from: '7D' } }, lookups).updatedRange?.fromMs).toBeDefined();
      });

      it('takes the end of the day for a `to` bound', () => {
        const resolved = resolveFilter({ updatedBetween: { to: '1d' } }, lookups);
        const expected = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

        expect(resolved.updatedRange?.toMs).toBe(Date.parse(`${expected}T23:59:59.999Z`));
      });

      it('does not mistake a plain date for a relative one', () => {
        const resolved = resolveFilter({ updatedBetween: { from: '2026-08-01' } }, lookups);

        expect(resolved.updatedRange?.fromMs).toBe(Date.parse('2026-08-01T00:00:00.000Z'));
      });
    });

    it('flags an unparseable date', () => {
      const resolved = resolveFilter({ createdBetween: { from: 'last tuesday' } }, lookups);

      expect(resolved.unmatched[0]?.value).toContain('not a valid date');
      expect(resolved.createdRange).toBeUndefined();
    });

    it('flags a backwards range rather than returning nothing', () => {
      const resolved = resolveFilter({ completedBetween: { from: '2026-08-01', to: '2026-07-01' } }, lookups);

      expect(resolved.unmatched[0]?.value).toContain('start is after end');
    });
  });

  it('lowercases the search term once, up front', () => {
    expect(resolveFilter({ search: '  LOGIN  ' }, lookups).search).toBe('login');
  });

  it('leaves every dimension unset for an empty filter', () => {
    const resolved = resolveFilter({}, lookups);

    expect(resolved.stateIds).toBeUndefined();
    expect(resolved.assigneeIds).toBeUndefined();
    expect(resolved.priorities).toBeUndefined();
    expect(resolved.search).toBeUndefined();
    expect(resolved.unmatched).toEqual([]);
  });

  describe('assertNoUnmatched', () => {
    it('passes a clean filter', () => {
      expect(() => assertNoUnmatched(resolveFilter({ states: ['Done'] }, lookups))).not.toThrow();
    });

    it('throws listing every problem and its suggestion', () => {
      const resolved = resolveFilter({ states: ['Progress'], labels: ['bugg'] }, lookups);

      expect(() => assertNoUnmatched(resolved)).toThrow(/states: "Progress".*did you mean In Progress/s);
      expect(() => assertNoUnmatched(resolved)).toThrow(/labels: "bugg"/);
    });
  });
});
