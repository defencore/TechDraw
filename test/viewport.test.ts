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
  preserveViewportTransform,
  resizeViewport,
  toSheet,
  zoomAt,
  viewportSafeArea,
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

test('a full canvas with floating-control insets preserves the old fitted paper global position exactly', () => {
  const old = { ...metrics, height: metrics.height - 100 - 46 };
  const full = { ...metrics, insets: { top: 100, right: 0, bottom: 46, left: 0 } };
  for (const state of [fitViewport(), { zoom: 3.2, pan: [47, -29] as Point2 }]) {
    const before = getViewportTransform(state, old),
      after = getViewportTransform(state, full);
    assert.equal(after.scale, before.scale);
    assert.equal(after.x, before.x);
    assert.equal(after.y, before.y + 100);
  }
});

test('fit and cursor zoom use an asymmetric safe rectangle while allowing paper under the controls', () => {
  const insetMetrics = { ...metrics, insets: { top: 117, right: 63, bottom: 41, left: 19 } };
  const area = viewportSafeArea(insetMetrics),
    fitted = fitViewport();
  assert.deepEqual(area, { x: 19, y: 117, width: 918, height: 542 });
  const corner = fromSheet([0, 0], fitted, insetMetrics);
  const opposite = fromSheet([metrics.paperWidth, metrics.paperHeight], fitted, insetMetrics);
  assert.ok(corner[0] >= area.x + metrics.padding! - 1e-9);
  assert.ok(corner[1] >= area.y + metrics.padding! - 1e-9);
  assert.ok(opposite[0] <= area.x + area.width - metrics.padding! + 1e-9);
  assert.ok(opposite[1] <= area.y + area.height - metrics.padding! + 1e-9);
  nearPoint(fromSheet([metrics.paperWidth / 2, metrics.paperHeight / 2], fitted, insetMetrics), [
    area.x + area.width / 2,
    area.y + area.height / 2,
  ]);
  const initial: ViewportState = { zoom: 1.8, pan: [83, -47] };
  for (const cursor of [
    [0, 0],
    [1000, 700],
    [478, 388],
    [222, 44],
  ] as Point2[]) {
    const paper = toSheet(cursor, initial, insetMetrics);
    const zoomed = zoomAt(initial, insetMetrics, cursor, 4);
    nearPoint(toSheet(cursor, zoomed, insetMetrics), paper);
    nearPoint(fromSheet(paper, zoomed, insetMetrics), cursor);
  }
  const zoomed = getViewportTransform(zoomAt(fitted, insetMetrics, [478, 388], 4), insetMetrics);
  assert.ok(zoomed.y < area.y, 'Insets reserve fit space, not a clipping boundary');
});

test('resize and changing control insets retain the paper point at the safe-area centre', () => {
  const before = { ...metrics, insets: { top: 100, right: 20, bottom: 46, left: 60 } };
  const after = {
    ...metrics,
    width: 720,
    height: 940,
    insets: { top: 112, right: 40, bottom: 94, left: 10 },
  };
  const initial: ViewportState = { zoom: 3.5, pan: [250, -120] };
  const a = viewportSafeArea(before),
    b = viewportSafeArea(after);
  const paper = toSheet([a.x + a.width / 2, a.y + a.height / 2], initial, before);
  const resized = resizeViewport(initial, before, after);
  assert.equal(resized.zoom, initial.zoom);
  nearPoint(toSheet([b.x + b.width / 2, b.y + b.height / 2], resized, after), paper);
  nearPoint(resizeViewport(resized, after, before).pan, initial.pan);
  nearPoint(resizeViewport(fitViewport(), before, after).pan, [0, 0]);
});

test('invalid or oversized control insets cannot make a collapsed viewport non-finite', () => {
  for (const viewport of [
    { ...metrics, insets: { top: -20, right: NaN, bottom: Infinity, left: -1 } },
    { ...metrics, width: 20, height: 10, insets: { top: 100, right: 200, bottom: 50, left: 300 } },
    { ...metrics, width: 0, height: 0, insets: { top: 100, right: 0, bottom: 46, left: 0 } },
  ]) {
    const area = viewportSafeArea(viewport);
    assert.ok(Object.values(area).every(Number.isFinite));
    assert.ok(area.width >= 1 && area.height >= 1 && area.x >= 0 && area.y >= 0);
    const transform = getViewportTransform(fitViewport(), viewport);
    assert.ok(Object.values(transform).every(Number.isFinite));
    assert.ok(transform.scale > 0);
  }
});

test('changing floating controls preserves exact paper scale, origin and every screen point', () => {
  const previous = { ...metrics, insets: { top: 100, right: 0, bottom: 46, left: 0 } };
  const next = { ...metrics, insets: { top: 160, right: 25, bottom: 94, left: 30 } };
  const initial: ViewportState = { zoom: 2.7, pan: [121, -73] };
  const preserved = preserveViewportTransform(initial, previous, next);
  const before = getViewportTransform(initial, previous),
    after = getViewportTransform(preserved, next);
  near(after.scale, before.scale);
  near(after.x, before.x);
  near(after.y, before.y);
  assert.notEqual(
    preserved.zoom,
    initial.zoom,
    'The relative fit percentage adjusts to preserve physical scale',
  );
  for (const point of [
    [0, 0],
    [420, 297],
    [103.74, 217.91],
    [-10, 350],
  ] as Point2[])
    nearPoint(fromSheet(point, preserved, next), fromSheet(point, initial, previous));
  nearPoint(preserveViewportTransform(preserved, next, previous).pan, initial.pan);
  assert.deepEqual(initial, { zoom: 2.7, pan: [121, -73] });
});

test('inset preservation respects zoom limits and retains paper origin when exact scale is impossible', () => {
  const previous = { ...metrics, insets: { top: 0, right: 0, bottom: 0, left: 0 } };
  const next = { ...metrics, insets: { top: 450, right: 0, bottom: 100, left: 0 } };
  const initial: ViewportState = { zoom: MAX_VIEWPORT_ZOOM, pan: [7, -11] };
  const preserved = preserveViewportTransform(initial, previous, next);
  assert.equal(preserved.zoom, MAX_VIEWPORT_ZOOM);
  const before = getViewportTransform(initial, previous),
    after = getViewportTransform(preserved, next);
  assert.ok(after.scale < before.scale);
  nearPoint([after.x, after.y], [before.x, before.y]);
});
