import type { ExportRow } from './export-row';
import { groupRows, parseGroupBy } from './grouping';

function row(overrides: Partial<ExportRow> = {}): ExportRow {
  return {
    identifier: 'ENG-1',
    name: 'Something',
    description: '',
    state: 'Todo',
    stateColor: '#3f76d4',
    stateGroup: 'unstarted',
    stateSequence: 2,
    priority: 'none',
    assignees: '',
    labels: '',
    module: '',
    cycle: '',
    createdAt: null,
    updatedAt: null,
    startDate: null,
    completedAt: null,
    targetDate: null,
    estimate: '',
    createdBy: '',
    link: '',
    ...overrides,
  };
}

describe('parseGroupBy', () => {
  it('accepts the documented fields', () => {
    expect(parseGroupBy('state')).toBe('state');
    expect(parseGroupBy('priority')).toBe('priority');
    expect(parseGroupBy('cycle')).toBe('cycle');
  });

  it('accepts the singular "assignee", which is what people type', () => {
    expect(parseGroupBy('assignee')).toBe('assignees');
  });

  it('is case- and whitespace-insensitive', () => {
    expect(parseGroupBy('  State ')).toBe('state');
  });

  it('returns undefined when grouping was not requested', () => {
    expect(parseGroupBy(undefined)).toBeUndefined();
  });

  it('lists the valid fields when given a bad one', () => {
    expect(() => parseGroupBy('status')).toThrow(/Cannot group by "status".*state, priority/s);
  });
});

describe('groupRows', () => {
  describe('by state', () => {
    const rows = [
      row({ identifier: 'ENG-1', state: 'Done', stateSequence: 4 }),
      row({ identifier: 'ENG-2', state: 'Backlog', stateSequence: 1 }),
      row({ identifier: 'ENG-3', state: 'In Progress', stateSequence: 3 }),
      row({ identifier: 'ENG-4', state: 'Backlog', stateSequence: 1 }),
    ];

    it('creates one section per state', () => {
      const groups = groupRows(rows, 'state');

      expect(groups.map((group) => group.label)).toEqual(['Backlog', 'In Progress', 'Done']);
    });

    it('orders sections by the project workflow, not alphabetically', () => {
      // Alphabetical would put Done before In Progress, which reads as nonsense on a report.
      const labels = groupRows(rows, 'state').map((group) => group.label);

      expect(labels.indexOf('In Progress')).toBeLessThan(labels.indexOf('Done'));
    });

    it('keeps every row, with counts adding up to the input', () => {
      const groups = groupRows(rows, 'state');

      expect(groups.reduce((total, group) => total + group.rows.length, 0)).toBe(rows.length);
      expect(groups[0]?.rows).toHaveLength(2);
    });

    it('carries the state colour so the heading can use it', () => {
      expect(groupRows(rows, 'state')[0]?.color).toBe('#3f76d4');
    });

    it('labels stateless items and sorts them last', () => {
      const groups = groupRows([...rows, row({ identifier: 'ENG-5', state: '', stateSequence: null })], 'state');

      expect(groups[groups.length - 1]?.label).toBe('(no state)');
    });
  });

  describe('by priority', () => {
    it('orders by severity rather than alphabetically', () => {
      const rows = [
        row({ priority: 'low' }),
        row({ priority: 'urgent' }),
        row({ priority: 'medium' }),
        row({ priority: 'high' }),
      ];

      expect(groupRows(rows, 'priority').map((group) => group.label)).toEqual([
        'Urgent',
        'High',
        'Medium',
        'Low',
      ]);
    });
  });

  describe('by assignee', () => {
    it('groups on the displayed value, so counts still add up', () => {
      // An item with two assignees forms its own section rather than being duplicated into
      // both — otherwise the section counts would exceed the row count.
      const rows = [
        row({ identifier: 'ENG-1', assignees: 'Ada Lovelace' }),
        row({ identifier: 'ENG-2', assignees: 'Ada Lovelace, Grace Hopper' }),
        row({ identifier: 'ENG-3', assignees: '' }),
      ];

      const groups = groupRows(rows, 'assignees');

      expect(groups.map((group) => group.label)).toEqual([
        'Ada Lovelace',
        'Ada Lovelace, Grace Hopper',
        '(unassigned)',
      ]);
      expect(groups.reduce((total, group) => total + group.rows.length, 0)).toBe(3);
    });
  });

  describe('by module and cycle', () => {
    it('sorts alphabetically with the empty section last', () => {
      const rows = [
        row({ cycle: 'Sprint 12' }),
        row({ cycle: '' }),
        row({ cycle: 'Sprint 11' }),
      ];

      expect(groupRows(rows, 'cycle').map((group) => group.label)).toEqual([
        'Sprint 11',
        'Sprint 12',
        '(no cycle)',
      ]);
    });
  });

  it('returns nothing for no rows', () => {
    expect(groupRows([], 'state')).toEqual([]);
  });
});
