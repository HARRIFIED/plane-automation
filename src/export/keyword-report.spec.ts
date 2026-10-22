import { makeLookups, STATES, WORK_ITEMS } from '../filter/filter.fixtures';
import type { PlaneWorkItem } from '../plane';
import { KeywordReportBuilder } from './keyword-report';

function aiItem(id: string, state: string | null, where: 'name' | 'description'): PlaneWorkItem {
  const base = WORK_ITEMS[0] as PlaneWorkItem;

  return {
    ...base,
    id,
    state,
    name: where === 'name' ? 'Null check missing — Detected by Felicia AI' : 'Ordinary ticket',
    description_html:
      where === 'description' ? '<p>Raised automatically. <em>Detected by Felicia AI</em></p>' : '<p></p>',
  };
}

describe('KeywordReportBuilder', () => {
  it('reports nothing when no keywords were asked for', () => {
    const builder = new KeywordReportBuilder([]);

    expect(builder.isEmpty).toBe(true);
    expect(builder.build()).toEqual([]);
  });

  it('counts matches and breaks them down by state', () => {
    const builder = new KeywordReportBuilder(['Detected by Felicia AI']);

    builder.addProject(
      [
        aiItem('a', STATES.doing.id, 'name'),
        aiItem('b', STATES.doing.id, 'description'),
        aiItem('c', STATES.done.id, 'name'),
        WORK_ITEMS[1] as PlaneWorkItem, // an ordinary ticket, must not be counted
      ],
      makeLookups(),
    );

    const [report] = builder.build();

    expect(report?.total).toBe(3);
    // Workflow order, not alphabetical — "Done" would otherwise sort above "In Progress".
    expect(report?.byState).toEqual([
      { state: 'In Progress', count: 2, sequence: 3 },
      { state: 'Done', count: 1, sequence: 5 },
    ]);
  });

  it('matches the description as well as the name, ignoring markup', () => {
    const builder = new KeywordReportBuilder(['Detected by Felicia AI']);

    builder.addProject([aiItem('a', STATES.todo.id, 'description')], makeLookups());

    expect(builder.build()[0]?.total).toBe(1);
  });

  it('is case-insensitive, so the marker does not have to be typed exactly', () => {
    const builder = new KeywordReportBuilder(['detected BY felicia ai']);

    builder.addProject([aiItem('a', STATES.todo.id, 'name')], makeLookups());

    expect(builder.build()[0]?.total).toBe(1);
  });

  it('keeps the keyword as typed, for the heading', () => {
    const builder = new KeywordReportBuilder(['  Detected by Felicia AI  ']);

    expect(builder.build()[0]?.keyword).toBe('Detected by Felicia AI');
  });

  it('counts each item once even when it matches in both name and description', () => {
    const builder = new KeywordReportBuilder(['Felicia']);
    const both = { ...aiItem('a', STATES.todo.id, 'name'), description_html: '<p>Felicia again</p>' };

    builder.addProject([both], makeLookups());

    expect(builder.build()[0]?.total).toBe(1);
  });

  it('tracks several keywords independently', () => {
    const builder = new KeywordReportBuilder(['Felicia', 'Ordinary']);

    builder.addProject([aiItem('a', STATES.todo.id, 'name'), aiItem('b', STATES.todo.id, 'description')], makeLookups());

    const [felicia, ordinary] = builder.build();
    expect(felicia?.total).toBe(2);
    // "Ordinary ticket" is the name given to the description-marked item.
    expect(ordinary?.total).toBe(1);
  });

  it('deduplicates repeated keywords', () => {
    const builder = new KeywordReportBuilder(['Felicia', 'Felicia']);

    expect(builder.build()).toHaveLength(1);
  });

  it('labels items with no state rather than dropping them', () => {
    const builder = new KeywordReportBuilder(['Felicia']);

    builder.addProject([aiItem('a', null, 'name')], makeLookups());

    expect(builder.build()[0]?.byState).toEqual([
      { state: '(no state)', count: 1, sequence: Number.MAX_SAFE_INTEGER },
    ]);
  });

  it('sums across projects', () => {
    const builder = new KeywordReportBuilder(['Felicia']);

    builder.addProject([aiItem('a', STATES.doing.id, 'name')], makeLookups());
    builder.addProject([aiItem('b', STATES.doing.id, 'name')], makeLookups());

    const [report] = builder.build();
    expect(report?.total).toBe(2);
    expect(report?.byState).toEqual([{ state: 'In Progress', count: 2, sequence: 3 }]);
  });

  it('reports zero rather than vanishing when nothing matches', () => {
    // A section that disappears looks like a broken feature; "none this week" is an answer.
    const builder = new KeywordReportBuilder(['Detected by Felicia AI']);

    builder.addProject([WORK_ITEMS[1] as PlaneWorkItem], makeLookups());

    expect(builder.build()[0]).toMatchObject({ total: 0, byState: [] });
  });

  it('records the scope it was built with', () => {
    expect(new KeywordReportBuilder(['x'], 'all').build()[0]?.scope).toBe('all');
    expect(new KeywordReportBuilder(['x']).build()[0]?.scope).toBe('filtered');
  });
});
