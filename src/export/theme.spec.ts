import { DEFAULT_HEADER_FILL, readableTextOn, resolveTheme, toArgb } from './theme';

describe('toArgb', () => {
  it('accepts hex with or without the hash', () => {
    expect(toArgb('#1F3A5F', 'headerColor')).toBe('FF1F3A5F');
    expect(toArgb('1f3a5f', 'headerColor')).toBe('FF1F3A5F');
  });

  it('passes an 8-digit ARGB through', () => {
    expect(toArgb('FF1F3A5F', 'headerColor')).toBe('FF1F3A5F');
  });

  it('tolerates surrounding whitespace', () => {
    expect(toArgb('  #1f3a5f  ', 'headerColor')).toBe('FF1F3A5F');
  });

  it('names the option it rejected, so the message is actionable', () => {
    expect(() => toArgb('teal', 'headerColor')).toThrow(/headerColor: "teal" is not a valid colour/);
    expect(() => toArgb('#fff', 'bandColor')).toThrow(/bandColor/);
  });
});

describe('readableTextOn', () => {
  it('picks white on a dark background and near-black on a light one', () => {
    expect(readableTextOn('FF1F3A5F')).toBe('FFFFFFFF');
    expect(readableTextOn('FFF1F5F9')).toBe('FF1F2937');
  });

  it('weights by perceived brightness, not a plain average', () => {
    // Pure green and pure blue share an average but not a perceived brightness; treating them
    // the same would put white text on bright green.
    expect(readableTextOn('FF00FF00')).toBe('FF1F2937');
    expect(readableTextOn('FF0000FF')).toBe('FFFFFFFF');
  });
});

describe('resolveTheme', () => {
  it('defaults to the house palette when nothing is supplied', () => {
    const theme = resolveTheme();

    expect(theme.headerFill).toBe(DEFAULT_HEADER_FILL);
    expect(theme.headerText).toBe('FFFFFFFF');
    expect(theme.bandFill).toBeUndefined();
  });

  it('derives a group colour from the header, so one flag is enough', () => {
    const theme = resolveTheme({ headerColor: '#0F766E' });

    expect(theme.headerFill).toBe('FF0F766E');
    // A light tint of the header rather than an unrelated colour.
    expect(theme.groupFill).not.toBe(theme.headerFill);
    expect(theme.groupText).toBe('FF1F2937');
  });

  it('chooses header text for contrast when the user picks a pale header', () => {
    // Without this a pale custom header renders white-on-white and looks like an empty row.
    expect(resolveTheme({ headerColor: '#FFF7ED' }).headerText).toBe('FF1F2937');
  });

  it('still honours an explicit text colour', () => {
    expect(resolveTheme({ headerColor: '#FFF7ED', headerTextColor: '#FF0000' }).headerText).toBe('FFFF0000');
  });

  it('takes an explicit group and band colour', () => {
    const theme = resolveTheme({ groupColor: '#E2E8F0', bandColor: '#F8FAFC' });

    expect(theme.groupFill).toBe('FFE2E8F0');
    expect(theme.bandFill).toBe('FFF8FAFC');
  });

  it('rejects an invalid colour rather than silently ignoring it', () => {
    expect(() => resolveTheme({ headerColor: 'not-a-colour' })).toThrow(/headerColor/);
  });
});
