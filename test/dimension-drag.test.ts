import test from 'node:test';
import assert from 'node:assert/strict';
import type { Dimension, Part, Point2, Projection } from '../src/model';
import { dragDimension, positionDimension } from '../src/ui/dimension-drag';
import { renderDrawing, type ViewTransform } from '../src/drawing/render';
import { defaultSettings } from '../src/state';

const transform: ViewTransform = { x: 10, y: 100, scale: 2 };
const dimension = (kind: Dimension['kind'] = 'horizontal'): Dimension => ({
  id: 'dimension',
  viewId: 'front',
  kind,
  a: [0, 0],
  b: [30, 0],
  value: 30,
  offset: 10,
  textOffset: [2, -3],
  automatic: false,
  suffix: ' ±0.05',
});

test('horizontal drags change only paper-normal offset and preserve independent undo geometry', () => {
  const initial = dimension();
  const moved = dragDimension(initial, [100, 100], [114, 96], transform);
  assert.equal(moved.offset, 6);
  assert.equal(moved.value, initial.value);
  assert.deepEqual(moved.a, initial.a);
  assert.deepEqual(moved.b, initial.b);
  assert.deepEqual(moved.textOffset, initial.textOffset);
  assert.notEqual(moved.a, initial.a);
  assert.notEqual(moved.b, initial.b);
  assert.notEqual(moved.textOffset, initial.textOffset);
  assert.equal(initial.offset, 10);
  const differentScale = dragDimension(initial, [100, 100], [114, 96], {
    x: -50,
    y: 20,
    scale: 0.25,
  });
  assert.equal(
    differentScale.offset,
    moved.offset,
    'sheet-space movement is independent of model scale and view translation',
  );
});

test('vertical drags move the full dimension line right or left across either side', () => {
  const initial = {
    ...dimension('vertical'),
    a: [0, 0] as Point2,
    b: [0, 30] as Point2,
    offset: -10,
  };
  const right = dragDimension(initial, [40, 40], [45, 80], transform);
  const left = dragDimension(initial, [40, 40], [33, 80], transform);
  assert.equal(right.offset, -15);
  assert.equal(left.offset, -3);
  assert.deepEqual(right.a, [0, 0]);
  assert.deepEqual(right.b, [0, 30]);
});

test('aligned movement projects onto the displayed normal rather than the model Y direction', () => {
  const initial = {
    ...dimension('aligned'),
    a: [0, 0] as Point2,
    b: [3, 4] as Point2,
    value: 5,
    offset: 6,
  };
  const tangential = dragDimension(initial, [0, 0], [6, -8], transform);
  const normal = dragDimension(initial, [0, 0], [8, 6], transform);
  assert.ok(Math.abs(tangential.offset - 6) < 1e-12);
  assert.ok(Math.abs(normal.offset - 16) < 1e-12);
  assert.equal(normal.value, 5);
});

test('radius and diameter drags translate their connected leader labels without moving measured points', () => {
  for (const kind of ['radius', 'diameter'] as const) {
    const initial = {
      ...dimension(kind),
      a: [10, 10] as Point2,
      b: [15, 10] as Point2,
      value: kind === 'radius' ? 5 : 10,
      offset: -10,
      textOffset: [3, -2] as Point2,
    };
    const moved = dragDimension(initial, [40, 30], [44, 35], transform);
    assert.deepEqual(moved.textOffset, [7, 3]);
    assert.equal(moved.offset, -10);
    assert.deepEqual(moved.a, [10, 10]);
    assert.deepEqual(moved.b, [15, 10]);
    assert.equal(moved.value, initial.value);
  }
});

test('angular drags use the projected vertex and change only arc radius with a readable minimum', () => {
  const initial: Dimension = {
    ...dimension('angle'),
    a: [15, 7],
    b: [5, 17],
    vertex: [5, 7],
    value: 90,
    offset: 14,
  };
  const projectedVertex: Point2 = [110, 66];
  const mapping = { x: 100, y: 80, scale: 2 };
  assert.equal(dragDimension(initial, [120, 66], [130, 66], mapping).offset, 24);
  assert.equal(dragDimension(initial, [120, 66], [110, 76], mapping).offset, 14);
  const inward = dragDimension(initial, [120, 66], projectedVertex, mapping);
  assert.equal(inward.offset, 6);
  assert.equal(inward.value, 90);
  assert.deepEqual(inward.vertex, initial.vertex);
  assert.equal(
    dragDimension({ ...initial, offset: -14 }, [120, 66], [130, 66], mapping).offset,
    -24,
  );
});

test('draft linear dimensions are placed at the cursor with stale label moves removed', () => {
  const horizontal = positionDimension(dimension(), [45, 130], transform);
  assert.equal(horizontal.offset, 30);
  assert.equal(horizontal.textOffset, undefined);
  const vertical = positionDimension(
    { ...dimension('vertical'), a: [0, 0], b: [0, 30] },
    [-5, 50],
    transform,
  );
  assert.equal(vertical.offset, 15);
  const aligned = positionDimension(
    { ...dimension('aligned'), a: [0, 0], b: [3, 4], value: 5 },
    [21, 102],
    transform,
  );
  assert.equal(aligned.offset, 10);
  const angle = positionDimension(
    { ...dimension('angle'), a: [10, 0], b: [0, 10], vertex: [0, 0], value: 90 },
    [10, 70],
    transform,
  );
  assert.equal(angle.offset, 30);
  assert.deepEqual(horizontal.a, [0, 0]);
  assert.deepEqual(horizontal.b, [30, 0]);
});

function samplePart(): Part {
  const views: Projection[] = (['front', 'top', 'right', 'iso'] as const).map((id) => ({
    id,
    name: id,
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
    edges: [
      {
        id: `${id}-edge`,
        kind: 'line',
        hidden: false,
        points: [
          [0, 0],
          [20, 20],
        ],
      },
    ],
  }));
  return {
    id: 'part',
    name: 'Part',
    sourceName: 'part.step',
    path: ['Part'],
    unit: 'mm',
    bounds: { min: [0, 0, 0], max: [20, 20, 20] },
    views,
    warnings: [],
  };
}

test('circle draft placement matches the rendered label baseline on both sides at reduced and enlarged drawing scales', () => {
  const part = samplePart();
  for (const scale of [0.5, 1, 2, 5])
    for (const kind of ['radius', 'diameter'] as const)
      for (const side of [-1, 1]) {
        const initial: Dimension = {
          ...dimension(kind),
          a: [10, 10],
          b: kind === 'radius' ? [13, 14] : [15, 10],
          value: kind === 'radius' ? 5 : 10,
        };
        const settings = { ...defaultSettings, format: 'A1' as const, scale };
        const layout = renderDrawing(part, [initial], settings);
        const t = layout.viewTransforms.front;
        assert.equal(t.scale, scale);
        const cursor: Point2 = [t.x + 10 * t.scale + side * 35, t.y - 10 * t.scale - 20];
        const placed = positionDimension(initial, cursor, t);
        const rendered = renderDrawing(part, [placed], settings, undefined, layout);
        const label = rendered.svg.match(
          /<g class="dimension-label"[^>]*><rect[^>]*\/><text x="([^"]+)" y="([^"]+)"/,
        );
        assert.ok(label);
        assert.ok(Math.abs(Number(label[1]) - cursor[0]) < 1e-5);
        assert.ok(Math.abs(Number(label[2]) - cursor[1]) < 1e-5);
        assert.equal(placed.offset, side * 10);
        assert.deepEqual(placed.a, initial.a);
        assert.deepEqual(placed.b, initial.b);
      }
});

test('cumulative drags use the pointerdown snapshot and do not accumulate repeated move events', () => {
  const initial = dimension();
  const first = dragDimension(initial, [0, 0], [5, 3], transform);
  const second = dragDimension(initial, [0, 0], [5, 7], transform);
  assert.equal(first.offset, 13);
  assert.equal(second.offset, 17);
  assert.deepEqual(dragDimension(initial, [10, 10], [10, 10], transform), initial);
});

test('invalid transforms and pointer coordinates cannot introduce NaN annotations', () => {
  assert.throws(() => dragDimension(dimension(), [0, 0], [NaN, 10], transform), RangeError);
  assert.throws(
    () => positionDimension(dimension(), [10, 10], { ...transform, scale: 0 }),
    RangeError,
  );
  const degenerate: Dimension = { ...dimension('aligned'), a: [0, 0], b: [0, 0], value: 0 };
  assert.equal(dragDimension(degenerate, [0, 0], [10, 10], transform).offset, degenerate.offset);
});
