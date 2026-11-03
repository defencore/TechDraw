import assert from 'node:assert/strict';
import test from 'node:test';
import type { Point2 } from '../src/model';
import {
  clampViewportZoom,
  fitViewport,
  fromSheet,
  getViewportTransform,
  MAX_VIEWPORT_ZOOM,
  MIN_VIEWPORT_ZOOM,
  panViewport,
  resizeViewport,
  toSheet,
  zoomAt,
  type ViewportMetrics,
  type ViewportState,
} from '../src/ui/viewport';

const metrics: ViewportMetrics = {
  width: 1000,
  height: 700,
  paperWidth: 420,
  paperHeight: 297,
  padding: 24,
};
const near = (actual: number, expected: number, tolerance = 1e-9) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} must equal ${expected}`);
const nearPoint = (actual: Point2, expected: Point2) => {
  near(actual[0], expected[0]);
  near(actual[1], expected[1]);
};

test('fit contains the full sheet in a short or narrow viewport without distorting it', () => {
  for (const viewport of [metrics, { ...metrics, width: 320, height: 1000 }]) {
    const state = fitViewport();
    const corner = fromSheet([0, 0], state, viewport);
    const opposite = fromSheet([viewport.paperWidth, viewport.paperHeight], state, viewport);
    assert.ok(corner[0] >= viewport.padding! - 1e-9);
    assert.ok(corner[1] >= viewport.padding! - 1e-9);
    assert.ok(opposite[0] <= viewport.width - viewport.padding! + 1e-9);
    assert.ok(opposite[1] <= viewport.height - viewport.padding! + 1e-9);
    near((opposite[0] - corner[0]) / (opposite[1] - corner[1]), 420 / 297);
    nearPoint(fromSheet([viewport.paperWidth / 2, viewport.paperHeight / 2], state, viewport), [
      viewport.width / 2,
      viewport.height / 2,
    ]);
  }
});

test('cursor zoom preserves its sheet position after panning and at viewport edges', () => {
  const state: ViewportState = { zoom: 1.6, pan: [83, -47] };
  for (const cursor of [
    [0, 0],
    [500, 350],
    [940, 60],
    [1000, 700],
  ] as Point2[]) {
    const sheetPoint = toSheet(cursor, state, metrics);
    const changed = zoomAt(state, metrics, cursor, 3.25);
    nearPoint(toSheet(cursor, changed, metrics), sheetPoint);
    nearPoint(fromSheet(sheetPoint, changed, metrics), cursor);
  }
  assert.deepEqual(state, { zoom: 1.6, pan: [83, -47] });
});

test('repeated zooming in and out at one cursor does not drift the paper', () => {
  const initial: ViewportState = { zoom: 1.25, pan: [-72.5, 18.75] };
  const cursor: Point2 = [834, 113];
  let state = initial;
  for (let index = 0; index < 500; index++) {
    state = zoomAt(state, metrics, cursor, 7.5);
    state = zoomAt(state, metrics, cursor, 1.25);
  }
  nearPoint(state.pan, initial.pan);
  nearPoint(
    fromSheet([77.125, 19.875], state, metrics),
    fromSheet([77.125, 19.875], initial, metrics),
  );
});

test('zoom is clamped without shifting its anchor and repeated limit requests do not drift', () => {
  const cursor: Point2 = [170, 580];
  const initial = fitViewport();
  const sheetPoint = toSheet(cursor, initial, metrics);
  let maximum = zoomAt(initial, metrics, cursor, 1000);
  assert.equal(maximum.zoom, MAX_VIEWPORT_ZOOM);
  nearPoint(toSheet(cursor, maximum, metrics), sheetPoint);
  const initialPan = [...maximum.pan];
  for (let index = 0; index < 100; index++) maximum = zoomAt(maximum, metrics, cursor, Infinity);
  assert.deepEqual(maximum.pan, initialPan);
  const minimum = zoomAt(maximum, metrics, cursor, -1000);
  assert.equal(minimum.zoom, MIN_VIEWPORT_ZOOM);
  nearPoint(toSheet(cursor, minimum, metrics), sheetPoint);
  assert.equal(clampViewportZoom(Number.NaN), 1);
});

test('resize keeps the centre sheet point and relative fit zoom stable', () => {
  const nextMetrics = { ...metrics, width: 680, height: 1100 };
  const initial: ViewportState = { zoom: 3.5, pan: [250, -120] };
  const oldCentre = toSheet([metrics.width / 2, metrics.height / 2], initial, metrics);
  const resized = resizeViewport(initial, metrics, nextMetrics);
  assert.equal(resized.zoom, initial.zoom);
  nearPoint(
    toSheet([nextMetrics.width / 2, nextMetrics.height / 2], resized, nextMetrics),
    oldCentre,
  );
  const restored = resizeViewport(resized, nextMetrics, metrics);
  nearPoint(restored.pan, initial.pan);
  nearPoint(resizeViewport(fitViewport(), metrics, nextMetrics).pan, [0, 0]);
});

test('panning moves every sheet point by the same pixel delta and conversions stay inverse', () => {
  const initial: ViewportState = { zoom: 2.75, pan: [-87, 42] };
  const delta: Point2 = [83.25, -27.5];
  const changed = panViewport(initial, delta);
  assert.equal(changed.zoom, initial.zoom);
  const point: Point2 = [153.125, 209.875];
  const before = fromSheet(point, initial, metrics);
  const after = fromSheet(point, changed, metrics);
  nearPoint([after[0] - before[0], after[1] - before[1]], delta);
  nearPoint(toSheet(after, changed, metrics), point);
  assert.deepEqual(initial.pan, [-87, 42]);
});

test('a temporarily collapsed viewport still produces a finite usable transform', () => {
  const transform = getViewportTransform(fitViewport(), { ...metrics, width: 0, height: 0 });
  assert.ok(Object.values(transform).every(Number.isFinite));
  assert.ok(transform.scale > 0);
});
