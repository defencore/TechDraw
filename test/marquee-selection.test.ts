import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Dimension, Point2 } from '../src/model';
import { dimensionGeometry } from '../src/drawing/dimension-geometry';
import { marqueeRegion, selectMarquee, type MarqueeItem } from '../src/ui/marquee-selection';

const dimension: Dimension = {
  id: 'dimension',
  viewId: 'front',
  kind: 'horizontal',
  a: [10, 0],
  b: [50, 0],
  value: 40,
  offset: 20,
  automatic: false,
};
const transform = { x: 0, y: 100, scale: 1 };
const item = (d = dimension): MarqueeItem => ({
  id: d.id,
  geometry: dimensionGeometry(d, transform, 2),
});

test('left-to-right boxes require the entire annotation including extensions and tolerance labels', () => {
  const d: Dimension = {
    ...dimension,
    tolerance: { kind: 'deviation', upper: '+0.20', lower: '-0.10' },
  };
  const annotation = item(d),
    b = annotation.geometry.bounds;
  assert.deepEqual(selectMarquee([annotation], [b.minX, b.minY], [b.maxX, b.maxY]), [d.id]);
  assert.deepEqual(selectMarquee([annotation], [b.minX, b.minY + 2], [b.maxX, b.maxY]), []);
  assert.deepEqual(selectMarquee([annotation], [29, 119], [31, 121]), []);
});

test('right-to-left boxes cross actual dimension lines and retain the original item order', () => {
  const first = item(),
    second = item({ ...dimension, id: 'second', offset: 30 });
  assert.deepEqual(selectMarquee([first, second], [31, 121], [29, 119]), ['dimension']);
  assert.deepEqual(selectMarquee([first, second], [51, 135], [9, 99]), ['dimension', 'second']);
  assert.deepEqual(marqueeRegion([31, 121], [29, 119]), {
    crossing: true,
    bounds: { minX: 29, minY: 119, maxX: 31, maxY: 121 },
  });
});

test('crossing a leader bounding-box gap does not select an annotation in empty space', () => {
  const leader = item({
    ...dimension,
    kind: 'radius',
    a: [0, 0],
    b: [10, 0],
    value: 10,
    offset: 50,
    textOffset: [0, -20],
  });
  assert.deepEqual(selectMarquee([leader], [16, 61], [14, 59]), []);
  assert.deepEqual(selectMarquee([leader], [51, 61], [49, 59]), ['dimension']);
});

test('angular crossing uses exact arc intersections and ignores the empty sector', () => {
  const angle = item({
    ...dimension,
    kind: 'angle',
    a: [10, 0],
    b: [0, 10],
    vertex: [0, 0],
    value: 90,
    offset: 20,
  });
  const x = Math.SQRT1_2 * 20,
    y = 100 - x;
  assert.deepEqual(selectMarquee([angle], [x + 0.01, y + 0.01], [x - 0.01, y - 0.01]), [
    'dimension',
  ]);
  assert.deepEqual(selectMarquee([angle], [5.1, 95.1], [4.9, 94.9]), []);
  assert.deepEqual(selectMarquee([angle], [20.1, 100.1], [19.9, 99.9]), ['dimension']);
});

test('a rotated label selects only its actual rectangle and a tiny box inside its fill still intersects', () => {
  const annotation = item({
    ...dimension,
    kind: 'aligned',
    a: [0, 0],
    b: [30, 30],
    value: Math.hypot(30, 30),
  });
  const { geometry } = annotation,
    { labelBounds: b, label } = geometry;
  const labelOnly: MarqueeItem = {
    ...annotation,
    geometry: { ...geometry, bounds: b, lines: [], arcs: [], arrows: [] },
  };
  const center: Point2 = [label.origin[0], label.origin[1] - 1];
  assert.deepEqual(
    selectMarquee(
      [labelOnly],
      [center[0] + 0.05, center[1] + 0.05],
      [center[0] - 0.05, center[1] - 0.05],
    ),
    ['dimension'],
  );
  assert.deepEqual(
    selectMarquee([labelOnly], [b.maxX - 0.01, b.maxY - 0.01], [b.maxX - 0.05, b.maxY - 0.05]),
    [],
  );
});

test('invalid box coordinates fail without changing any source geometry', () => {
  const annotation = item(),
    before = structuredClone(annotation);
  assert.throws(() => selectMarquee([annotation], [NaN, 0], [1, 1]), RangeError);
  assert.throws(() => marqueeRegion([0, 0], [Infinity, 0]), RangeError);
  selectMarquee([annotation], [100, 200], [0, 0]);
  assert.deepEqual(annotation, before);
});
