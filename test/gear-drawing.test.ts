import assert from 'node:assert/strict';
import test from 'node:test';
import type { GearSpecification, Part, Point2, Projection } from '../src/model';
import { autoDimensions, autoDimensionWarnings } from '../src/drawing/dimensions';
import {
  measuredGearDimensions,
  projectGearPoint,
  gearReferenceCircles,
} from '../src/drawing/gear-dimensions';
import { gearTableLayout, renderGearTable } from '../src/drawing/gear-table';
import { initializeDrawing } from '../src/drawing/layout';
import { drawingLayoutFits, drawingPage, projectionMetrics } from '../src/drawing/page-layout';
import { renderDrawing } from '../src/drawing/render';
import { formatDimensionLabel } from '../src/drawing/dimension-label';
import { dimensionGeometry } from '../src/drawing/dimension-geometry';
import { defaultSettings } from '../src/state';

/** Synthetic public geometry: no coordinates or source names from a private model are retained. */
function gearPart(): Part {
  const views: Projection[] = (['front', 'top', 'right', 'iso'] as const).map((id) => {
    const bounds =
      id === 'front' || id === 'top'
        ? { minX: -6, minY: -37, maxX: 14, maxY: 37 }
        : { minX: -37, minY: -37, maxX: 37, maxY: 37 };
    const points: Point2[] = Array.from({ length: 141 }, (_, index) => {
      const angle = (index * Math.PI) / 70,
        radius = index % 2 ? 32.5 : 37;
      return [Math.cos(angle) * radius, Math.sin(angle) * radius];
    });
    return {
      id,
      name: id,
      bounds,
      edges: [{ id: `${id}-tooth-contour`, kind: 'curve', hidden: false, points }],
    };
  });
  return {
    id: 'synthetic-gear',
    name: 'Public synthetic gear',
    sourceName: 'synthetic.step',
    unit: 'mm',
    path: ['Gear'],
    bounds: { min: [-6, -37, -37], max: [14, 37, 37] },
    views,
    warnings: [],
    features: {
      circles: [-6, 14].map((x) => ({
        id: `bore-${x}`,
        center: [x, 0, 0],
        normal: [1, 0, 0],
        radius: 4,
        closed: true,
      })),
      gear: {
        axis: { origin: [7, 0, 0], direction: [1, 0, 0] },
        toothCount: 35,
        outsideDiameter: 74,
        rootDiameter: 65,
        faceWidth: 14,
        overallLength: 20,
        boreDiameter: 8,
        hubDiameter: 20,
        profile: 'unverified',
        evidence: 'repeated-tip-root-arcs',
        pinHoles: [
          {
            diameter: 3,
            axis: {
              origin: [-3, 0, 0],
              direction: [0, -Math.sin(Math.PI / 12), Math.cos(Math.PI / 12)],
            },
          },
        ],
      },
    },
  };
}
const specification: GearSpecification = {
  type: 'external-spur',
  teeth: 35,
  normalModule: 2,
  normalPressureAngle: 20,
  profileShift: 0,
  profileReference: 'Engineer-specified rack',
  accuracy: 'Engineer-specified accuracy and standard',
  inspection: 'Span W and its tolerance entered by the engineer',
  toothSurfaceFinish: 'Engineer-specified flank finish',
  toothEdge: 'Engineer-specified edge treatment',
};

test('gear suggestions use measured stock and pin geometry while suppressing individual tooth coordinates', () => {
  const part = gearPart(),
    dimensions = autoDimensions(part);
  assert.deepEqual(
    dimensions.map((d) => d.value),
    [74, 65, 8, 20, 20, 14, 6, 3, 3],
  );
  assert.deepEqual(autoDimensions(part, 'full'), dimensions);
  assert.deepEqual(autoDimensionWarnings(part, dimensions), []);
  for (const dimension of dimensions) {
    const expected =
      dimension.kind === 'diameter'
        ? 2 * Math.hypot(dimension.a[0] - dimension.b[0], dimension.a[1] - dimension.b[1])
        : Math.abs(
            dimension.b[dimension.kind === 'horizontal' ? 0 : 1] -
              dimension.a[dimension.kind === 'horizontal' ? 0 : 1],
          );
    assert.ok(Math.abs(expected - dimension.value) < 1e-9);
    assert.equal(dimension.tolerance, undefined);
  }
  const pin = dimensions.find((d) => d.id.endsWith('pin-0-diameter'))!;
  assert.equal(pin.prefix, 'Ø');
  assert.equal(pin.viewId, 'top');
  assert.equal(pin.kind, 'horizontal');
  assert.ok(pin.a[1] > 0, 'the tilted radial hole is projected at its visible outer hub mouth');
});

test('unapproved gear names never supply module, pressure angle, shift or a pitch circle', () => {
  const part = gearPart();
  part.name = '35-tooth module 2 gear';
  const page = drawingPage(defaultSettings, part),
    table = page.gearTable!;
  assert.equal(table.rows[0].label.join(' '), 'BASIC GEAR DATA — DRAFT');
  assert.equal(
    drawingPage({ ...defaultSettings, template: 'eskd-uk' }, part).gearTable!.rows[0].label.join(
      ' ',
    ),
    'ОСНОВНІ ДАНІ — ЧЕРНЕТКА',
  );
  for (const key of ['module', 'pressure-angle', 'profile-shift', 'reference-diameter'])
    assert.deepEqual(table.rows.find((row) => row.key === key)?.value, ['Specify']);
  assert.equal(
    gearReferenceCircles(part, 'right').some((circle) => circle.kind === 'pitch'),
    false,
  );
  assert.ok(
    table.warnings.some((warning) => warning.startsWith('Gear manufacturing data is incomplete')),
  );
  assert.deepEqual(
    table.rows.filter((row) => row.section).map((row) => row.key),
    ['basic', 'inspection', 'reference'],
  );
});

test('a confirmed specification supplies reference geometry without replacing the STEP contours', () => {
  const part = gearPart();
  part.gearSpecification = specification;
  assert.equal(
    drawingPage(defaultSettings, part).gearTable!.rows[0].label.join(' '),
    'BASIC GEAR DATA',
  );
  const source = structuredClone(part);
  const result = initializeDrawing(part, autoDimensions(part), defaultSettings, { arrange: true });
  const rendered = renderDrawing(
    part,
    result.dimensions,
    defaultSettings,
    undefined,
    result.layout,
  );
  assert.deepEqual(part, source);
  assert.equal((rendered.svg.match(/data-projection=/g) ?? []).length, 4);
  for (const view of source.views)
    assert.ok(rendered.svg.includes(`data-edge-id="${view.id}-tooth-contour"`));
  const pitch = gearReferenceCircles(part, 'right').find((circle) => circle.kind === 'pitch');
  assert.equal(pitch?.radius, 35);
  assert.ok(rendered.svg.includes('data-gear-reference="pitch"'));
  assert.ok(!rendered.warnings.some((warning) => warning.startsWith('Dimensions exceed')));
  assert.ok(
    !rendered.warnings.some((warning) =>
      warning.startsWith('Gear manufacturing data is incomplete'),
    ),
  );
  assert.equal(drawingLayoutFits(part, result.dimensions, defaultSettings, result.layout), true);
});

test('gear table and notes reserve separate physical regions and frozen drawing positions are never moved', () => {
  const part = gearPart(),
    page = drawingPage(defaultSettings, part),
    table = page.gearTable!;
  assert.equal(table.bounds.maxX - table.bounds.minX, 110);
  assert.equal(page.content.maxX + 8, table.bounds.minX);
  assert.ok(table.bounds.maxY < page.notes.contentBottom);
  const result = initializeDrawing(part, autoDimensions(part), defaultSettings, { arrange: true });
  const moved = structuredClone(result.layout);
  moved.viewTransforms.front.x = table.bounds.minX + 30;
  const rendered = renderDrawing(part, result.dimensions, defaultSettings, undefined, moved);
  assert.deepEqual(rendered.viewTransforms, moved.viewTransforms);
  assert.ok(rendered.warnings.some((warning) => warning.startsWith('Dimensions exceed')));
});

test('tooth-count conflicts remain printed and suppress calculated pitch references', () => {
  const part = gearPart();
  part.gearSpecification = { ...specification, teeth: 36 };
  const table = drawingPage(defaultSettings, part).gearTable!;
  assert.equal(table.rows[0].label.join(' '), 'BASIC GEAR DATA — DRAFT');
  assert.deepEqual(table.rows.find((row) => row.key === 'teeth')?.value, ['36']);
  assert.deepEqual(table.rows.find((row) => row.key === 'measured-teeth')?.value, ['35']);
  assert.deepEqual(table.rows.find((row) => row.key === 'reference-diameter')?.value, ['Specify']);
  assert.ok(table.warnings.some((warning) => warning.startsWith('Gear tooth count conflicts')));
  assert.equal(
    gearReferenceCircles(part, 'right').some((circle) => circle.kind === 'pitch'),
    false,
  );
});

test('table wrapping discloses overflow, escapes text and localizes all drawing captions', () => {
  const part = gearPart();
  part.gearSpecification = { ...specification, inspection: '<script> & '.repeat(100) };
  const settings = {
    ...defaultSettings,
    format: 'A4' as const,
    orientation: 'portrait' as const,
    template: 'eskd-uk' as const,
  };
  const table = drawingPage(settings, part).gearTable!,
    markup = renderGearTable(table);
  assert.ok(table.warnings.some((warning) => warning.startsWith('Gear parameter table exceeds')));
  assert.ok(markup.includes('КОНТРОЛЬНІ ДАНІ'));
  assert.ok(markup.includes('ДОВІДКОВІ ДАНІ'));
  assert.ok(markup.includes('&lt;script&gt;'));
  assert.ok(!markup.includes('<script>'));
  assert.ok(!markup.includes('Specify'));
  for (const row of table.rows) assert.ok(row.height >= 6);
});

test('measured references enlarge occupied bounds when tooth phase makes the silhouette narrower than the diameter', () => {
  const part = gearPart(),
    right = part.views.find((view) => view.id === 'right')!;
  right.bounds = { minX: -36, minY: -36, maxX: 36, maxY: 36 };
  const metrics = projectionMetrics(right, [], 1, { ...defaultSettings, centerLines: false }, part);
  assert.ok(metrics.occupied.minX < -37);
  assert.ok(metrics.occupied.maxX > 37);
  assert.deepEqual(projectGearPoint([1, 24, 3], 'right'), [-24, 3]);
});

test('tilted detected gear axes never produce foreshortened diameter suggestions', () => {
  const part = gearPart();
  part.features!.gear!.axis.direction = [Math.SQRT1_2, Math.SQRT1_2, 0];
  assert.deepEqual(measuredGearDimensions(part), []);
  assert.deepEqual(gearReferenceCircles(part, 'right'), []);
  assert.ok(autoDimensionWarnings(part).some((warning) => warning.includes('not aligned')));
});

test('manual gear data enables a table without inventing observed geometry', () => {
  const part = gearPart();
  delete part.features;
  part.gearSpecification = specification;
  const table = gearTableLayout(part, defaultSettings, {
    minX: 20,
    minY: 25,
    maxX: 414,
    maxY: 224,
  })!;
  assert.equal(
    table.rows.some((row) => row.key === 'outside-diameter'),
    false,
  );
  assert.deepEqual(gearReferenceCircles(part, 'right'), []);
});

test('a measured tooth datum locates the radial pin axis and its true angle without inventing a tolerance', () => {
  const part = gearPart();
  part.features!.gear!.toothDatumDirection = [0, 1, 0];
  const source = structuredClone(part),
    dimensions = autoDimensions(part);
  const angle = dimensions.find((dimension) => dimension.id.endsWith('pin-0-angle'))!;
  assert.equal(angle.kind, 'angle');
  assert.ok(Math.abs(angle.value - 105) < 1e-10);
  assert.equal(Math.hypot(...angle.vertex!), 0);
  assert.equal(angle.tolerance, undefined);
  const result = initializeDrawing(part, dimensions, defaultSettings, { arrange: true });
  assert.equal(
    result.dimensions.find((d) => d.id === angle.id)?.offset,
    37 * result.layout.scale + 8,
  );
  const rendered = renderDrawing(
    part,
    result.dimensions,
    defaultSettings,
    undefined,
    result.layout,
  );
  assert.ok(rendered.svg.includes('data-gear-datum="A"'));
  assert.ok(rendered.svg.includes('data-gear-datum-label="A"'));
  assert.ok(rendered.svg.includes('data-gear-row="tooth-datum"'));
  assert.deepEqual(
    drawingPage(defaultSettings, part)
      .gearTable!.rows.find((row) => row.key === 'tooth-datum')!
      .value.join(' '),
    'Selected tooth-tip center',
  );
  assert.ok(
    !rendered.warnings.some((warning) => warning.startsWith('Radial pin-hole orientation needs')),
  );
  assert.deepEqual(part, source);
});

test('automatic gear fitting preserves a readable tooth diameter and reports sheets that cannot fit it', () => {
  const part = gearPart(),
    settings = { ...defaultSettings, format: 'A4' as const, orientation: 'portrait' as const };
  const initialized = initializeDrawing(part, autoDimensions(part), settings, { arrange: true });
  assert.ok(initialized.layout.scale * part.features!.gear!.outsideDiameter >= 10);
  const rendered = renderDrawing(
    part,
    initialized.dimensions,
    settings,
    undefined,
    initialized.layout,
  );
  assert.ok(rendered.warnings.some((warning) => warning.startsWith('Dimensions exceed')));
  const explicit = initializeDrawing(part, [], { ...settings, scale: 0.01 }, { arrange: false });
  assert.equal(explicit.layout.scale, 0.01, 'an explicit physical scale is never silently changed');
});

test('a measured fractional bore retains its source nominal precision in shared labels and vector SVG', () => {
  const part = gearPart();
  part.features!.gear!.boreDiameter = 3.175;
  part.features!.gear!.outsideDiameter = 74.00000008;
  const dimensions = autoDimensions(part),
    bore = dimensions.find((d) => d.id.endsWith('gear-bore'))!;
  const outside = dimensions.find((d) => d.id.endsWith('gear-outside'))!;
  assert.equal(bore.minimumPrecision, 3);
  assert.equal(outside.minimumPrecision, 0);
  assert.equal(formatDimensionLabel(bore, 2).plainText, 'Ø3.175');
  assert.equal(formatDimensionLabel(outside, 2).plainText, 'Ø74');
  const result = initializeDrawing(
    part,
    dimensions,
    { ...defaultSettings, precision: 2 },
    { arrange: true },
  );
  const rendered = renderDrawing(
    part,
    result.dimensions,
    { ...defaultSettings, precision: 2 },
    undefined,
    result.layout,
  );
  assert.match(rendered.svg, />Ø3\.175<\/text>/);
  assert.equal(part.features!.gear!.boreDiameter, 3.175);
});

test('gear view captions stay above the complete angular callout envelope', () => {
  const part = gearPart();
  part.features!.gear!.toothDatumDirection = [0, 1, 0];
  const dimensions = autoDimensions(part),
    view = part.views.find((v) => v.id === 'right')!;
  const metrics = projectionMetrics(view, dimensions, 2, defaultSettings, part);
  for (const dimension of dimensions.filter((d) => d.viewId === view.id)) {
    const geometry = dimensionGeometry(dimension, { x: 0, y: 0, scale: 2 }, 2);
    assert.ok(
      metrics.caption.origin[1] + 0.8 < geometry.bounds.minY - 2,
      'Neither dimension rays nor labels should cross the view caption',
    );
  }
});
