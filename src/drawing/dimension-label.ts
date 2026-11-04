import type { Bounds2, Dimension, Point2 } from '../model';

export interface DimensionLabelRun {
  text: string;
  x: number;
  y: number;
  fontSize: number;
  anchor: 'start' | 'middle';
  role: 'nominal' | 'upper' | 'lower' | 'suffix';
}
export interface DimensionLabel {
  plainText: string;
  runs: DimensionLabelRun[];
  bounds: Bounds2;
  width: number;
  height: number;
}
export const DIMENSION_LABEL_GAP = 1.2;
const NOMINAL_SIZE = 3.2;
const DEVIATION_SIZE = 2.2;
const glyphWidth = (character: string): number =>
  /[ilI.,:;!']/u.test(character)
    ? 0.34
    : /[MWmw@%ЖЩШЮФМжщшюфм]/u.test(character)
      ? 1.05
      : /\s/u.test(character)
        ? 0.36
        : /[0-9]/u.test(character)
          ? 0.76
          : /[A-Z]/u.test(character)
            ? 0.85
            : /[a-z]/u.test(character)
              ? 0.65
              : 0.95;
export const measureDimensionText = (text: string, fontSize: number): number =>
  Array.from(text).reduce((width, character) => width + glyphWidth(character) * fontSize, 0);

function nominal(dimension: Dimension, precision: number): string {
  const value = Number(dimension.value.toFixed(Math.max(0, Math.min(6, precision)))).toString();
  const symbol = dimension.kind === 'diameter' ? 'Ø' : dimension.kind === 'radius' ? 'R' : '';
  return `${dimension.prefix ?? ''}${symbol}${value}${dimension.kind === 'angle' ? '°' : ''}`;
}
function decimals(value: string): number {
  return value.includes('.') ? value.length - value.indexOf('.') - 1 : 0;
}
function deviation(value: string, places: number): string {
  const signed = Number(value) > 0 && !value.startsWith('+') ? `+${value}` : value;
  const withLeadingZero = signed.replace(/^([+-]?)\./, (_, sign: string) => `${sign}0.`);
  if (!places) return withLeadingZero;
  const [integer, fraction = ''] = withLeadingZero.split('.');
  return `${integer}.${fraction.padEnd(places, '0')}`;
}
function complete(plainText: string, runs: DimensionLabelRun[]): DimensionLabel {
  const bounds: Bounds2 = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const run of runs) {
    const width = measureDimensionText(run.text, run.fontSize);
    const left = run.anchor === 'middle' ? run.x - width / 2 : run.x;
    bounds.minX = Math.min(bounds.minX, left - 0.5);
    bounds.maxX = Math.max(bounds.maxX, left + width + 0.5);
    bounds.minY = Math.min(bounds.minY, run.y - run.fontSize - 0.3);
    bounds.maxY = Math.max(bounds.maxY, run.y + run.fontSize * 0.21875 + 0.3);
  }
  return {
    plainText,
    runs,
    bounds,
    width: bounds.maxX - bounds.minX,
    height: bounds.maxY - bounds.minY,
  };
}
function inline(text: string): DimensionLabel {
  return complete(text, [
    { text, x: 0, y: 0, fontSize: NOMINAL_SIZE, anchor: 'middle', role: 'nominal' },
  ]);
}

/** Coordinates use the complete label's horizontal center and nominal baseline as origin. */
export function formatDimensionLabel(dimension: Dimension, precision: number): DimensionLabel {
  const main = nominal(dimension, Math.max(precision, dimension.minimumPrecision ?? 0)),
    suffix = dimension.suffix ?? '';
  const tolerance = dimension.tolerance;
  const angularUnit = dimension.kind === 'angle' ? '°' : '';
  if (!tolerance) return inline(`${main}${suffix}`);
  if (tolerance.kind === 'symmetric')
    return inline(`${main} ±${tolerance.magnitude.replace(/^\./, '0.')}${angularUnit}${suffix}`);
  if (tolerance.kind === 'fit') return inline(`${main}${tolerance.designation}${suffix}`);

  const places = Math.max(decimals(tolerance.upper), decimals(tolerance.lower));
  if (Number(tolerance.upper) === 0 && Number(tolerance.lower) === 0)
    return inline(`${main} ±${places ? `0.${'0'.repeat(places)}` : '0'}${angularUnit}${suffix}`);
  const upper =
    Number(tolerance.upper) === 0 ? '' : `${deviation(tolerance.upper, places)}${angularUnit}`;
  const lower =
    Number(tolerance.lower) === 0 ? '' : `${deviation(tolerance.lower, places)}${angularUnit}`;
  const nominalWidth = measureDimensionText(main, NOMINAL_SIZE);
  const toleranceWidth = Math.max(
    measureDimensionText(upper, DEVIATION_SIZE),
    measureDimensionText(lower, DEVIATION_SIZE),
  );
  const suffixWidth = measureDimensionText(suffix, NOMINAL_SIZE);
  const totalWidth = nominalWidth + 0.8 + toleranceWidth + (suffix ? 0.8 + suffixWidth : 0);
  const left = -totalWidth / 2,
    toleranceX = left + nominalWidth + 0.8;
  const runs: DimensionLabelRun[] = [
    {
      text: main,
      x: left + nominalWidth / 2,
      y: 0,
      fontSize: NOMINAL_SIZE,
      anchor: 'middle',
      role: 'nominal',
    },
  ];
  if (upper)
    runs.push({
      text: upper,
      x: toleranceX,
      y: -1.8,
      fontSize: DEVIATION_SIZE,
      anchor: 'start',
      role: 'upper',
    });
  if (lower)
    runs.push({
      text: lower,
      x: toleranceX,
      y: 1.6,
      fontSize: DEVIATION_SIZE,
      anchor: 'start',
      role: 'lower',
    });
  if (suffix)
    runs.push({
      text: suffix,
      x: toleranceX + toleranceWidth + 0.8 + suffixWidth / 2,
      y: 0,
      fontSize: NOMINAL_SIZE,
      anchor: 'middle',
      role: 'suffix',
    });
  return complete(`${main} ${upper || '0'}/${lower || '0'}${suffix}`, runs);
}

export function dimensionLabelBoundsAt(label: DimensionLabel, origin: Point2, angle = 0): Bounds2 {
  const radians = (angle * Math.PI) / 180,
    cos = Math.cos(radians),
    sin = Math.sin(radians);
  const points = [
    [label.bounds.minX, label.bounds.minY],
    [label.bounds.maxX, label.bounds.minY],
    [label.bounds.maxX, label.bounds.maxY],
    [label.bounds.minX, label.bounds.maxY],
  ].map(([x, y]) => [origin[0] + x * cos - y * sin, origin[1] + x * sin + y * cos]);
  return {
    minX: Math.min(...points.map((point) => point[0])),
    minY: Math.min(...points.map((point) => point[1])),
    maxX: Math.max(...points.map((point) => point[0])),
    maxY: Math.max(...points.map((point) => point[1])),
  };
}

export function dimensionLeaderMetrics(
  dimension: Dimension,
  precision: number,
): { halfLength: number; baselineOffset: number } {
  const label = formatDimensionLabel(dimension, precision);
  return {
    halfLength: Math.max(6, label.width / 2 + 1),
    baselineOffset: -DIMENSION_LABEL_GAP - label.bounds.maxY,
  };
}
