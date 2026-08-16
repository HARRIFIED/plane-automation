/**
 * Workbook colours.
 *
 * Every colour is stored as Excel's 8-digit ARGB. Users supply ordinary 6-digit hex, with or
 * without the leading `#`, because that is what a colour picker gives you.
 */

export interface ExportTheme {
  /** Header row background. */
  headerFill: string;
  /** Header row text. */
  headerText: string;
  /** Group heading background, when grouping is on. Defaults to a tint of the header fill. */
  groupFill: string;
  groupText: string;
  /**
   * True when the caller named a group colour.
   *
   * Grouping by state normally tints each heading with Plane's own colour for that state, so
   * sections are recognisable from the board. An explicit choice has to override that —
   * otherwise `--group-color` appears to do nothing on the one grouping people use most.
   */
  groupFillExplicit: boolean;
  /** Alternating row background. Undefined means no banding. */
  bandFill?: string;
}

export interface ThemeOptions {
  headerColor?: string;
  headerTextColor?: string;
  groupColor?: string;
  bandColor?: string;
}

export const DEFAULT_HEADER_FILL = 'FF1F3A5F';
export const DEFAULT_HEADER_TEXT = 'FFFFFFFF';

/**
 * Build a theme from whatever the caller supplied.
 *
 * Only `headerColor` needs choosing: the group heading defaults to a light tint of it, so a
 * single flag produces a coherent sheet rather than forcing three colour decisions.
 */
export function resolveTheme(options: ThemeOptions = {}): ExportTheme {
  const headerFill = options.headerColor ? toArgb(options.headerColor, 'headerColor') : DEFAULT_HEADER_FILL;

  const headerText = options.headerTextColor
    ? toArgb(options.headerTextColor, 'headerTextColor')
    : // Pick black or white for contrast rather than letting a pale custom header render
      // white-on-white and look like an empty row.
      readableTextOn(headerFill);

  const groupFill = options.groupColor ? toArgb(options.groupColor, 'groupColor') : tint(headerFill, 0.78);

  return {
    headerFill,
    headerText,
    groupFill,
    groupText: readableTextOn(groupFill),
    groupFillExplicit: options.groupColor !== undefined,
    bandFill: options.bandColor ? toArgb(options.bandColor, 'bandColor') : undefined,
  };
}

/** Accepts `#rrggbb`, `rrggbb`, or an 8-digit `aarrggbb`. Throws with the option name on error. */
export function toArgb(value: string, optionName: string): string {
  const cleaned = value.trim().replace(/^#/, '').toUpperCase();

  if (/^[0-9A-F]{8}$/.test(cleaned)) return cleaned;
  if (/^[0-9A-F]{6}$/.test(cleaned)) return `FF${cleaned}`;

  throw new Error(
    `${optionName}: "${value}" is not a valid colour. Use 6-digit hex such as #1F3A5F or 1F3A5F.`,
  );
}

const DARK_TEXT = 'FF1F2937';
const LIGHT_TEXT = 'FFFFFFFF';

/**
 * Near-black or white, whichever is actually legible on the given background.
 *
 * Uses the WCAG contrast ratio rather than a brightness threshold. A simple threshold gets
 * saturated colours wrong: pure green is only ~59% "bright" by the usual weighting, but white
 * text on it has a contrast ratio of 1.4:1 — illegible — while black reaches 10:1.
 */
export function readableTextOn(argb: string): string {
  const background = relativeLuminance(argb);

  const withLight = contrastRatio(background, relativeLuminance(LIGHT_TEXT));
  const withDark = contrastRatio(background, relativeLuminance(DARK_TEXT));

  return withDark > withLight ? DARK_TEXT : LIGHT_TEXT;
}

function contrastRatio(a: number, b: number): number {
  const [lighter, darker] = a > b ? [a, b] : [b, a];
  return (lighter + 0.05) / (darker + 0.05);
}

/** WCAG relative luminance: sRGB channels linearised, then weighted for human perception. */
function relativeLuminance(argb: string): number {
  const [red, green, blue] = channels(argb).map((channel) => {
    const normalised = channel / 255;
    return normalised <= 0.03928 ? normalised / 12.92 : ((normalised + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** Mix a colour towards white. `amount` 0 = unchanged, 1 = white. */
export function tint(argb: string, amount: number): string {
  const lightened = channels(argb).map((channel) => Math.round(channel + (255 - channel) * amount));

  return `FF${lightened.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

function channels(argb: string): [number, number, number] {
  const rgb = argb.slice(-6);

  return [
    parseInt(rgb.slice(0, 2), 16) || 0,
    parseInt(rgb.slice(2, 4), 16) || 0,
    parseInt(rgb.slice(4, 6), 16) || 0,
  ];
}
