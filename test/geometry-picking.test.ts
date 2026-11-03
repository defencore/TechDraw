import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nearestPointOnEdge, pickGeometry } from '../src/ui/geometry-picking';
import type { Part, Point2, ProjectedEdge, Projection, ViewId } from '../src/model';
import type { RenderedDrawing, ViewTransform } from '../src/drawing/render';

const line = (id: string, a: Point2, b: Point2, hidden = false): ProjectedEdge => ({
  id,
  kind: 'line',
  points: [a, b],
  hidden,
});
const view = (id: ViewId, edges: ProjectedEdge[], anchors?: Projection['anchors']): Projection => ({
  id,
  name: id,
  edges,
  anchors,
  bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
});
function part(views: Projection[]): Part {
  return {
    id: 'test',
    name: 'Test',
    sourceName: 'test.step',
    path: [],
    unit: 'mm',
    bounds: { min: [0, 0, 0], max: [100, 100, 100] },
    warnings: [],
    views,
  };
}
function drawing(
  front: ViewTransform = { x: 20, y: 50, scale: 1 },
): Pick<RenderedDrawing, 'viewTransforms'> {
  return {
    viewTransforms: {
      front,
      top: { x: 200, y: 50, scale: 1 },
      right: { x: 350, y: 50, scale: 1 },
      iso: { x: 500, y: 50, scale: 1 },
    },
  };
}
const sheet = (point: Point2, transform: ViewTransform): Point2 => [
  transform.x + point[0] * transform.scale,
  transform.y - point[1] * transform.scale,
];

test('point and edge radii stay constant in screen pixels across sheet scale and viewport zoom', () => {
  const model = part([view('front', [line('edge', [0, 0], [100, 0])])]);
  for (const pxPerMm of [0.5, 1, 4, 20])
    for (const scale of [0.5, 1, 3]) {
      const rendered = drawing({ x: 20, y: 50, scale });
      const endpoint = sheet([0, 0], rendered.viewTransforms.front);
      const snap = pickGeometry(
        model,
        rendered,
        [endpoint[0], endpoint[1] + 9 / pxPerMm],
        pxPerMm,
        'point',
      );
      assert.deepEqual(snap?.anchor?.point, [0, 0]);
      assert.ok(Math.abs(snap!.distancePx - 9) < 1e-9);
      assert.equal(
        pickGeometry(model, rendered, [endpoint[0], endpoint[1] + 11 / pxPerMm], pxPerMm, 'point'),
        undefined,
      );
      const middle = sheet([50, 0], rendered.viewTransforms.front);
      assert.equal(
        pickGeometry(model, rendered, [middle[0], middle[1] + 6 / pxPerMm], pxPerMm, 'line')?.edge
          ?.id,
        'edge',
      );
      assert.equal(
        pickGeometry(model, rendered, [middle[0], middle[1] + 8 / pxPerMm], pxPerMm, 'line'),
        undefined,
      );
    }
});

test('linear picking snaps near endpoints and uses a full edge near its middle', () => {
  const model = part([view('front', [line('edge', [0, 0], [100, 0])])]);
  const rendered = drawing();
  assert.deepEqual(pickGeometry(model, rendered, [21, 49], 4, 'point')?.anchor?.point, [0, 0]);
  const middle = pickGeometry(model, rendered, [70, 49], 4, 'point');
  assert.equal(middle?.edge?.id, 'edge');
  assert.equal(middle?.anchor, undefined);
  assert.equal(pickGeometry(model, rendered, [70, 49], 4, 'circle'), undefined);
});

test('curve picking follows every polyline segment instead of a start-to-end chord', () => {
  const curve: ProjectedEdge = {
    id: 'profile',
    kind: 'curve',
    hidden: false,
    points: [
      [0, 0],
      [10, 10],
      [20, 0],
    ],
  };
  const model = part([view('front', [curve])]);
  assert.equal(pickGeometry(model, drawing(), [30, 40.5], 4, 'edge')?.edge?.id, 'profile');
  assert.equal(pickGeometry(model, drawing(), [30, 50], 4, 'edge'), undefined);
});

test('circle centers snap without treating a full circle seam as a corner', () => {
  const circle: ProjectedEdge = {
    id: 'bore',
    kind: 'circle',
    hidden: false,
    closed: true,
    center: [10, 10],
    radius: 5,
    points: [
      [15, 10],
      [10, 15],
      [5, 10],
      [10, 5],
      [15, 10],
    ],
  };
  const model = part([
    view('front', [circle], [{ id: 'seam', point: [15, 10], source: [15, 0, 10] }]),
  ]);
  const center = pickGeometry(model, drawing(), [30.5, 40], 4, 'point');
  assert.deepEqual(center?.anchor?.point, [10, 10]);
  const rim = pickGeometry(model, drawing(), [35, 40], 4, 'point');
  assert.equal(rim?.anchor, undefined);
  assert.equal(rim?.edge?.id, 'bore');
  assert.equal(pickGeometry(model, drawing(), [35, 40], 4, 'circle')?.edge?.id, 'bore');
  assert.equal(pickGeometry(model, drawing(), [35, 40], 4, 'line'), undefined);
});

test('visible geometry wins and hidden geometry is selectable only when enabled', () => {
  const model = part([
    view('front', [line('hidden', [0, 0], [100, 0], true), line('visible', [0, 0.5], [100, 0.5])]),
  ]);
  assert.equal(
    pickGeometry(model, drawing(), [70, 50], 4, 'line', 'front', { includeHidden: true })?.edge?.id,
    'visible',
  );
  const hiddenOnly = part([view('front', [line('hidden', [0, 0], [100, 0], true)])]);
  assert.equal(pickGeometry(hiddenOnly, drawing(), [70, 50], 4, 'line'), undefined);
  assert.equal(
    pickGeometry(hiddenOnly, drawing(), [70, 50], 4, 'line', undefined, { includeHidden: true })
      ?.edge?.id,
    'hidden',
  );
  const hiddenEndpoint = part([
    view('front', [
      line('hidden-endpoint', [50, 0], [60, 0], true),
      line('visible-middle', [0, 0.5], [100, 0.5]),
    ]),
  ]);
  const selected = pickGeometry(hiddenEndpoint, drawing(), [70, 50], 4, 'point', 'front', {
    includeHidden: true,
  });
  assert.equal(selected?.edge?.id, 'visible-middle');
  assert.equal(selected?.anchor, undefined);
});

test('source coordinates stay exact while coincident depths are explicitly ambiguous', () => {
  const precise: Point2 = [12.345678901, 3.456789012];
  const edge = line('edge', precise, [100, precise[1]]);
  edge.sourcePoints = [
    [precise[0], 0, precise[1]],
    [100, 0, precise[1]],
  ];
  const anchors: Projection['anchors'] = [
    { id: 'front-vertex', point: precise, source: [precise[0], 0, precise[1]] },
  ];
  const model = part([view('front', [edge], anchors)]);
  const rendered = drawing(),
    pointer = sheet(precise, rendered.viewTransforms.front);
  const unique = pickGeometry(model, rendered, pointer, 4, 'point');
  assert.deepEqual(unique?.anchor?.point, precise);
  assert.deepEqual(unique?.anchor?.source, [precise[0], 0, precise[1]]);
  anchors.push({ id: 'rear-vertex', point: precise, source: [precise[0], 5, precise[1]] });
  const ambiguous = pickGeometry(model, rendered, pointer, 4, 'point');
  assert.equal(ambiguous?.anchor?.ambiguousSource, true);
  assert.equal(ambiguous?.anchor?.source, undefined);
});

test('source circle centers retain the same ambiguity guard as source vertices', () => {
  const circle: ProjectedEdge = {
    id: 'bore',
    kind: 'circle',
    hidden: false,
    closed: true,
    center: [10, 10],
    radius: 5,
    points: [
      [15, 10],
      [10, 15],
      [5, 10],
      [10, 5],
      [15, 10],
    ],
  };
  const model = part([view('front', [circle])]);
  model.features = {
    circles: [{ id: 'near', center: [10, 0, 10], normal: [0, 1, 0], radius: 5, closed: true }],
  };
  assert.deepEqual(
    pickGeometry(model, drawing(), [30, 40], 4, 'point')?.anchor?.source,
    [10, 0, 10],
  );
  model.features.circles.push({
    id: 'far',
    center: [10, 5, 10],
    normal: [0, 1, 0],
    radius: 5,
    closed: true,
  });
  assert.equal(pickGeometry(model, drawing(), [30, 40], 4, 'point')?.anchor?.ambiguousSource, true);
});

test('view filters are deterministic, isometric views and invalid transforms are excluded', () => {
  const model = part([
    view('front', [line('z', [0, 0], [100, 0]), line('a', [0, 0], [100, 0])]),
    view('top', [line('top', [0, 0], [100, 0])]),
    view('iso', [line('iso', [0, 0], [100, 0])]),
  ]);
  const rendered = drawing();
  rendered.viewTransforms.top = rendered.viewTransforms.front;
  rendered.viewTransforms.iso = rendered.viewTransforms.front;
  assert.equal(pickGeometry(model, rendered, [70, 50], 4, 'line')?.edge?.id, 'a');
  assert.equal(pickGeometry(model, rendered, [70, 50], 4, 'line', 'top')?.edge?.id, 'top');
  assert.equal(pickGeometry(model, rendered, [70, 50], 4, 'line', 'iso'), undefined);
  assert.equal(pickGeometry(model, rendered, [70, 50], 0, 'line'), undefined);
  rendered.viewTransforms.front = { x: 0, y: 0, scale: NaN };
  assert.equal(pickGeometry(model, rendered, [70, 50], 4, 'line', 'front'), undefined);
});

test('radius attachment follows clicks on opposite sides of a full circle at its exact radius', () => {
  const circle: ProjectedEdge = {
    id: 'circle',
    kind: 'circle',
    hidden: false,
    closed: true,
    center: [10, 10],
    radius: 5,
    points: [
      [10, 15],
      [5, 10],
      [10, 5],
      [15, 10],
      [10, 15],
    ],
  };
  assert.deepEqual(nearestPointOnEdge(circle, [30, 10]), [15, 10]);
  assert.deepEqual(nearestPointOnEdge(circle, [-10, 10]), [5, 10]);
  const diagonal = nearestPointOnEdge(circle, [20, 20]);
  assert.ok(Math.abs(Math.hypot(diagonal[0] - 10, diagonal[1] - 10) - 5) < 1e-12);
  assert.ok(diagonal[0] > 10 && diagonal[1] > 10);
  assert.deepEqual(
    nearestPointOnEdge(circle, [10, 10]),
    [10, 15],
    'A center click uses an actual rim point instead of the center',
  );
  assert.deepEqual(circle.points[0], [10, 15]);
});

test('partial circle attachment clamps to the existing arc and preserves its analytic radius', () => {
  const midpoint = 5 / Math.sqrt(2);
  const arc: ProjectedEdge = {
    id: 'arc',
    kind: 'circle',
    hidden: false,
    closed: false,
    center: [0, 0],
    radius: 5,
    points: [
      [5, 0],
      [midpoint, midpoint],
      [0, 5],
    ],
  };
  assert.deepEqual(nearestPointOnEdge(arc, [-10, 0]), [0, 5]);
  assert.deepEqual(nearestPointOnEdge(arc, [0, -10]), [5, 0]);
  const attached = nearestPointOnEdge(arc, [4, 3]);
  assert.ok(attached[0] >= 0 && attached[1] >= 0);
  assert.ok(Math.abs(Math.hypot(...attached) - 5) < 1e-12);
});

test('noncircular attachments clamp to the nearest segment and reject invalid geometry', () => {
  const edge = line('edge', [0, 0], [10, 0]);
  assert.deepEqual(nearestPointOnEdge(edge, [4, 3]), [4, 0]);
  assert.deepEqual(nearestPointOnEdge(edge, [-4, 3]), [0, 0]);
  const polyline: ProjectedEdge = {
    id: 'profile',
    kind: 'curve',
    hidden: false,
    points: [
      [0, 0],
      [10, 10],
      [20, 0],
    ],
  };
  assert.deepEqual(nearestPointOnEdge(polyline, [10, 4]), [7, 7]);
  assert.throws(() => nearestPointOnEdge(edge, [NaN, 0]), RangeError);
  assert.throws(() => nearestPointOnEdge({ ...edge, points: [] }, [0, 0]), RangeError);
});
