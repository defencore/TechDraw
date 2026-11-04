import assert from 'node:assert/strict';
import test from 'node:test';
import type { Bounds2, Dimension, Part, Point2, ProjectedEdge, Projection } from '../src/model';
import {
  arrangeDimensions,
  autoDimensions,
  autoDimensionWarnings,
} from '../src/drawing/dimensions';
import { dimensionGeometry } from '../src/drawing/dimension-geometry';

function rectangle(id: Projection['id'], width = 100, height = 60): Projection {
  const corners: Point2[] = [
    [0, 0],
    [width, 0],
    [width, height],
    [0, height],
  ];
  return {
    id,
    name: id,
    bounds: { minX: 0, minY: 0, maxX: width, maxY: height },
    edges: corners.map((point, index) => ({
      id: `${id}-${index}`,
      kind: 'line',
      hidden: false,
      points: [point, corners[(index + 1) % 4]],
    })),
  };
}
function sample(): Part {
  return {
    id: 'plate',
    name: 'Plate',
    sourceName: 'plate.step',
    path: ['Plate'],
    unit: 'mm',
    warnings: [],
    bounds: { min: [0, 0, 0], max: [100, 60, 12] },
    views: [
      rectangle('front', 100, 12),
      rectangle('top'),
      rectangle('right', 60, 12),
      rectangle('iso'),
    ],
  };
}
function circle(id: string, center: Point2, radius: number): ProjectedEdge {
  return {
    id,
    kind: 'circle',
    hidden: false,
    closed: true,
    center,
    radius,
    points: [
      [center[0] + radius, center[1]],
      [center[0], center[1] + radius],
      [center[0] - radius, center[1]],
      [center[0] + radius, center[1]],
    ],
  };
}
const disjoint = (a: Bounds2, b: Bounds2, gap = 0) =>
  a.maxX + gap <= b.minX ||
  b.maxX + gap <= a.minX ||
  a.maxY + gap <= b.minY ||
  b.maxY + gap <= a.minY;

test('circle callouts remain outside large projections and clear complete linear labels at the actual drawing scale', () => {
  const part = sample();
  const view = part.views[1];
  view.edges.push(
    circle('first', [30, 30], 5),
    circle('second', [60, 45], 8),
    circle('third', [70, 20], 3),
  );
  const original = autoDimensions(part, 'full');
  for (const scale of [0.2, 1, 2, 5]) {
    const arranged = arrangeDimensions(original, { scale, part, precision: 3 });
    const callouts = arranged.filter(
      (dimension) => dimension.viewId === 'top' && dimension.kind === 'diameter',
    );
    const linear = arranged.filter(
      (dimension) =>
        dimension.viewId === 'top' && ['horizontal', 'vertical'].includes(dimension.kind),
    );
    const boxes = callouts.map(
      (dimension) => dimensionGeometry(dimension, { x: 0, y: 0, scale }, 3).labelBounds,
    );
    for (const box of boxes) {
      assert.ok(
        box.maxX < view.bounds.minX * scale || box.minX > view.bounds.maxX * scale,
        'the entire callout label must sit beyond the model contour',
      );
      for (const dimension of linear)
        assert.ok(
          disjoint(box, dimensionGeometry(dimension, { x: 0, y: 0, scale }, 3).labelBounds, 1.49),
        );
    }
    for (let index = 0; index < boxes.length; index++)
      for (const prior of boxes.slice(0, index)) assert.ok(disjoint(boxes[index], prior, 1.49));
    assert.deepEqual(
      arranged.map((dimension) => dimension.value),
      original.map((dimension) => dimension.value),
    );
  }
});

test('a circle leader can route around a neighboring hole while retaining its real attachment and requested side', () => {
  const part = sample();
  part.views[1].edges.push(circle('target', [30, 30], 5), circle('neighbor', [60, 45], 8));
  const dimension: Dimension = {
    id: 'manual-hole',
    viewId: 'top',
    kind: 'diameter',
    a: [30, 30],
    b: [35, 30],
    value: 10,
    offset: 10,
    automatic: false,
  };
  const arranged = arrangeDimensions([dimension], { part });
  const leader = dimensionGeometry(arranged[0], { x: 0, y: 0, scale: 1 }, 2).lines.find(
    (line) => line.kind === 'leader',
  )!;
  const dx = leader.b[0] - leader.a[0],
    dy = leader.b[1] - leader.a[1];
  const t = Math.max(
    0,
    Math.min(1, ((60 - leader.a[0]) * dx + (-45 - leader.a[1]) * dy) / (dx * dx + dy * dy)),
  );
  const clearance = Math.hypot(60 - leader.a[0] - t * dx, -45 - leader.a[1] - t * dy);
  assert.ok(
    clearance >= 8.6 - 1e-9,
    'the leader must not pass through the neighboring circular feature',
  );
  assert.ok(arranged[0].offset > 0);
  assert.deepEqual(leader.a, [30 + 5 * 0.7071, -30 - 5 * 0.7071]);
  assert.deepEqual(dimension, {
    id: 'manual-hole',
    viewId: 'top',
    kind: 'diameter',
    a: [30, 30],
    b: [35, 30],
    value: 10,
    offset: 10,
    automatic: false,
  });
});

test('automatic baselines do not repeat the same physical interval in two views and retain every hole-center coordinate', () => {
  const part = sample();
  part.views[0].edges.push({
    id: 'step',
    kind: 'line',
    hidden: false,
    points: [
      [20, 0],
      [20, 4],
    ],
  });
  part.views[1].edges.push(circle('first-hole', [20, 20], 3), circle('second-hole', [60, 40], 3));
  const dimensions = autoDimensions(part, 'full');
  const repeated = dimensions.filter(
    (dimension) => dimension.kind === 'horizontal' && dimension.a[0] === 0 && dimension.b[0] === 20,
  );
  assert.equal(repeated.length, 1);
  assert.equal(repeated[0].viewId, 'top', 'the coordinate belongs beside the visible hole');
  for (const x of [20, 60])
    assert.ok(
      dimensions.some(
        (dimension) =>
          dimension.viewId === 'top' && dimension.kind === 'horizontal' && dimension.b[0] === x,
      ),
    );
  for (const y of [20, 40])
    assert.ok(
      dimensions.some(
        (dimension) =>
          dimension.viewId === 'top' && dimension.kind === 'vertical' && dimension.b[1] === y,
      ),
    );
  assert.deepEqual(autoDimensionWarnings(part, dimensions), []);
});

test('balanced suggestions prioritize hole locations over unrelated earlier profile stations', () => {
  const part = sample();
  for (const x of [2, 4, 6, 8, 10, 12])
    part.views[1].edges.push({
      id: `step-${x}`,
      kind: 'line',
      hidden: false,
      points: [
        [x, 0],
        [x, 4],
      ],
    });
  part.views[1].edges.push(circle('late-hole', [90, 30], 3));
  const dimensions = autoDimensions(part);
  assert.ok(
    dimensions.some(
      (dimension) =>
        dimension.viewId === 'top' && dimension.kind === 'horizontal' && dimension.b[0] === 90,
    ),
  );
  assert.ok(autoDimensionWarnings(part, dimensions).length > 0);
});

test('a circular envelope uses its diameter without redundant bounding-box width and depth dimensions', () => {
  const part = sample();
  part.views = [
    rectangle('front', 24, 20),
    rectangle('top', 24, 24),
    rectangle('right', 24, 20),
    rectangle('iso'),
  ];
  part.views[1].edges = [circle('outside', [12, 12], 12), circle('bore', [12, 12], 5)];
  const dimensions = autoDimensions(part);
  assert.deepEqual(
    dimensions
      .filter((dimension) => dimension.kind === 'diameter')
      .map((dimension) => dimension.value),
    [24, 10],
  );
  assert.deepEqual(
    dimensions
      .filter((dimension) => ['horizontal', 'vertical'].includes(dimension.kind))
      .map((dimension) => dimension.value),
    [20],
  );
});

test('partial fillet arcs are not treated as complete neighboring holes during leader routing', () => {
  const part = sample();
  part.views[0] = rectangle('front', 102, 76);
  part.views[0].edges.push(circle('hole', [87.5, 62], 5), {
    ...circle('fillet', [90.3, 64.8], 2.5),
    closed: false,
    points: [
      [92.8, 64.8],
      [92.0678, 66.5678],
      [90.3, 67.3],
    ],
  });
  const input: Dimension = {
    id: 'hole',
    viewId: 'front',
    kind: 'diameter',
    a: [87.5, 62],
    b: [92.5, 62],
    value: 10,
    offset: 10,
    automatic: true,
  };
  for (const scale of [0.5, 1, 2]) {
    const [arranged] = arrangeDimensions([input], { part, scale });
    assert.ok(
      arranged.offset > 0 && arranged.offset < 30,
      'the near exterior side must remain available beside a partial fillet',
    );
  }
});

test('broad shell arcs combine distinct angular spans into one exact radius callout and ignore small or repeated fragments', () => {
  const part = sample();
  const view = part.views[2];
  view.bounds = { minX: -24, minY: 0, maxX: 0, maxY: 76 };
  view.edges = [];
  const arc = (id: string, radius: number, from: number, to: number): ProjectedEdge => {
    const center: Point2 = [24, 38];
    return {
      id,
      kind: 'circle',
      hidden: false,
      closed: false,
      center,
      radius,
      points: Array.from({ length: 13 }, (_, index) => {
        const angle = ((from + ((to - from) * index) / 12) * Math.PI) / 180;
        return [
          center[0] + radius * Math.cos(angle),
          center[1] + radius * Math.sin(angle),
        ] as Point2;
      }),
    };
  };
  for (const radius of [43, 45, 47.6]) {
    view.edges.push(
      arc(`${radius}-first`, radius, 150, 180),
      arc(`${radius}-last`, radius, 180, 210),
    );
  }
  for (let index = 0; index < 8; index++) view.edges.push(arc(`duplicate-${index}`, 44, 150, 160));
  view.edges.push(arc('small-fillet', 6.5, 0, 180));
  const radii = autoDimensions(part).filter(
    (dimension) => dimension.kind === 'radius' && dimension.viewId === 'right',
  );
  assert.deepEqual(
    radii.map((dimension) => dimension.value).sort((a, b) => a - b),
    [43, 45, 47.6],
  );
  for (const dimension of radii) {
    assert.ok(
      Math.abs(
        Math.hypot(dimension.b[0] - dimension.a[0], dimension.b[1] - dimension.a[1]) -
          dimension.value,
      ) < 1e-10,
    );
    assert.ok(
      view.edges.some(
        (edge) =>
          edge.radius === dimension.value &&
          edge.points.some((point) => point[0] === dimension.b[0] && point[1] === dimension.b[1]),
      ),
      'the leader must attach to the existing analytic arc',
    );
  }
  view.edges.push(circle('complete-circle', [24, 38], 45));
  const complete = autoDimensions(part);
  assert.ok(
    complete.some(
      (dimension) =>
        dimension.viewId === 'right' && dimension.kind === 'diameter' && dimension.value === 90,
    ),
  );
  assert.ok(
    !complete.some(
      (dimension) =>
        dimension.viewId === 'right' && dimension.kind === 'radius' && dimension.value === 45,
    ),
    'a full diameter already conveys that same circular size',
  );
});
