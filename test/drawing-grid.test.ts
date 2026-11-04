import { isGridSpacing, snapCoordinate } from '../src/drawing/grid-coordinates';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Dimension, Point2 } from '../src/model';
import { dimensionGeometry } from '../src/drawing/dimension-geometry';
import { dragDimension } from '../src/ui/dimension-drag';
import {
  defaultGridSettings,
  renderWorkspaceGrid,
  snapDimensionToGrid,
  snappedDragPoint,
  visibleGridSpacing,
} from '../src/ui/drawing-grid';

const transform = { x: 51.3, y: 100.37, scale: 0.5 };
const grid = { ...defaultGridSettings, snap: true, spacing: 5 };
const dimension = (kind: Dimension['kind'] = 'horizontal'): Dimension => ({
  id: 'dimension',
  viewId: 'front',
  kind,
  a: [0, 0],
  b: [40, 0],
  value: 40,
  offset: 9,
  automatic: false,
});
const near = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} must equal ${expected}`);

test('sheet grid rounding handles negative coordinates, custom spacing and directional placement', () => {
  assert.equal(snapCoordinate(12.4, 5), 10);
  assert.equal(snapCoordinate(-12.4, 5), -10);
  assert.equal(snapCoordinate(-12.4, 5, 'min'), -15);
  assert.equal(snapCoordinate(-12.4, 5, 'max'), -10);
  assert.equal(snapCoordinate(0.1 + 0.2, 0.1, 'max'), 0.3);
  assert.equal(snapCoordinate(1.42, 0.3), 1.5);
  assert.ok(!Object.is(snapCoordinate(-0.01, 5), -0));
  for (const spacing of [NaN, Infinity, 0, 0.09, 101, '5', null]) {
    assert.equal(isGridSpacing(spacing), false);
    assert.throws(() => snapCoordinate(2, spacing as number), RangeError);
  }
  assert.throws(() => snapCoordinate(Infinity, 5), RangeError);
});

test('a dense workspace grid coarsens only its display and retains the physical page origin', () => {
  const content = { minX: 21, minY: 20, maxX: 200, maxY: 220 };
  const fine = { visible: true, snap: true, spacing: 0.1 };
  const coarse = visibleGridSpacing(0.1, 1);
  assert.ok(coarse > 0.1 && coarse >= 7);
  assert.equal(visibleGridSpacing(10, 2), 10);
  const markup = renderWorkspaceGrid(content, fine, 1);
  assert.match(markup, /patternUnits="userSpaceOnUse" x="0" y="0"/);
  assert.match(markup, /<rect x="21" y="20" width="179" height="200"/);
  assert.equal(renderWorkspaceGrid(content, { ...fine, visible: false }, 1), '');
  assert.equal(snapCoordinate(23.17, fine.spacing), 23.2);
});

test('an overfull sheet has no workspace grid instead of invalid negative-size SVG rectangles', () => {
  const visible = { ...grid, visible: true };
  assert.equal(renderWorkspaceGrid({ minX: 20, minY: 300, maxX: 200, maxY: 220 }, visible, 1), '');
  assert.equal(renderWorkspaceGrid({ minX: 200, minY: 20, maxX: 200, maxY: 220 }, visible, 1), '');
});

test('linear snapping quantizes actual paper dimension lines, not model coordinates or offsets', () => {
  const horizontal = dimension();
  const moved = snapDimensionToGrid(horizontal, transform, 2, grid);
  near(transform.y + moved.offset, 110);
  assert.notEqual(moved.offset % grid.spacing, 0);
  assert.deepEqual(moved.a, horizontal.a);
  assert.deepEqual(moved.b, horizontal.b);
  assert.equal(moved.value, horizontal.value);
  const vertical = { ...dimension('vertical'), b: [0, 40] as Point2 };
  const v = snapDimensionToGrid(vertical, transform, 2, grid);
  near(transform.x - v.offset, 40);
  assert.deepEqual(horizontal, dimension());
});

test('circle snapping moves its complete leader to a grid baseline without moving the measured rim', () => {
  for (const kind of ['radius', 'diameter'] as const)
    for (const side of [-1, 1]) {
      const original: Dimension = {
        ...dimension(kind),
        a: [20, 20],
        b: [25, 20],
        value: kind === 'radius' ? 5 : 10,
        offset: side * 10,
        textOffset: [2.7, -0.4],
        tolerance: { kind: 'deviation', upper: '+0.20', lower: '-0.10' },
      };
      const before = dimensionGeometry(original, transform, 3);
      const snapped = snapDimensionToGrid(original, transform, 3, grid);
      const after = dimensionGeometry(snapped, transform, 3);
      near(after.label.origin[0] % 5, 0);
      near(after.label.origin[1] % 5, 0);
      assert.deepEqual(after.lines[0].a, before.lines[0].a);
      near(
        after.lines[0].b[0] - before.lines[0].b[0],
        after.label.origin[0] - before.label.origin[0],
      );
      near(
        after.lines[0].b[1] - before.lines[0].b[1],
        after.label.origin[1] - before.label.origin[1],
      );
      assert.deepEqual(snapped.a, original.a);
      assert.deepEqual(snapped.b, original.b);
      assert.deepEqual(snapped.tolerance, original.tolerance);
      assert.equal(snapped.offset, original.offset);
    }
});

test('aligned dimensions snap their dominant normal axis and angular dimensions snap the arc radius', () => {
  const aligned: Dimension = { ...dimension('aligned'), b: [30, 40], value: 50 };
  const next = snapDimensionToGrid(aligned, transform, 2, grid);
  const line = dimensionGeometry(next, transform, 2).lines.find(
    (line) => line.kind === 'dimension',
  )!;
  near(((line.a[0] + line.b[0]) / 2) % 5, 0);
  const angle: Dimension = {
    ...dimension('angle'),
    a: [10, 0],
    b: [0, 10],
    vertex: [0, 0],
    value: 90,
    offset: -13,
  };
  const snapped = snapDimensionToGrid(angle, transform, 2, grid);
  assert.equal(snapped.offset, -15);
  assert.deepEqual(snapped.vertex, angle.vertex);
  assert.equal(snapDimensionToGrid({ ...angle, offset: 6 }, transform, 2, grid).offset, 6);
});

test('group dragging uses one snapped movement and preserves six millimetre lanes on a ten millimetre grid', () => {
  const first = dimension(),
    second = { ...dimension(), id: 'second', offset: 15 };
  const start: Point2 = [100, 100],
    current: Point2 = [102, 104];
  const corrected = snappedDragPoint(first, start, current, transform, 2, { ...grid, spacing: 10 });
  const moved = [first, second].map((d) => dragDimension(d, start, corrected, transform));
  near((transform.y + moved[0].offset) % 10, 0);
  near(moved[1].offset - moved[0].offset, 6);
  assert.deepEqual(moved[0].a, first.a);
  assert.deepEqual(moved[1].b, second.b);
  const free = { ...grid, snap: false };
  assert.equal(snappedDragPoint(first, start, current, transform, 2, free), current);
  assert.equal(snapDimensionToGrid(first, transform, 2, free), first);
});

test('angular dragging still snaps correctly after crossing the minimum readable radius', () => {
  const angle: Dimension = {
    ...dimension('angle'),
    a: [10, 0],
    b: [0, 10],
    vertex: [0, 0],
    value: 90,
    offset: 14,
  };
  const mapping = { x: 100, y: 100, scale: 1 };
  const start: Point2 = [114, 100];
  for (const current of [
    [101, 100],
    [100, 100],
  ] as Point2[]) {
    const corrected = snappedDragPoint(angle, start, current, mapping, 2, { ...grid, spacing: 10 });
    assert.equal(dragDimension(angle, start, corrected, mapping).offset, 10);
  }
});
