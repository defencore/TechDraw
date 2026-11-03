import test from 'node:test';
import assert from 'node:assert/strict';
import type { Dimension, Part, Projection } from '../src/model';
import { initializeDrawing } from '../src/drawing/layout';
import { arrangeDimensions } from '../src/drawing/dimensions';
import { renderDrawing } from '../src/drawing/render';
import { defaultSettings } from '../src/state';

function samplePart(): Part {
  const views: Projection[] = (['front', 'top', 'right', 'iso'] as const).map((id) => ({
    id,
    name: id,
    bounds: { minX: 0, minY: 0, maxX: 60, maxY: 40 },
    edges: [
      {
        id: `${id}-edge`,
        kind: 'line',
        hidden: false,
        points: [
          [0, 0],
          [60, 40],
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
    bounds: { min: [0, 0, 0], max: [60, 40, 40] },
    views,
    warnings: [],
  };
}
function circleDimensions(): Dimension[] {
  return [
    {
      id: 'first',
      viewId: 'top',
      kind: 'diameter',
      a: [20, 20],
      b: [25, 20],
      value: 10,
      offset: 10,
      automatic: true,
    },
    {
      id: 'second',
      viewId: 'top',
      kind: 'diameter',
      a: [21, 30],
      b: [27, 30],
      value: 12,
      offset: 10,
      automatic: true,
    },
  ];
}
function labelPositions(svg: string): { x: number; y: number }[] {
  return [
    ...svg.matchAll(/<g class="dimension-label"[^>]*><rect[^>]*\/><text x="([^"]+)" y="([^"]+)"/g),
  ].map((match) => ({ x: Number(match[1]), y: Number(match[2]) }));
}

test('fresh automatic circle labels are separated at the final explicit 1:5 drawing scale', () => {
  const part = samplePart(),
    source = circleDimensions();
  const settings = { ...defaultSettings, scale: 0.2 };
  const before = labelPositions(renderDrawing(part, source, settings).svg);
  assert.ok(
    Math.abs(before[0].y - before[1].y) < 3,
    'the regression begins with overlapping default-scale labels',
  );
  const result = initializeDrawing(part, source, settings, { arrange: true });
  const after = labelPositions(
    renderDrawing(part, result.dimensions, settings, undefined, result.layout).svg,
  );
  assert.equal(result.layout.scale, 0.2);
  assert.ok(Math.abs(after[0].y - after[1].y) >= 6 - 1e-5);
  assert.deepEqual(
    result.dimensions,
    arrangeDimensions(source, { scale: 0.2, precision: settings.precision, part }),
  );
  assert.deepEqual(
    source,
    circleDimensions(),
    'initialization does not mutate the source annotations',
  );
});

test(
  'automatic scale initialization is stable and packs at exactly the persisted scale',
  { timeout: 1000 },
  () => {
    const part = samplePart(),
      source = circleDimensions();
    const result = initializeDrawing(part, source, defaultSettings, { arrange: true });
    const again = initializeDrawing(part, source, defaultSettings, { arrange: true });
    assert.ok(result.layout.scale > 0);
    assert.deepEqual(result, again);
    assert.deepEqual(
      result.dimensions,
      arrangeDimensions(source, {
        scale: result.layout.scale,
        precision: defaultSettings.precision,
        part,
      }),
    );
    const rendered = renderDrawing(
      part,
      result.dimensions,
      defaultSettings,
      undefined,
      result.layout,
    );
    assert.equal(rendered.scale, result.layout.scale);
    assert.deepEqual(rendered.viewTransforms, result.layout.viewTransforms);
    assert.ok(!rendered.warnings.some((warning) => warning.startsWith('Dimensions exceed')));
  },
);

test('reflow without arrangement preserves edited annotations even when they originated automatically', () => {
  const part = samplePart(),
    source = circleDimensions();
  source[0].offset = -23;
  source[0].textOffset = [15, -18];
  source[1].offset = 42;
  source[1].textOffset = [-7, 25];
  const original = structuredClone(source);
  const result = initializeDrawing(
    part,
    source,
    { ...defaultSettings, scale: 0.2 },
    { arrange: false },
  );
  assert.deepEqual(result.dimensions, original);
  assert.deepEqual(source, original);
  assert.notEqual(result.dimensions, source);
  assert.equal(result.layout.scale, 0.2);
});
