import { makeLookups, MEMBERS, MEMBERSHIP, WORK_ITEMS } from '../filter/filter.fixtures';
import type { PlaneProject, PlaneWorkItem } from '../plane';
import { buildRow, buildRows } from './export-row';

const project = { id: 'project-1', identifier: 'ENG', name: 'Engineering' } as PlaneProject;

const options = {
  project,
  lookups: makeLookups(),
  membership: MEMBERSHIP,
  workItemUrl: (projectId: string, workItemId: string) =>
    `https://plane.sagegreytech.com/sagegrey/projects/${projectId}/issues/${workItemId}`,
};

function rowFor(id: string) {
  const item = WORK_ITEMS.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`No fixture work item ${id}`);
  return buildRow(item, { ...options, lookups: makeLookups() });
}

describe('buildRow', () => {
  it('builds the human identifier from the project key and sequence', () => {
    // sequence_id alone is meaningless to a reader; Plane shows PROJ-123.
    expect(rowFor('item-1').identifier).toBe('ENG-1');
  });

  it('resolves state, assignees and labels to names', () => {
    const row = rowFor('item-1');

    expect(row.state).toBe('In Progress');
    expect(row.assignees).toBe('Ada Lovelace');
    expect(row.labels).toBe('bug, frontend');
  });

  it('joins multiple assignees into one readable cell', () => {
    expect(rowFor('item-2').assignees).toBe('Grace Hopper, Ada Lovelace');
  });

  it('carries the state colour through for the conditional fill', () => {
    expect(rowFor('item-1').stateColor).toBe('#888888');
    expect(rowFor('item-1').stateGroup).toBe('started');
  });

  it('strips markup out of the description', () => {
    expect(rowFor('item-1').description).toBe('Users report the login page hangs.');
  });

  it('leaves the description empty for Plane\'s empty-paragraph default', () => {
    expect(rowFor('item-3').description).toBe('');
  });

  it('resolves modules and cycles from the membership index', () => {
    const row = rowFor('item-1');

    expect(row.module).toBe('Billing, Auth');
    expect(row.cycle).toBe('Sprint 12');
  });

  it('leaves module and cycle blank when the index is absent', () => {
    const item = WORK_ITEMS[0] as PlaneWorkItem;
    const row = buildRow(item, { ...options, lookups: makeLookups(), membership: undefined });

    expect(row.module).toBe('');
    expect(row.cycle).toBe('');
  });

  it('produces real Dates so Excel can format them, not ISO strings', () => {
    const row = rowFor('item-4');

    expect(row.createdAt).toBeInstanceOf(Date);
    expect(row.completedAt?.toISOString()).toBe('2026-07-20T16:30:00.000Z');
  });

  it('uses null for a missing date so the cell is blank rather than "Invalid Date"', () => {
    expect(rowFor('item-1').completedAt).toBeNull();
    expect(rowFor('item-1').targetDate).toBeNull();
  });

  it('resolves the creator', () => {
    expect(rowFor('item-1').createdBy).toBe(MEMBERS.ada.id === 'user-ada' ? 'Ada Lovelace' : '');
  });

  it('builds an absolute link to the item in Plane', () => {
    expect(rowFor('item-1').link).toBe(
      'https://plane.sagegreytech.com/sagegrey/projects/project-1/issues/item-1',
    );
  });

  it('leaves an empty state as an empty cell', () => {
    const row = rowFor('item-6');

    expect(row.state).toBe('');
    expect(row.stateColor).toBeNull();
  });
});

describe('buildRows', () => {
  it('preserves input order', () => {
    const rows = buildRows(WORK_ITEMS, { ...options, lookups: makeLookups() });

    expect(rows.map((row) => row.identifier)).toEqual(['ENG-1', 'ENG-2', 'ENG-3', 'ENG-4', 'ENG-5', 'ENG-6']);
  });
});
