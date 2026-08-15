import { describeFilter } from './filter-description';

describe('describeFilter', () => {
  it('describes nothing for an absent or empty filter', () => {
    expect(describeFilter(undefined)).toEqual([]);
    expect(describeFilter({})).toEqual([]);
  });

  it('spells out that multiple values are an OR', () => {
    // So a reader cannot mistake the semantics from the summary sheet alone.
    expect(describeFilter({ states: ['Todo', 'In Progress'] })).toEqual(['State: Todo or In Progress']);
  });

  it('keeps a single value plain', () => {
    expect(describeFilter({ priorities: ['urgent'] })).toEqual(['Priority: urgent']);
  });

  it('describes a closed date range as inclusive', () => {
    expect(describeFilter({ createdBetween: { from: '2026-07-01', to: '2026-07-31' } })).toEqual([
      'Created between 2026-07-01 and 2026-07-31 (inclusive)',
    ]);
  });

  it('describes open-ended ranges from the right end', () => {
    expect(describeFilter({ createdBetween: { from: '2026-07-01' } })).toEqual(['Created on or after 2026-07-01']);
    expect(describeFilter({ completedBetween: { to: '2026-07-31' } })).toEqual([
      'Completed on or before 2026-07-31',
    ]);
  });

  it('describes a relative bound in words, not as "7d"', () => {
    // The summary sheet is read by people; "on or after 7d" tells them nothing.
    expect(describeFilter({ updatedBetween: { from: '7d' } })).toEqual(['Updated in the last 7 days']);
    expect(describeFilter({ updatedBetween: { from: '1d' } })).toEqual(['Updated in the last 1 day']);
    expect(describeFilter({ updatedBetween: { from: '2w' } })).toEqual(['Updated in the last 2 weeks']);
  });

  it('keeps the relative form visible alongside its meaning in a closed range', () => {
    expect(describeFilter({ updatedBetween: { from: '14d', to: '7d' } })).toEqual([
      'Updated between 14d (last 14 days) and 7d (last 7 days) (inclusive)',
    ]);
  });

  it('describes the updated range', () => {
    expect(describeFilter({ updatedBetween: { from: '2026-08-01', to: '2026-08-07' } })).toEqual([
      'Updated between 2026-08-01 and 2026-08-07 (inclusive)',
    ]);
  });

  it('quotes a search term', () => {
    expect(describeFilter({ search: 'login' })).toEqual(['Text match: "login"']);
  });

  it('ignores a whitespace-only search', () => {
    expect(describeFilter({ search: '   ' })).toEqual([]);
  });

  it('describes a combined filter one line per dimension', () => {
    const lines = describeFilter({
      stateGroups: ['started'],
      assignees: ['unassigned', 'ada'],
      labels: ['bug'],
    });

    expect(lines).toEqual(['State group: started', 'Assignee: unassigned or ada', 'Label: bug']);
  });
});
