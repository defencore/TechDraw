import test from 'node:test';
import assert from 'node:assert/strict';
import type { Dimension, Part, Projection } from '../src/model';
import {
  calculateDrawingLayout,
  drawingLayoutFits,
  projectionMetrics,
  STANDARD_DRAWING_SCALES,
} from '../src/drawing/page-layout';
import { initializeDrawing } from '../src/drawing/layout';
import { renderDrawing } from '../src/drawing/render';
import { defaultSettings } from '../src/state';

function view(
  id: Projection['id'],
  minX: number,
  minY: number,
  width: number,
  height: number,
): Projection {
  return {
    id,
    name: id,
    bounds: { minX, minY, maxX: minX + width, maxY: minY + height },
    edges: [
      {
        id: `${id}-edge`,
        kind: 'line',
        hidden: false,
        points: [
          [minX, minY],
          [minX + width, minY + height],
        ],
      },
    ],
  };
}
function cube(size: number): Part {
  return {
    id: 'part',
    name: 'Part',
    sourceName: 'part.step',
    path: ['Part'],
    unit: 'mm',
    bounds: { min: [0, 0, 0], max: [size, size, size] },
    views: [
      view('front', 0, 0, size, size),
      view('top', 0, 0, size, size),
      view('right', 0, 0, size, size),
      view('iso', 0, 0, size, size),
    ],
    warnings: [],
  };
}

test('thin upper projections do not reserve half the sheet height', () => {
  const part: Part = {
    ...cube(120),
    bounds: { min: [0, 0, 0], max: [120, 100, 10] },
    views: [
      view('front', 0, 0, 120, 10),
      view('right', 0, 0, 100, 10),
      view('top', 0, 0, 120, 100),
      view('iso', 0, 0, 155, 100),
    ],
  };
  const layout = calculateDrawingLayout(part, [], defaultSettings);
  assert.equal(layout.scale, 1);
  assert.equal(layout.fits, true);
  assert.ok(
    layout.requiredHeight < 150,
    'the upper row uses its actual contour and caption height',
  );
  assert.equal(drawingLayoutFits(part, [], defaultSettings, layout), true);
});

test('front/top and front/right preserve exact model datums at nonzero world coordinates', () => {
  const part: Part = {
    ...cube(120),
    bounds: { min: [100, -130, -20], max: [220, -30, -10] },
    views: [
      view('front', 100, -20, 120, 10),
      view('right', 30, -20, 100, 10),
      view('top', 100, 30, 120, 100),
      view('iso', -200, 300, 155, 100),
    ],
  };
  const layout = calculateDrawingLayout(part, [], defaultSettings),
    t = layout.viewTransforms;
  assert.equal(t.front.x, t.top.x);
  assert.equal(t.front.y, t.right.y);
  assert.equal(t.front.x + 130 * layout.scale, t.top.x + 130 * layout.scale);
  assert.equal(t.front.y - -15 * layout.scale, t.right.y - -15 * layout.scale);
  assert.ok(
    t.right.x + layout.metrics.right.occupied.maxX < t.front.x + layout.metrics.front.occupied.minX,
  );
  assert.ok(
    t.front.y + layout.metrics.front.occupied.maxY < t.top.y + layout.metrics.top.occupied.minY,
  );
});

test('automatic fitting uses the largest valid standard enlargement and reduction', () => {
  assert.equal(calculateDrawingLayout(cube(20), [], defaultSettings).scale, 4);
  assert.equal(calculateDrawingLayout(cube(30), [], defaultSettings).scale, 2.5);
  assert.equal(calculateDrawingLayout(cube(200), [], defaultSettings).scale, 0.4);
  for (const required of [4, 2.5, 0.4, 0.25, 1 / 15, 1 / 75, 1 / 800])
    assert.ok((STANDARD_DRAWING_SCALES as readonly number[]).includes(required));
  for (const size of [20, 30, 200]) {
    const part = cube(size),
      selected = calculateDrawingLayout(part, [], defaultSettings);
    for (const larger of STANDARD_DRAWING_SCALES.filter((scale) => scale > selected.scale))
      assert.equal(
        calculateDrawingLayout(part, [], { ...defaultSettings, scale: larger }).fits,
        false,
      );
  }
});

test('oversized explicit scales are reported without silently shrinking them', () => {
  const part = cube(30),
    settings = { ...defaultSettings, scale: 5 };
  const layout = calculateDrawingLayout(part, [], settings);
  assert.equal(layout.scale, 5);
  assert.equal(layout.fits, false);
  assert.ok(
    renderDrawing(part, [], settings).warnings.some((warning) =>
      warning.startsWith('The selected scale exceeds'),
    ),
  );
});

test('captions stay centered on the contour when an annotation moves', () => {
  const part = cube(30),
    front = part.views[0];
  const annotation: Dimension = {
    id: 'dimension',
    viewId: 'front',
    kind: 'horizontal',
    a: [0, 0],
    b: [30, 0],
    value: 30,
    offset: 70,
    automatic: false,
  };
  const before = projectionMetrics(front, [], 1, defaultSettings),
    after = projectionMetrics(front, [annotation], 1, defaultSettings);
  assert.deepEqual(after.caption, before.caption);
  const original = calculateDrawingLayout(part, [], defaultSettings);
  const edited = renderDrawing(part, [annotation], defaultSettings, undefined, original);
  assert.equal(edited.scale, original.scale);
  assert.deepEqual(edited.viewTransforms, original.viewTransforms);
});

test('candidate selection measures geometry without serializing projection paths', () => {
  const part = cube(30);
  for (const projection of part.views)
    Object.defineProperty(projection.edges[0], 'points', {
      get() {
        throw new Error('SVG serialization was invoked during layout search.');
      },
    });
  const result = initializeDrawing(
    part,
    [],
    { ...defaultSettings, centerLines: false },
    { arrange: true },
  );
  assert.equal(result.layout.scale, 2.5);
});

test('an outboard isometric uses free width instead of forcing a tall lower row', () => {
  const part: Part = {
    ...cube(100),
    bounds: { min: [0, 0, 0], max: [100, 20, 80] },
    views: [
      view('front', 0, 0, 100, 80),
      view('right', 0, 0, 20, 80),
      view('top', 0, 0, 100, 20),
      view('iso', 0, 0, 80, 110),
    ],
  };
  const layout = calculateDrawingLayout(part, [], defaultSettings);
  assert.equal(layout.scale, 1);
  assert.equal(layout.arrangement, 'isometric-outboard');
  assert.equal(layout.fits, true);
  assert.equal(layout.viewTransforms.front.x, layout.viewTransforms.top.x);
  assert.equal(layout.viewTransforms.front.y, layout.viewTransforms.right.y);
  const t = layout.viewTransforms;
  assert.ok(
    t.iso.x + layout.metrics.iso.occupied.minX > t.front.x + layout.metrics.front.occupied.maxX,
  );
  assert.ok(
    t.iso.x + layout.metrics.iso.occupied.minX > t.top.x + layout.metrics.top.occupied.maxX,
  );
  assert.equal(drawingLayoutFits(part, [], defaultSettings, layout), true);
});

test('the conventional grid remains preferred when it has the smaller footprint', () => {
  const layout = calculateDrawingLayout(cube(20), [], defaultSettings);
  assert.equal(layout.arrangement, 'four-view-grid');
  assert.equal(layout.scale, 4);
});

test('warnings describe actual label conflicts instead of paper size or dimension count', () => {
  const part = cube(20);
  const a4 = renderDrawing(part, [], { ...defaultSettings, format: 'A4', orientation: 'portrait' });
  assert.deepEqual(a4.warnings, []);
  const base: Dimension = {
    id: 'first',
    viewId: 'front',
    kind: 'horizontal',
    a: [0, 0],
    b: [20, 0],
    value: 20,
    offset: 10,
    automatic: false,
  };
  const denseButSeparated = Array.from({ length: 31 }, (_, index) => ({
    ...base,
    id: `dimension-${index}`,
    offset: 10 + index * 6,
  }));
  const large = renderDrawing(part, denseButSeparated, { ...defaultSettings, format: 'A1' });
  assert.deepEqual(large.warnings, []);
  const overlapping = renderDrawing(part, [base, { ...base, id: 'second' }], {
    ...defaultSettings,
    scale: 1,
  });
  assert.ok(
    overlapping.warnings.some((warning) => warning.startsWith('Some dimension labels overlap')),
  );
});
