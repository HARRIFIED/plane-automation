import { htmlToText } from './html-to-text';

describe('htmlToText', () => {
  it('returns an empty string for missing content', () => {
    expect(htmlToText(null)).toBe('');
    expect(htmlToText(undefined)).toBe('');
    expect(htmlToText('')).toBe('');
  });

  it('treats Plane\'s empty description as empty', () => {
    // Plane defaults description_html to "<p></p>", not to an empty string.
    expect(htmlToText('<p></p>')).toBe('');
  });

  it('strips inline markup but keeps the words', () => {
    expect(htmlToText('<p>Fix the <strong>login</strong> <em>bug</em></p>')).toBe('Fix the login bug');
  });

  it('keeps paragraphs on separate lines instead of running them together', () => {
    expect(htmlToText('<p>First para</p><p>Second para</p>')).toBe('First para\nSecond para');
  });

  it('turns <br> into a line break', () => {
    expect(htmlToText('Line one<br>Line two')).toBe('Line one\nLine two');
  });

  it('marks list items', () => {
    expect(htmlToText('<ul><li>One</li><li>Two</li></ul>')).toBe('• One\n• Two');
  });

  it('decodes named entities', () => {
    expect(htmlToText('<p>Tom &amp; Jerry &lt;3 &quot;quotes&quot;</p>')).toBe('Tom & Jerry <3 "quotes"');
  });

  it('decodes numeric and hex entities', () => {
    expect(htmlToText('<p>&#65;&#66;&#x43;</p>')).toBe('ABC');
  });

  it('turns non-breaking spaces into ordinary ones', () => {
    expect(htmlToText('<p>a&nbsp;b</p>')).toBe('a b');
  });

  it('leaves an unrecognised entity visible rather than mangling it', () => {
    expect(htmlToText('<p>&notarealentity;</p>')).toBe('&notarealentity;');
  });

  it('drops script and style content entirely', () => {
    expect(htmlToText('<p>Before</p><script>alert(1)</script><style>p{color:red}</style><p>After</p>')).toBe(
      'Before\nAfter',
    );
  });

  it('collapses the empty paragraphs Plane\'s editor leaves behind', () => {
    expect(htmlToText('<p>One</p><p></p><p></p><p></p><p>Two</p>')).toBe('One\n\nTwo');
  });

  it('collapses runs of whitespace within a line', () => {
    expect(htmlToText('<p>too    many\t\tspaces</p>')).toBe('too many spaces');
  });

  it('flattens to one line when asked, for search matching', () => {
    expect(htmlToText('<p>First</p><p>Second</p>', { singleLine: true })).toBe('First Second');
  });

  it('handles a realistic Plane description', () => {
    const html =
      '<p>Users report the <strong>login</strong> page hangs.</p><p></p>' +
      '<ul><li>Repro on Chrome &amp; Safari</li><li>Only with SSO</li></ul>' +
      '<p>See <a href="https://example.com">ticket</a>.</p>';

    expect(htmlToText(html)).toBe(
      'Users report the login page hangs.\n\n• Repro on Chrome & Safari\n• Only with SSO\nSee ticket.',
    );
  });
});
