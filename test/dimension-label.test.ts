import test from 'node:test';
import assert from 'node:assert/strict';
import type { Dimension, Point2 } from '../src/model';
import {
  DIMENSION_LABEL_GAP,
  dimensionLabelBoundsAt,
  dimensionLeaderMetrics,
  formatDimensionLabel,
  measureDimensionText,
} from '../src/drawing/dimension-label';
import { arrangeDimensions, formatDimension } from '../src/drawing/dimensions';
import { renderDimension } from '../src/drawing/render';

const size = (id = 'size', a: Point2 = [0, 0], b: Point2 = [20, 0]): Dimension => ({
  id,
  viewId: 'front',
  kind: 'horizontal',
  a,
  b,
  value: Math.hypot(b[0] - a[0], b[1] - a[1]),
  offset: 10,
  automatic: false,
});

test('symmetric tolerances retain entered zeros and do not alter measured nominal values', () => {
  const dimension: Dimension = {
    ...size(),
    kind: 'diameter',
    value: 20,
    tolerance: { kind: 'symmetric', magnitude: '0.050' },
    suffix: ' (2x)',
  };
  const label = formatDimensionLabel(dimension, 2);
  assert.equal(label.plainText, 'Ø20 ±0.050 (2x)');
  assert.equal(formatDimension(dimension, 2), label.plainText);
  assert.equal(label.runs.length, 1);
  assert.equal(label.runs[0].fontSize, 3.2);
  assert.equal(dimension.value, 20);
  assert.equal(dimension.tolerance?.kind === 'symmetric' && dimension.tolerance.magnitude, '0.050');
});

test('upper and lower deviations stack at a smaller size and equalize displayed decimal places', () => {
  const dimension: Dimension = {
    ...size(),
    tolerance: { kind: 'deviation', upper: '+0.2', lower: '-0.10' },
    suffix: ' H7 note',
  };
  const label = formatDimensionLabel(dimension, 2);
  const upper = label.runs.find((run) => run.role === 'upper')!,
    lower = label.runs.find((run) => run.role === 'lower')!,
    nominal = label.runs.find((run) => run.role === 'nominal')!;
  assert.equal(upper.text, '+0.20');
  assert.equal(lower.text, '-0.10');
  assert.equal(upper.x, lower.x);
  assert.ok(upper.y < lower.y);
  assert.ok(upper.fontSize < nominal.fontSize && lower.fontSize < nominal.fontSize);
  assert.equal(label.runs.find((run) => run.role === 'suffix')!.text, ' H7 note');
  assert.deepEqual(dimension.tolerance, { kind: 'deviation', upper: '+0.2', lower: '-0.10' });
});

test('zero deviations are omitted but a configured all-zero tolerance remains explicit', () => {
  const oneZero = formatDimensionLabel(
    { ...size(), tolerance: { kind: 'deviation', upper: '0.000', lower: '-.02' } },
    2,
  );
  assert.equal(
    oneZero.runs.some((run) => run.role === 'upper'),
    false,
  );
  assert.equal(oneZero.runs.find((run) => run.role === 'lower')!.text, '-0.020');
  const bothZero = formatDimensionLabel(
    { ...size(), tolerance: { kind: 'deviation', upper: '0.00', lower: '0' } },
    2,
  );
  assert.equal(bothZero.plainText, '20 ±0.00');
  assert.equal(bothZero.runs.length, 1);
  assert.ok(bothZero.width > 0 && bothZero.height > 0);
});

test('literal fits stay inline and angular numerical tolerances include degree symbols', () => {
  const fit = formatDimensionLabel(
    { ...size(), kind: 'diameter', tolerance: { kind: 'fit', designation: 'H7/g6' } },
    2,
  );
  assert.equal(fit.plainText, 'Ø20H7/g6');
  assert.equal(fit.runs.length, 1);
  const angle = formatDimensionLabel(
    {
      ...size(),
      kind: 'angle',
      value: 90,
      tolerance: { kind: 'deviation', upper: '+0.50', lower: '-0.2' },
    },
    2,
  );
  assert.equal(angle.runs.find((run) => run.role === 'nominal')!.text, '90°');
  assert.equal(angle.runs.find((run) => run.role === 'upper')!.text, '+0.50°');
  assert.equal(angle.runs.find((run) => run.role === 'lower')!.text, '-0.20°');
});

test('stacked SVG labels use PDF-safe text runs and their background clears the dimension line', () => {
  const dimension: Dimension = {
    ...size(),
    tolerance: { kind: 'deviation', upper: '+0.020', lower: '-0.010' },
  };
  const svg = renderDimension(dimension, { x: 0, y: 100, scale: 1 }, 2, false);
  assert.match(svg, /data-dimension-label-run="upper"[^>]*>\+0\.020<\/text>/);
  assert.match(svg, /data-dimension-label-run="lower"[^>]*>-0\.010<\/text>/);
  assert.match(svg, /font-size="2.2"/);
  assert.doesNotMatch(svg, /paint-order|stroke="white"|<foreignObject/);
  const background = svg.match(
    /class="dimension-label"[^>]*><rect x="[^"]+" y="([^"]+)" width="[^"]+" height="([^"]+)"/,
  )!;
  assert.ok(
    Math.abs(Number(background[1]) + Number(background[2]) - (110 - DIMENSION_LABEL_GAP)) < 1e-5,
  );
  const unsafe = renderDimension(
    { ...dimension, prefix: '<script>' },
    { x: 0, y: 100, scale: 1 },
    2,
    false,
  );
  assert.match(unsafe, /&lt;script&gt;/);
  assert.doesNotMatch(unsafe, /<script>/);
});

test('wide short-span tolerance labels cannot share an overlapping lane', () => {
  const first: Dimension = {
    ...size('first', [0, 0], [1, 0]),
    tolerance: { kind: 'deviation', upper: '+0.000000001', lower: '-0.000000001' },
  };
  const second = size('second', [20, 0], [21, 0]);
  const arranged = arrangeDimensions([first, second]);
  assert.notEqual(arranged[0].offset, arranged[1].offset);
  const tallest = Math.max(
    ...arranged.map((dimension) => formatDimensionLabel(dimension, 2).height),
  );
  assert.ok(Math.abs(arranged[0].offset - arranged[1].offset) >= tallest + 1.5 - 1e-9);
});

test('circle leaders expand with tolerance labels and packing uses the complete run bounds', () => {
  const circles: Dimension[] = [
    {
      ...size('first'),
      kind: 'diameter',
      a: [10, 10],
      b: [15, 10],
      value: 10,
      tolerance: { kind: 'deviation', upper: '+0.025', lower: '-0.010' },
    },
    {
      ...size('second'),
      kind: 'diameter',
      a: [11, 12],
      b: [17, 12],
      value: 12,
      tolerance: { kind: 'symmetric', magnitude: '0.030' },
    },
  ];
  const arranged = arrangeDimensions(circles, { scale: 0.2, precision: 2 });
  const boxes = arranged.map((dimension) => {
    const label = formatDimensionLabel(dimension, 2),
      metrics = dimensionLeaderMetrics(dimension, 2);
    assert.ok(metrics.halfLength * 2 >= label.width + 2 - 1e-9);
    const radius =
      Math.hypot(dimension.b[0] - dimension.a[0], dimension.b[1] - dimension.a[1]) * 0.2;
    const origin: Point2 = [
      dimension.a[0] * 0.2 +
        radius * 0.7071 +
        dimension.offset +
        metrics.halfLength +
        (dimension.textOffset?.[0] ?? 0),
      -dimension.a[1] * 0.2 -
        radius * 0.7071 -
        dimension.offset * 0.6 +
        metrics.baselineOffset +
        (dimension.textOffset?.[1] ?? 0),
    ];
    return dimensionLabelBoundsAt(label, origin);
  });
  assert.ok(
    boxes[0].maxY <= boxes[1].minY - 1.5 + 1e-9 || boxes[1].maxY <= boxes[0].minY - 1.5 + 1e-9,
  );
});

test('digit-one and wide-letter metrics conservatively cover the bundled PDF font', () => {
  assert.equal(measureDimensionText('111111', 3.2), measureDimensionText('888888', 3.2));
  assert.ok(
    measureDimensionText('111.111', 3.2) >= 11.84,
    'Noto Sans advances for this text occupy 11.84 mm',
  );
  assert.ok(measureDimensionText('mw', 3.2) >= (0.935 + 0.786) * 3.2);
  const label = formatDimensionLabel(
    {
      ...size(),
      value: 111.111,
      tolerance: { kind: 'deviation', upper: '+0.020', lower: '-0.010' },
    },
    3,
  );
  const nominal = label.runs.find((run) => run.role === 'nominal')!,
    upper = label.runs.find((run) => run.role === 'upper')!;
  assert.ok(
    upper.x > nominal.x + 11.84 / 2,
    'stacked tolerances start beyond the actual nominal ink',
  );
});
