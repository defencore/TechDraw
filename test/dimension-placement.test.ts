import assert from 'node:assert/strict';
import test from 'node:test';
import type { Bounds2, Dimension, DrawingLayout, Part, Point2, Projection } from '../src/model';
import { applyDimensionPlacement, type PlacementSide } from '../src/drawing/dimension-placement';
import { dimensionGeometry } from '../src/drawing/dimension-geometry';

const view = (id: Projection['id']): Projection => ({
  id,
  name: id,
  bounds: { minX: 0, minY: 0, maxX: 100, maxY: 60 },
  edges: [],
});
const part: Part = {
  id: 'part',
  name: 'Part',
  sourceName: 'part.step',
  path: ['Part'],
  unit: 'mm',
  warnings: [],
  bounds: { min: [0, 0, 0], max: [100, 60, 60] },
  views: [view('front'), view('top'), view('right'), view('iso')],
};
function layout(scale = 0.5): DrawingLayout {
  return {
    scale,
    viewTransforms: {
      front: { x: 31.3, y: 150.7, scale },
      top: { x: 1000, y: 1000, scale },
      right: { x: 2000, y: 2000, scale },
      iso: { x: 3000, y: 3000, scale },
    },
  };
}
function linear(id: string, a = 0, b = 20): Dimension {
  return {
    id,
    viewId: 'front',
    kind: 'horizontal',
    a: [a, 10],
    b: [b, 10],
    value: b - a,
    offset: 17,
    automatic: false,
  };
}
const gridMultiple = (value: number, spacing: number) =>
  Math.abs(value / spacing - Math.round(value / spacing)) < 1e-8;
const disjoint = (a: Bounds2, b: Bounds2, gap = 0) =>
  a.maxX + gap <= b.minX ||
  b.maxX + gap <= a.minX ||
  a.maxY + gap <= b.minY ||
  b.maxY + gap <= a.minY;
const geometry = (dimension: Dimension, drawing: DrawingLayout) =>
  dimensionGeometry(dimension, drawing.viewTransforms[dimension.viewId], 2);
const dimensionLine = (dimension: Dimension, drawing: DrawingLayout) =>
  geometry(dimension, drawing).lines.find((line) => line.kind === 'dimension')!;

test('cascade places shorter nested horizontal spans nearest the contour and snaps absolute sheet lines outwards', () => {
  const dimensions = [linear('overall', 0, 100), linear('short', 0, 12), linear('middle', 0, 24)];
  const before = structuredClone(dimensions),
    drawing = layout();
  for (const side of ['top', 'bottom'] as const) {
    const result = applyDimensionPlacement(
      dimensions,
      new Set(dimensions.map((d) => d.id)),
      part,
      drawing,
      { side, mode: 'cascade', gap: 10, gridSpacing: 10, precision: 2 },
    );
    const y = (id: string) =>
      dimensionLine(
        result.dimensions.find((d) => d.id === id)!,
        drawing,
      ).a[1];
    if (side === 'top') assert.ok(y('short') > y('middle') && y('middle') > y('overall'));
    else assert.ok(y('short') < y('middle') && y('middle') < y('overall'));
    for (const dimension of result.dimensions) {
      const line = dimensionLine(dimension, drawing),
        box = geometry(dimension, drawing).labelBounds;
      assert.ok(gridMultiple(line.a[1], 10));
      assert.ok(
        side === 'top'
          ? line.a[1] <= 110.7 && box.maxY < 120.7
          : line.a[1] >= 160.7 && box.minY > 150.7,
      );
    }
    assert.equal(result.placedIds.length, 3);
    assert.deepEqual(result.unsupportedIds, []);
  }
  assert.deepEqual(dimensions, before);
});

test('align shares a baseline for disjoint spans while keeping nested spans on clear separate lanes', () => {
  const dimensions = [linear('nested', 0, 100), linear('right', 70, 90), linear('left', 0, 20)];
  const drawing = layout(1);
  const result = applyDimensionPlacement(
    dimensions,
    new Set(dimensions.map((d) => d.id)),
    part,
    drawing,
    { side: 'bottom', mode: 'align', gap: 7, gridSpacing: 1, precision: 2 },
  );
  const placed = (id: string) => result.dimensions.find((d) => d.id === id)!;
  assert.equal(
    dimensionLine(placed('left'), drawing).a[1],
    dimensionLine(placed('right'), drawing).a[1],
  );
  assert.ok(
    dimensionLine(placed('nested'), drawing).a[1] > dimensionLine(placed('left'), drawing).a[1],
  );
  const boxes = result.dimensions.map((d) => geometry(d, drawing).labelBounds);
  for (let index = 0; index < boxes.length; index++)
    for (const other of boxes.slice(0, index)) assert.ok(disjoint(boxes[index], other, 1.49));
});

test('vertical right and left commands snap actual sheet X at different drawing scales and datums', () => {
  for (const scale of [0.5, 2])
    for (const side of ['left', 'right'] as const) {
      const drawing = layout(scale);
      const dimensions: Dimension[] = [
        { ...linear('short'), kind: 'vertical', a: [10, 0], b: [10, 12], value: 12 },
        { ...linear('long'), kind: 'vertical', a: [70, 0], b: [70, 50], value: 50 },
      ];
      const result = applyDimensionPlacement(
        dimensions,
        new Set(['short', 'long']),
        part,
        drawing,
        { side, mode: 'cascade', gap: 10, gridSpacing: 10, precision: 2 },
      );
      const x = result.dimensions.map((d) => dimensionLine(d, drawing).a[0]);
      assert.ok(x.every((value) => gridMultiple(value, 10)));
      assert.ok(side === 'left' ? x[1] < x[0] : x[1] > x[0]);
      for (const dimension of result.dimensions) {
        const box = geometry(dimension, drawing).labelBounds;
        assert.ok(side === 'left' ? box.maxX < 31.3 : box.minX > 31.3 + 100 * scale);
      }
    }
});

test('radial labels support all four sides and snap their actual sheet origins without changing exact geometry or specifications', () => {
  const radial: Dimension = {
    id: 'radius',
    viewId: 'front',
    kind: 'radius',
    a: [40, 30],
    b: [43.456, 30],
    value: 3.456,
    offset: -19,
    textOffset: [3, -2],
    automatic: false,
    prefix: 'REF ',
    suffix: ' finish',
    tolerance: { kind: 'deviation', upper: '0.050', lower: '-0.010' },
  };
  const before = structuredClone(radial);
  for (const side of ['left', 'right', 'top', 'bottom'] as PlacementSide[])
    for (const spacing of [1, 10]) {
      const drawing = layout(2);
      const result = applyDimensionPlacement([radial], new Set(['radius']), part, drawing, {
        side,
        mode: 'align',
        gap: 10,
        gridSpacing: spacing,
        precision: 2,
      });
      const placed = result.dimensions[0],
        g = geometry(placed, drawing),
        box = g.labelBounds;
      assert.ok(g.label.origin.every((coordinate) => gridMultiple(coordinate, spacing)));
      assert.ok(
        side === 'left'
          ? box.maxX < 31.3
          : side === 'right'
            ? box.minX > 231.3
            : side === 'top'
              ? box.maxY < 30.7
              : box.minY > 150.7,
      );
      assert.deepEqual(placed.a, radial.a);
      assert.deepEqual(placed.b, radial.b);
      assert.equal(placed.value, radial.value);
      assert.deepEqual(placed.tolerance, radial.tolerance);
      assert.equal(placed.prefix, radial.prefix);
      assert.equal(placed.suffix, radial.suffix);
    }
  assert.deepEqual(radial, before);
});

test('parallel aligned dimensions use ordered exterior normal baselines while perpendicular side requests and angles are reported', () => {
  const short: Dimension = {
    ...linear('short'),
    kind: 'aligned',
    a: [0, 0],
    b: [20, 20],
    value: Math.sqrt(800),
  };
  const long: Dimension = { ...short, id: 'long', b: [40, 40], value: Math.sqrt(3200) };
  const perpendicular: Dimension = { ...short, id: 'vertical-aligned', b: [0, 20], value: 20 };
  const angle: Dimension = {
    ...linear('angle'),
    kind: 'angle',
    a: [20, 0],
    b: [0, 20],
    vertex: [0, 0],
    value: 90,
  };
  const drawing = layout();
  const result = applyDimensionPlacement(
    [long, angle, perpendicular, short],
    new Set(['long', 'angle', 'vertical-aligned', 'short', 'unknown']),
    part,
    drawing,
    { side: 'top', mode: 'cascade', gap: 10, gridSpacing: 1, precision: 2 },
  );
  assert.deepEqual(result.placedIds, ['long', 'short']);
  assert.deepEqual(
    new Set(result.unsupportedIds),
    new Set(['angle', 'vertical-aligned', 'unknown']),
  );
  const normal: Point2 = [-Math.SQRT1_2, -Math.SQRT1_2];
  const distance = (id: string) => {
    const line = dimensionLine(
      result.dimensions.find((d) => d.id === id)!,
      drawing,
    );
    const at = (point: Point2) => point[0] * normal[0] + point[1] * normal[1];
    assert.ok(Math.abs(at(line.a) - at(line.b)) < 1e-8);
    assert.ok(gridMultiple(at(line.a), 1));
    return at(line.a);
  };
  assert.ok(distance('long') > distance('short'));
  assert.deepEqual(
    result.dimensions.find((d) => d.id === 'angle'),
    angle,
  );
  assert.deepEqual(
    result.dimensions.find((d) => d.id === 'vertical-aligned'),
    perpendicular,
  );
});

test('full tolerance bounds enlarge cascade spacing and unselected annotations remain unchanged', () => {
  const dimensions = [
    {
      ...linear('first'),
      tolerance: { kind: 'deviation' as const, upper: '0.000000001', lower: '-0.000000001' },
    },
    { ...linear('second', 0, 30), tolerance: { kind: 'symmetric' as const, magnitude: '0.050' } },
    { ...linear('unselected', 50, 70), textOffset: [17, -12] as Point2 },
  ];
  const drawing = layout();
  const result = applyDimensionPlacement(dimensions, new Set(['first', 'second']), part, drawing, {
    side: 'top',
    mode: 'cascade',
    gap: 1,
    gridSpacing: 1,
    precision: 2,
  });
  assert.deepEqual(result.dimensions[2], dimensions[2]);
  const first = geometry(result.dimensions[0], drawing).labelBounds,
    second = geometry(result.dimensions[1], drawing).labelBounds;
  assert.ok(disjoint(first, second, 1.49));
  assert.ok(
    Math.abs(
      dimensionLine(result.dimensions[0], drawing).a[1] -
        dimensionLine(result.dimensions[1], drawing).a[1],
    ) >= 7,
  );
});

test('clearing a neighboring projection preserves outward cascade ordering and frozen view transforms', () => {
  const drawing = layout();
  drawing.viewTransforms.top = { ...drawing.viewTransforms.front, y: 110.7 };
  const original = structuredClone(drawing);
  const result = applyDimensionPlacement(
    [linear('short', 0, 20), linear('long', 0, 40)],
    new Set(['short', 'long']),
    part,
    drawing,
    { side: 'top', mode: 'cascade', gap: 10, gridSpacing: 10, precision: 2 },
  );
  const foreign: Bounds2 = { minX: 31.3, maxX: 81.3, minY: 80.7, maxY: 110.7 };
  for (const dimension of result.dimensions)
    assert.ok(disjoint(geometry(dimension, drawing).labelBounds, foreign, 1.49));
  assert.ok(
    dimensionLine(result.dimensions[1], drawing).a[1] <
      dimensionLine(result.dimensions[0], drawing).a[1],
  );
  assert.deepEqual(drawing, original);
});

test('invalid placement distances and grid spacing fail explicitly', () => {
  for (const options of [
    { gap: -1 },
    { gap: NaN },
    { gridSpacing: 0 },
    { gridSpacing: 101 },
    { precision: 7 },
  ])
    assert.throws(
      () =>
        applyDimensionPlacement([linear('one')], new Set(['one']), part, layout(), {
          side: 'top',
          mode: 'align',
          gap: 10,
          precision: 2,
          ...options,
        }),
      RangeError,
    );
});

test('a 7 mm cascade on a 10 mm grid uses steady 10 mm lanes across four nested spans', () => {
  const dimensions = [
    linear('largest', 0, 100),
    linear('third', 0, 60),
    linear('first', 0, 20),
    linear('second', 0, 40),
  ];
  const drawing = layout(1);
  const result = applyDimensionPlacement(
    dimensions,
    new Set(dimensions.map((dimension) => dimension.id)),
    part,
    drawing,
    { side: 'top', mode: 'cascade', gap: 7, gridSpacing: 10, precision: 2 },
  );
  const coordinates = ['first', 'second', 'third', 'largest'].map(
    (id) =>
      dimensionLine(
        result.dimensions.find((dimension) => dimension.id === id)!,
        drawing,
      ).a[1],
  );
  for (let index = 1; index < coordinates.length; index++)
    assert.ok(Math.abs(coordinates[index - 1] - coordinates[index] - 10) < 1e-8);
});

test('an overlapping unselected dimension occupies its baseline even when its label is far away', () => {
  const drawing = layout(1);
  const selected = linear('selected', 0, 100);
  const fixed: Dimension = {
    ...linear('fixed', 0, 40),
    a: [0, 0],
    b: [40, 0],
    offset: -70.7,
    textOffset: [200, 0],
  };
  const original = structuredClone(fixed);
  const fixedY = dimensionLine(fixed, drawing).a[1];
  assert.ok(Math.abs(fixedY - 80) < 1e-8);
  const result = applyDimensionPlacement([selected, fixed], new Set(['selected']), part, drawing, {
    side: 'top',
    mode: 'align',
    gap: 10,
    gridSpacing: 10,
    precision: 2,
  });
  assert.ok(dimensionLine(result.dimensions[0], drawing).a[1] <= fixedY - 10 + 1e-8);
  assert.deepEqual(result.dimensions[1], original);
});
