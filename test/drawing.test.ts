import test from 'node:test';
import assert from 'node:assert/strict';
import type { Dimension, DrawingSettings, Part, Point2, Projection } from '../src/model';
import {
  autoDimensions,
  autoDimensionWarnings,
  arrangeDimensions,
  formatDimension,
} from '../src/drawing/dimensions';
import { paperSize, renderDimension, renderDrawing } from '../src/drawing/render';
import { defaultSettings } from '../src/state';

function rectangle(id: Projection['id'], width: number, height: number): Projection {
  const points: Point2[] = [
    [0, 0],
    [width, 0],
    [width, height],
    [0, height],
  ];
  return {
    id,
    name: id,
    bounds: { minX: 0, minY: 0, maxX: width, maxY: height },
    edges: points.map((p, index) => ({
      id: `${id}-${index}`,
      points: [p, points[(index + 1) % 4]],
      kind: 'line',
      hidden: false,
    })),
  };
}

const part: Part = {
  id: 'plate',
  name: 'Plate <script>',
  sourceName: 'example.step',
  path: ['Assembly', 'Plate'],
  unit: 'mm',
  bounds: { min: [0, 0, 0], max: [80.125, 50.25, 12.5] },
  warnings: [],
  views: [
    rectangle('front', 80.125, 12.5),
    rectangle('top', 80.125, 50.25),
    rectangle('right', 50.25, 12.5),
    rectangle('iso', 95, 65),
  ],
};
const settings: DrawingSettings = {
  ...defaultSettings,
  format: 'A3',
  orientation: 'landscape',
  template: 'eskd',
  scale: 'auto',
  precision: 3,
  hiddenLines: true,
  centerLines: true,
  title: '',
  number: 'TD-001',
  material: 'Aluminium',
  author: 'Engineer',
  revision: 'A',
  tolerance: 'ISO 2768-m',
  notes: 'Deburr all edges.',
};

test('overall dimensions preserve exact model values independently of sheet scale', () => {
  const dimensions = autoDimensions(part);
  assert.deepEqual(
    dimensions.map((d) => d.value),
    [80.125, 12.5, 50.25],
  );
  const small = renderDrawing(part, dimensions, { ...settings, format: 'A4' });
  const large = renderDrawing(part, dimensions, { ...settings, format: 'A1' });
  assert.ok(large.scale >= small.scale);
  assert.match(small.svg, />80\.125</);
  assert.match(large.svg, />80\.125</);
});

test('deduplicating baseline coordinates does not round the model-space measurement', () => {
  const model = structuredClone(part),
    coordinate = 12.345678901;
  model.views[0].edges.push({
    id: 'precise-step',
    kind: 'line',
    hidden: false,
    points: [
      [coordinate, 0],
      [coordinate, 3],
    ],
  });
  const dimension = autoDimensions(model).find((d) => d.kind === 'horizontal' && d.value < 80);
  assert.equal(dimension?.value, coordinate);
});

test('circle diameters use exact radii, count distinct features, and ignore arcs and hidden duplicate edges', () => {
  const model = structuredClone(part);
  model.views[1].edges.push(
    {
      id: 'c1',
      kind: 'circle',
      closed: true,
      points: [
        [15, 10],
        [5, 10],
      ],
      center: [10, 10],
      radius: 5.125,
      hidden: false,
    },
    {
      id: 'c2',
      kind: 'circle',
      closed: true,
      points: [
        [35, 10],
        [25, 10],
      ],
      center: [30, 10],
      radius: 5.125,
      hidden: false,
    },
    {
      id: 'c1-hidden',
      kind: 'circle',
      closed: true,
      points: [
        [15, 10],
        [5, 10],
      ],
      center: [10, 10],
      radius: 5.125,
      hidden: true,
    },
    {
      id: 'arc',
      kind: 'circle',
      closed: false,
      points: [
        [60, 10],
        [50, 20],
      ],
      center: [50, 10],
      radius: 10,
      hidden: false,
    },
  );
  const dimensions = autoDimensions(model);
  const diameters = dimensions.filter((d) => d.kind === 'diameter');
  assert.equal(diameters.length, 1);
  assert.equal(diameters[0].value, 10.25);
  assert.equal(formatDimension(diameters[0], 3), 'Ø10.25 (2x)');
  assert.ok(dimensions.some((d) => d.kind === 'horizontal' && d.value === 30));
});

test('all ISO paper sizes and orientations are exact and preserve four views', () => {
  for (const [format, short, long] of [
    ['A4', 210, 297],
    ['A3', 297, 420],
    ['A2', 420, 594],
    ['A1', 594, 841],
  ] as const) {
    for (const orientation of ['portrait', 'landscape'] as const) {
      const options = { ...settings, format, orientation, template: 'iso' as const };
      const rendered = renderDrawing(part, autoDimensions(part), options);
      assert.deepEqual(
        paperSize(options),
        orientation === 'portrait' ? [short, long] : [long, short],
      );
      assert.equal(Object.keys(rendered.viewTransforms).length, 4);
      assert.ok(rendered.scale > 0);
      assert.doesNotMatch(rendered.svg, /NaN|Infinity/);
      for (const view of part.views) {
        const transform = rendered.viewTransforms[view.id];
        for (const edge of view.edges)
          for (const point of edge.points) {
            const x = transform.x + point[0] * transform.scale;
            const y = transform.y - point[1] * transform.scale;
            assert.ok(
              x >= 11 && x <= rendered.width - 6,
              `${format} ${orientation}: x geometry out of frame`,
            );
            assert.ok(
              y >= 6 && y <= rendered.height - 75,
              `${format} ${orientation}: y geometry out of drawing area`,
            );
          }
      }
      assert.match(rendered.svg, /Plate &lt;script&gt;/);
      assert.doesNotMatch(rendered.svg, /<script>/);
    }
  }
});

test('first angle arrangement aligns front and top and puts right view to the left', () => {
  const rendered = renderDrawing(part, autoDimensions(part), settings);
  const { front, top, right } = rendered.viewTransforms;
  assert.equal(front.x, top.x);
  assert.ok(top.y > front.y);
  assert.ok(right.x < front.x);
  const frontMidY = front.y - 6.25 * front.scale;
  const rightMidY = right.y - 6.25 * right.scale;
  assert.equal(frontMidY, rightMidY);
});

test('dense balanced suggestions expose missing coordinates and full detail clears warning', () => {
  const model = structuredClone(part);
  for (let i = 1; i <= 10; i++)
    model.views[0].edges.push({
      id: `step-${i}`,
      kind: 'line',
      hidden: false,
      points: [
        [i * 5, 0],
        [i * 5, 4],
      ],
    });
  const balanced = autoDimensions(model);
  const full = autoDimensions(model, 'full');
  assert.ok(autoDimensionWarnings(model, balanced).length > 0);
  assert.deepEqual(autoDimensionWarnings(model, full), []);
  assert.ok(full.length > balanced.length);
});

test('an oversized explicit scale is detected before PDF export', () => {
  const rendered = renderDrawing(part, autoDimensions(part), { ...settings, scale: 20 });
  assert.ok(rendered.warnings.some((w) => w.includes('selected scale exceeds')));
});

const linear = (id: string, from: number, to: number, offset = 10): Dimension => ({
  id,
  viewId: 'front',
  kind: 'horizontal',
  a: [from, 0],
  b: [to, 0],
  value: Math.abs(to - from),
  offset,
  automatic: false,
});

test('contained 12 mm dimensions sit inside 24 mm and overall dimensions regardless of input order', () => {
  const input = [linear('overall', 0, 50), linear('outer', 0, 24), linear('inner', 0, 12)];
  const arranged = arrangeDimensions(input);
  assert.equal(arranged.find((d) => d.id === 'inner')!.offset, 9);
  assert.equal(arranged.find((d) => d.id === 'outer')!.offset, 15);
  assert.equal(arranged.find((d) => d.id === 'overall')!.offset, 21);
  assert.deepEqual(
    input.map((d) => d.offset),
    [10, 10, 10],
    'arrangement must not mutate undo snapshots',
  );
});

test('disjoint spans share a lane while duplicate and partially overlapping spans stay distinct and ordered', () => {
  const arranged = arrangeDimensions([
    linear('a', 0, 10),
    linear('b', 40, 50),
    linear('duplicate', 0, 10),
    linear('overlap', 5, 30),
  ]);
  const offset = (id: string) => arranged.find((d) => d.id === id)!.offset;
  assert.equal(offset('a'), offset('b'));
  assert.notEqual(offset('duplicate'), offset('a'));
  assert.ok(offset('overlap') > Math.max(offset('a'), offset('duplicate')));
});

test('opposite sides and different projections retain independent ordered lanes', () => {
  const vertical = {
    ...linear('vertical', 0, 24),
    kind: 'vertical' as const,
    a: [0, 0] as Point2,
    b: [0, 24] as Point2,
  };
  const otherView = { ...linear('top', 0, 24), viewId: 'top' as const };
  const arranged = arrangeDimensions([
    linear('positive', 0, 24),
    linear('negative-small', 0, 12, -50),
    linear('negative-large', 0, 24, -10),
    vertical,
    otherView,
  ]);
  assert.equal(arranged.find((d) => d.id === 'positive')!.offset, 9);
  assert.equal(arranged.find((d) => d.id === 'negative-small')!.offset, -9);
  assert.equal(arranged.find((d) => d.id === 'negative-large')!.offset, -15);
  assert.equal(arranged.find((d) => d.id === 'vertical')!.offset, 9);
  assert.equal(arranged.find((d) => d.id === 'top')!.offset, 9);
});

test('circle label collisions move their connected leaders and layout can be held fixed during a drag', () => {
  const circles: Dimension[] = [
    {
      id: 'diameter-1',
      viewId: 'top',
      kind: 'diameter',
      a: [30, 20],
      b: [35, 20],
      value: 10,
      offset: 10,
      automatic: false,
    },
    {
      id: 'diameter-2',
      viewId: 'top',
      kind: 'diameter',
      a: [35, 20],
      b: [40, 20],
      value: 10,
      offset: 10,
      automatic: false,
    },
  ];
  const arranged = arrangeDimensions(circles);
  assert.ok(arranged.some((d) => (d.textOffset?.[1] ?? 0) <= -6));
  const original = renderDrawing(part, circles, settings);
  const moved = structuredClone(circles);
  moved[0].textOffset = [10, -10];
  const preview = renderDrawing(part, moved, settings, 'diameter-1', original);
  assert.deepEqual(preview.viewTransforms, original.viewTransforms);
  assert.equal(preview.scale, original.scale);
  const originalGroup = original.svg.match(
    /<g class="dimension[^>]*data-dimension-id="diameter-1"[^>]*>(.*?)<\/g>/,
  )![1];
  const previewGroup = preview.svg.match(
    /<g class="dimension[^>]*data-dimension-id="diameter-1"[^>]*>(.*?)<\/g>/,
  )![1];
  assert.notEqual(
    originalGroup.match(/<line[^>]*>/)?.[0],
    previewGroup.match(/<line[^>]*>/)?.[0],
    'leader segment must move with its text',
  );
});

test('dimensions from different datums still use absolute ordered exterior lanes', () => {
  const vertical = (id: string, x: number, length: number): Dimension => ({
    ...linear(id, 0, length),
    kind: 'vertical',
    a: [x, 0],
    b: [x, length],
  });
  const arranged = arrangeDimensions([vertical('12', 0, 12), vertical('24', 10, 24)]);
  const inner = arranged.find((d) => d.id === '12')!,
    outer = arranged.find((d) => d.id === '24')!;
  assert.equal(inner.a[0] - inner.offset, -9);
  assert.equal(outer.a[0] - outer.offset, -15);
  const singleRightEdge = arrangeDimensions([vertical('right-edge', 80.125, 10)], { part });
  assert.equal(
    singleRightEdge[0].a[0] - singleRightEdge[0].offset,
    -9,
    'the lane must stay outside the true part contour',
  );
  const horizontal = arrangeDimensions([
    { ...linear('short', 0, 12), a: [0, 20], b: [12, 20] },
    { ...linear('long', 0, 24), a: [0, 10], b: [24, 10] },
  ]);
  assert.ok(
    -horizontal[1].a[1] + horizontal[1].offset > -horizontal[0].a[1] + horizontal[0].offset,
  );
});

test('title block text fits cells and preserves separate technical note lines', () => {
  const rendered = renderDrawing(part, autoDimensions(part), {
    ...settings,
    template: 'iso',
    title: 'W'.repeat(200),
    number: 'W'.repeat(200),
    material: 'W'.repeat(200),
    author: 'W'.repeat(100),
    notes: 'First technical note.\nSecond technical note.',
  });
  const titles = [...rendered.svg.matchAll(/<text[^>]*data-field="title"[^>]*>(.*?)<\/text>/g)];
  assert.equal(titles.length, 2);
  assert.ok(titles.every((match) => match[1].length < 100));
  assert.ok(rendered.warnings.some((warning) => warning.includes('Drawing title is shortened')));
  assert.ok(rendered.warnings.some((warning) => warning.includes('Drawing number is shortened')));
  const notes = [
    ...rendered.svg.matchAll(
      /<text[^>]*y="([^"]+)"[^>]*data-field="technical-note"[^>]*>(.*?)<\/text>/g,
    ),
  ];
  assert.deepEqual(
    notes.map((match) => match[2]),
    ['First technical note.', 'Second technical note.'],
  );
  assert.ok(Math.abs(Number(notes[1][1]) - Number(notes[0][1]) - 3.7) < 1e-8);
});

test('technical notes disclose omitted lines rather than silently dropping requirements', () => {
  const rendered = renderDrawing(part, autoDimensions(part), {
    ...settings,
    template: 'iso',
    notes: Array.from({ length: 12 }, (_, index) => `Requirement ${index + 1}`).join('\n'),
  });
  assert.ok(
    rendered.warnings.some((warning) => warning.includes('4 technical note lines do not fit')),
  );
  assert.match(rendered.svg, /Requirement 8\.\.\./);
});

test('baseline suggestions exclude projection-only silhouettes and diagonal thread fragments', () => {
  const model = structuredClone(part),
    front = model.views[0];
  front.edges[0].sourcePoints = [
    [0, 0, 0],
    [80.125, 0, 0],
  ];
  front.edges.push(
    {
      id: 'true-step',
      kind: 'line',
      hidden: false,
      points: [
        [12.345678901, 0],
        [12.345678901, 3],
      ],
      sourcePoints: [
        [12.345678901, 0, 0],
        [12.345678901, 0, 3],
      ],
    },
    {
      id: 'occlusion',
      kind: 'line',
      hidden: false,
      points: [
        [17.31, 0],
        [17.31, 8],
      ],
      sourcePoints: [],
    },
    {
      id: 'inclined-edge',
      kind: 'line',
      hidden: false,
      points: [
        [25, 0],
        [26, 3],
      ],
      sourcePoints: [
        [25, 0, 0],
        [26, 0, 3],
      ],
    },
  );
  const dimensions = autoDimensions(model, 'full').filter(
    (d) => d.viewId === 'front' && d.kind === 'horizontal',
  );
  assert.ok(dimensions.some((d) => d.value === 12.345678901));
  assert.ok(
    dimensions.every((d) => ![17.31, 25, 26].some((value) => Math.abs(d.value - value) < 1e-6)),
  );
});

test('coaxial shaft stations come from source circles rather than helical projection coordinates', () => {
  const model: Part = {
    id: 'shaft',
    name: 'Stepped shaft',
    sourceName: 'shaft.step',
    path: ['shaft'],
    unit: 'mm',
    warnings: [],
    bounds: { min: [0, -8, 0], max: [50, 0, 8] },
    views: [
      rectangle('front', 50, 8),
      rectangle('top', 50, 8),
      rectangle('right', 8, 8),
      rectangle('iso', 40, 25),
    ],
    features: { circles: [] },
  };
  const add = (station: number, radius: number, closed = true) =>
    model.features!.circles.push({
      id: `circle-${model.features!.circles.length}`,
      center: [station, -4, 4],
      normal: [1, 0, 0],
      radius,
      closed,
    });
  for (const station of [8, 8.85, 9.55, 16, 42, 48.45, 49.15, 50]) add(station, 2.5);
  for (const station of [8.85, 9.55, 48.45, 49.15]) add(station, 2.4);
  add(0, 2);
  add(8, 2);
  add(16, 4, false);
  add(42, 4, false);
  model.views[2].edges = [
    {
      id: 'outer-arc',
      kind: 'circle',
      hidden: false,
      closed: false,
      center: [4, 4],
      radius: 4,
      points: [
        [8, 4],
        [4, 8],
        [0, 4],
      ],
    },
    {
      id: 'end-circle',
      kind: 'circle',
      hidden: false,
      closed: true,
      center: [4, 4],
      radius: 2.5,
      points: [
        [6.5, 4],
        [4, 6.5],
        [1.5, 4],
        [4, 1.5],
        [6.5, 4],
      ],
    },
  ];
  for (let index = 0; index < 30; index++)
    model.views[0].edges.push({
      id: `thread-${index}`,
      kind: 'line',
      hidden: false,
      points: [
        [16.3 + index * 0.71, 0],
        [16.4 + index * 0.71, 8],
      ],
      sourcePoints: [],
    });
  const dimensions = autoDimensions(model);
  assert.deepEqual(
    dimensions.filter((d) => d.kind === 'diameter').map((d) => d.value),
    [4, 4.8, 5],
  );
  const axial = dimensions.filter((d) => d.viewId === 'front' && d.kind === 'horizontal');
  assert.equal(axial.length, 8);
  assert.ok(axial.some((d) => Math.abs(d.value - 0.85) < 1e-6));
  assert.ok(axial.some((d) => Math.abs(d.value - 1.55) < 1e-6));
  assert.ok(axial.some((d) => d.value === 50));
  assert.ok(
    dimensions.every((d) => !(d.viewId === 'right' && ['horizontal', 'vertical'].includes(d.kind))),
    'concentric end view does not need center-to-envelope half-dimensions',
  );
  const radius = dimensions.find((d) => d.kind === 'radius')!;
  assert.equal(radius.value, 4);
  assert.deepEqual(radius.b, [4, 8], 'radius leader anchors a real sampled arc point');
  assert.deepEqual(autoDimensionWarnings(model, dimensions), []);
});

test('short dimensions put labels and arrows outside their small measured spans', () => {
  const tiny: Dimension = { ...linear('tiny', 0, 0.7), offset: 9 };
  const rendered = renderDrawing(part, [tiny], settings);
  const group = rendered.svg.match(
    /<g class="dimension[^>]*data-dimension-id="tiny"[^>]*>(.*?)<\/g>/,
  )![1];
  const labelX = Number(group.match(/<text x="([^"]+)"/)![1]);
  const endX = rendered.viewTransforms.front.x + 0.7 * rendered.scale;
  assert.ok(labelX > endX + 4);
  assert.equal([...group.matchAll(/class="dimension-arrow"/g)].length, 2);
  assert.doesNotMatch(group, /marker-start|marker-end/);
});

test('dimension labels and arrowheads use PDF-portable filled geometry', () => {
  const dimensions: Dimension[] = [
    linear('ordinary', 0, 24),
    { ...linear('vertical', 0, 12), kind: 'vertical', a: [0, 0], b: [0, 12] },
    {
      id: 'radius',
      viewId: 'top',
      kind: 'radius',
      a: [20, 20],
      b: [25, 20],
      value: 5,
      offset: 10,
      automatic: false,
    },
    {
      id: 'angle',
      viewId: 'front',
      kind: 'angle',
      a: [10, 0],
      b: [0, 10],
      vertex: [0, 0],
      value: 90,
      offset: 14,
      automatic: false,
    },
  ];
  const rendered = renderDrawing(part, dimensions, settings);
  assert.doesNotMatch(rendered.svg, /marker-start|marker-end|<marker|paint-order|stroke="white"/);
  assert.equal([...rendered.svg.matchAll(/class="dimension-arrow"/g)].length, 7);
  assert.equal([...rendered.svg.matchAll(/class="dimension-label"/g)].length, 4);
  const labelGroups = [...rendered.svg.matchAll(/<g class="dimension-label"[^>]*>(.*?)<\/g>/g)];
  for (const group of labelGroups) {
    assert.match(group[1], /^<rect[^>]*fill="white"[^>]*stroke="none"/);
    assert.match(group[1], /<text[^>]*fill="#20262b"[^>]*stroke="none"/);
    assert.ok(group[1].indexOf('<rect') < group[1].indexOf('<text'));
  }
});

test('cached layouts allow annotation placement across view cells without moving geometry', () => {
  const originalDimensions = [linear('move', 0, 30)];
  const original = renderDrawing(part, originalDimensions, settings);
  const moved = [{ ...originalDimensions[0], offset: 90 }];
  const edited = renderDrawing(part, moved, settings, undefined, original);
  assert.equal(edited.scale, original.scale);
  assert.deepEqual(edited.viewTransforms, original.viewTransforms);
  assert.ok(
    !edited.warnings.some(
      (warning) =>
        warning.startsWith('Dimensions exceed') || warning.startsWith('The selected scale'),
    ),
    'valid placement is checked against the whole content frame, not its initial view cell',
  );
  const originalPaths = [...original.svg.matchAll(/<path[^>]*data-edge-id="[^"]+"[^>]*>/g)].map(
    (match) => match[0],
  );
  const editedPaths = [...edited.svg.matchAll(/<path[^>]*data-edge-id="[^"]+"[^>]*>/g)].map(
    (match) => match[0],
  );
  assert.deepEqual(editedPaths, originalPaths);
});

test('cached layouts report actual off-frame annotation or translated geometry without refitting', () => {
  const dimensions = [linear('move', 0, 30)];
  const original = renderDrawing(part, dimensions, settings);
  const offFrame = renderDrawing(
    part,
    [{ ...dimensions[0], offset: 500 }],
    settings,
    undefined,
    original,
  );
  assert.ok(offFrame.warnings.some((warning) => warning.startsWith('Dimensions exceed')));
  assert.equal(offFrame.scale, original.scale);
  assert.deepEqual(offFrame.viewTransforms, original.viewTransforms);
  const shifted = structuredClone(original);
  shifted.viewTransforms.front.x += 500;
  const translated = renderDrawing(part, dimensions, settings, undefined, shifted);
  assert.ok(
    translated.warnings.some((warning) => warning.startsWith('Dimensions exceed')),
    'small occupied bounds still overflow when their frozen translation moves them off-sheet',
  );
  assert.deepEqual(translated.viewTransforms, shifted.viewTransforms);
});

function extensionSegments(markup: string): number[][] {
  return [...markup.matchAll(/<line[^>]*\/>/g)]
    .map((match) => match[0])
    .filter((line) => !line.includes('data-dimension-grip'))
    .map((line) =>
      ['x1', 'y1', 'x2', 'y2'].map((key) => Number(line.match(new RegExp(`${key}="([^"]+)"`))![1])),
    );
}

test('horizontal extension gaps and overshoots face the dimension line above or below the part', () => {
  const dimension = linear('extension', 0, 30);
  const t = { x: 0, y: 50, scale: 1 };
  assert.deepEqual(extensionSegments(renderDimension(dimension, t, 2, false)), [
    [0, 51, 0, 62],
    [30, 51, 30, 62],
  ]);
  assert.deepEqual(extensionSegments(renderDimension({ ...dimension, offset: -10 }, t, 2, false)), [
    [0, 49, 0, 38],
    [30, 49, 30, 38],
  ]);
});

test('vertical extension gaps and overshoots face left or right without crossing the source anchor', () => {
  const dimension: Dimension = {
    ...linear('extension', 0, 30),
    kind: 'vertical',
    a: [0, 0],
    b: [0, 30],
  };
  const t = { x: 0, y: 50, scale: 1 };
  assert.deepEqual(extensionSegments(renderDimension(dimension, t, 2, false)), [
    [-1, 50, -12, 50],
    [-1, 20, -12, 20],
  ]);
  assert.deepEqual(extensionSegments(renderDimension({ ...dimension, offset: -10 }, t, 2, false)), [
    [1, 50, 12, 50],
    [1, 20, 12, 20],
  ]);
});

test('aligned extensions use a one-millimetre anchor gap and two-millimetre normal overshoot on both sides', () => {
  const dimension: Dimension = {
    ...linear('extension', 0, 5),
    kind: 'aligned',
    a: [0, 0],
    b: [3, 4],
  };
  const t = { x: 0, y: 50, scale: 1 };
  assert.deepEqual(extensionSegments(renderDimension(dimension, t, 2, false)), [
    [0.8, 50.6, 9.6, 57.2],
    [3.8, 46.6, 12.6, 53.2],
  ]);
  assert.deepEqual(extensionSegments(renderDimension({ ...dimension, offset: -10 }, t, 2, false)), [
    [-0.8, 49.4, -9.6, 42.8],
    [2.2, 45.4, -6.6, 38.8],
  ]);
  for (const kind of ['horizontal', 'vertical', 'aligned'] as const) {
    const near = { ...dimension, kind, offset: 0.5 };
    assert.equal(
      extensionSegments(renderDimension(near, t, 2, false)).length,
      kind === 'aligned' ? 0 : 1,
      'extensions shorter than the anchor gap are omitted per source point',
    );
  }
});
