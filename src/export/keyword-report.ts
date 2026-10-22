import { searchableText } from '../filter';
import type { ProjectLookups } from '../lookup';
import type { PlaneWorkItem } from '../plane';

/**
 * Counts of work items matching a keyword, broken down by state.
 *
 * The motivating case is machine-opened tickets. An AI code reviewer files work items all
 * carrying a marker like "Detected by Felicia AI"; the team wants them out of the human
 * progress rows but still wants to know how many it raised and how far they have got —
 * how many reached staging, how many reached production.
 *
 * That combination is the whole point: the same keyword can exclude items from the sheet
 * (`excludeKeywords`) and still be counted here, because the report is built before the
 * exclusion is applied.
 */

export type KeywordReportScope = 'filtered' | 'all';

export interface KeywordStateCount {
  state: string;
  count: number;
  /** The state's position in the project workflow, used only for ordering. */
  sequence: number;
}

export interface KeywordReport {
  keyword: string;
  scope: KeywordReportScope;
  total: number;
  /** Ordered by workflow position, so Backlog → Done reads the way the board does. */
  byState: KeywordStateCount[];
}

const NO_STATE = '(no state)';

/**
 * Accumulates counts across projects.
 *
 * Built incrementally rather than from a collected list so a multi-project export does not
 * have to retain every project's raw work items until the end.
 */
export class KeywordReportBuilder {
  private readonly keywords: string[];
  private readonly totals = new Map<string, Map<string, KeywordStateCount>>();
  private readonly overall = new Map<string, number>();

  constructor(
    keywords: readonly string[],
    readonly scope: KeywordReportScope = 'filtered',
  ) {
    // Deduplicated and trimmed, but the original casing is kept for the heading: the report
    // is titled with what the user typed.
    this.keywords = [...new Set(keywords.map((keyword) => keyword.trim()).filter(Boolean))];

    for (const keyword of this.keywords) {
      this.totals.set(keyword, new Map());
      this.overall.set(keyword, 0);
    }
  }

  get isEmpty(): boolean {
    return this.keywords.length === 0;
  }

  /** Count one project's contribution. Safe to call once per project. */
  addProject(items: readonly PlaneWorkItem[], lookups: ProjectLookups): void {
    if (this.isEmpty) return;

    const needles = this.keywords.map((keyword) => [keyword, keyword.toLowerCase()] as const);

    for (const item of items) {
      // Stripped once per item, not once per keyword.
      const haystack = searchableText(item);

      for (const [keyword, needle] of needles) {
        if (!haystack.includes(needle)) continue;

        this.overall.set(keyword, (this.overall.get(keyword) ?? 0) + 1);

        const state = lookups.state(item.state);
        const label = state?.name || NO_STATE;

        const byState = this.totals.get(keyword) as Map<string, KeywordStateCount>;
        const existing = byState.get(label);

        if (existing) {
          existing.count += 1;
          // Several projects can share a state name with different sequences; the earliest
          // keeps the ordering sane rather than letting the last project win.
          existing.sequence = Math.min(existing.sequence, state?.sequence ?? Number.MAX_SAFE_INTEGER);
        } else {
          byState.set(label, {
            state: label,
            count: 1,
            sequence: state?.sequence ?? Number.MAX_SAFE_INTEGER,
          });
        }
      }
    }
  }

  build(): KeywordReport[] {
    return this.keywords.map((keyword) => ({
      keyword,
      scope: this.scope,
      total: this.overall.get(keyword) ?? 0,
      byState: [...(this.totals.get(keyword)?.values() ?? [])].sort(
        (a, b) => a.sequence - b.sequence || a.state.localeCompare(b.state),
      ),
    }));
  }
}
