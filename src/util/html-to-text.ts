/**
 * Convert Plane's `description_html` to plain text.
 *
 * We have to do this ourselves: the API exposes `description_html` but its serializer
 * explicitly excludes `description_stripped`, even though the column exists in Plane's
 * database. See docs/plane-api-findings.md §2.1.
 *
 * Deliberately hand-rolled rather than pulling in a parser. The input is Plane's own editor
 * output — a small, predictable subset of HTML — and the output goes into a spreadsheet cell,
 * so the bar is "readable text", not "faithful rendering". If we ever need tables or nested
 * lists rendered properly, that is the point to reach for a real library.
 */

/** Tags whose content should vanish entirely rather than be flattened into text. */
const DROPPED_CONTENT = /<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi;

/** Block-level tags that should become a line break rather than run words together. */
const BLOCK_BOUNDARY = /<\/?(p|div|br|li|tr|h[1-6]|blockquote|pre)\b[^>]*>/gi;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
};

export interface HtmlToTextOptions {
  /** Collapse everything onto one line. Used for free-text search matching. */
  singleLine?: boolean;
}

export function htmlToText(html: string | null | undefined, options: HtmlToTextOptions = {}): string {
  if (!html) return '';

  let text = html;

  text = text.replace(DROPPED_CONTENT, ' ');
  // List items read better with a marker than as a run-on sentence.
  text = text.replace(/<li\b[^>]*>/gi, '\n• ');
  text = text.replace(BLOCK_BOUNDARY, '\n');
  // Anything left is inline markup (strong, em, a, span, code); drop the tags, keep the text.
  text = text.replace(/<[^>]+>/g, '');

  text = decodeEntities(text);

  // Normalise line endings before collapsing, so \r\n does not survive as a stray blank line.
  text = text.replace(/\r\n?/g, '\n');
  // Spaces and tabs within a line collapse; newlines are handled separately so paragraph
  // structure survives into the cell.
  text = text.replace(/[^\S\n]+/g, ' ');
  text = text.replace(/ *\n */g, '\n');
  // Every block tag contributes a newline, so an ordinary paragraph boundary (`</p><p>`)
  // arrives as two and an empty paragraph between them as four. Collapse a pair to a single
  // break, and anything longer to one blank line — which preserves the deliberate spacing in
  // "<p>a</p><p></p><p>b</p>" without double-spacing every consecutive paragraph.
  text = text.replace(/\n{2,}/g, (run) => (run.length === 2 ? '\n' : '\n\n'));

  text = text.trim();

  return options.singleLine ? text.replace(/\s+/g, ' ') : text;
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith('#')) {
      const codePoint = entity[1]?.toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));

      // Reject anything that is not a usable code point rather than emitting a replacement
      // character; leaving the original entity visible is a clearer signal that we missed one.
      if (!Number.isFinite(codePoint) || codePoint < 1 || codePoint > 0x10ffff) return match;

      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return match;
      }
    }

    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}
