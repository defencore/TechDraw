import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import { importDxf, inspectDxfUnits } from '../src/io/dxf-import';
import { parseProject, serializeProject } from '../src/project';
import { defaultSettings } from '../src/state';

export function dxf(entities: (string | number)[], code = 4, tables: (string | number)[] = []) {
  return new TextEncoder().encode(
    [
      0,
      'SECTION',
      2,
      'HEADER',
      9,
      '$ACADVER',
      1,
      'AC1027',
      9,
      '$INSUNITS',
      70,
      code,
      0,
      'ENDSEC',
      ...(tables.length ? [0, 'SECTION', 2, 'TABLES', ...tables, 0, 'ENDSEC'] : []),
      0,
      'SECTION',
      2,
      'ENTITIES',
      ...entities,
      0,
      'ENDSEC',
      0,
      'EOF',
      '',
    ].join('\n'),
  );
}
const line = [0, 'LINE', 10, 0, 20, 0, 11, 10, 21, 5];
const near = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} should equal ${expected}`);

test('ASCII DXF imports exact lines, circles and wrapped arcs as one authoritative 2D view', () => {
  const bytes = dxf([
    ...line,
    0,
    'CIRCLE',
    10,
    20,
    20,
    10,
    40,
    3.125,
    0,
    'ARC',
    10,
    40,
    20,
    10,
    40,
    10,
    50,
    350,
    51,
    10,
  ]);
  const {
    parts: [part],
  } = importDxf(bytes, 'profile.dxf');
  assert.equal(part.sourceKind, 'dxf');
  assert.deepEqual(
    part.views.map((view) => view.id),
    ['front'],
  );
  assert.equal(part.bounds.min[1], 0);
  assert.equal(part.bounds.max[1], 0);
  const [straight, circle, arc] = part.views[0].edges;
  assert.deepEqual(straight.sourcePoints, [
    [0, 0, 0],
    [10, 0, 5],
  ]);
  assert.equal(straight.length, Math.hypot(10, 5));
  assert.equal(circle.radius, 3.125);
  assert.equal(circle.closed, true);
  assert.equal(arc.radius, 10);
  assert.equal(arc.closed, false);
  near(arc.length!, (10 * Math.PI) / 9);
  near(part.views[0].bounds.maxX, 50);
  assert.ok(part.views[0].anchors?.length);
  assert.equal(part.features?.circles.length, 2);
});

test('LWPOLYLINE bulges preserve exact semicircle radii, signed sweep and closed final straight segment', () => {
  for (const bulge of [1, -1]) {
    const bytes = dxf([0, 'LWPOLYLINE', 90, 2, 70, 1, 10, 0, 20, 0, 42, bulge, 10, 10, 20, 0]);
    const part = importDxf(bytes, 'bulge.dxf').parts[0];
    const [arc, closing] = part.views[0].edges;
    assert.equal(arc.radius, 5);
    assert.deepEqual(arc.center, [5, 0]);
    near(arc.length!, 5 * Math.PI);
    assert.deepEqual(arc.points[0], [0, 0]);
    assert.deepEqual(arc.points.at(-1), [10, 0]);
    assert.equal(closing.kind, 'line');
    assert.equal(closing.length, 10);
    near(bulge > 0 ? part.views[0].bounds.minY : part.views[0].bounds.maxY, bulge > 0 ? -5 : 5);
  }
});

test('classic 2D POLYLINE uses parent elevation and does not invent depth from vertex records', () => {
  const bytes = dxf([
    0,
    'POLYLINE',
    70,
    0,
    30,
    4,
    0,
    'VERTEX',
    10,
    0,
    20,
    0,
    30,
    0,
    42,
    1,
    0,
    'VERTEX',
    10,
    10,
    20,
    0,
    30,
    0,
    0,
    'SEQEND',
  ]);
  const part = importDxf(bytes, 'classic.dxf').parts[0];
  assert.equal(part.views[0].edges[0].radius, 5);
  assert.equal(part.bounds.min[1], part.bounds.max[1]);
  assert.ok(part.warnings.some((warning) => warning.includes('elevation 4')));
});

test('declared units convert exactly and unitless drawings have an explicit assumption or override', () => {
  const inches = dxf([0, 'LINE', 10, 0, 20, 0, 11, 2, 21, 1], 1);
  assert.deepEqual(inspectDxfUnits(inches), { insunits: 1, unit: 'in', unitless: false });
  assert.deepEqual(
    importDxf(inches, 'inch.dxf').parts[0].views[0].edges[0].points.at(-1),
    [50.8, 25.4],
  );
  const unitless = dxf(line, 0);
  assert.ok(
    importDxf(unitless, 'unknown.dxf').warnings.some((warning) =>
      warning.includes('Millimetres were assumed'),
    ),
  );
  assert.equal(
    importDxf(unitless, 'unknown.dxf', { unit: 'in' }).parts[0].views[0].bounds.maxX,
    254,
  );
  assert.throws(() => importDxf(dxf(line, 21), 'survey.dxf'), /Choose a source unit explicitly/);
});

test('source text is preserved as notes and invisible geometry is explicitly reported', () => {
  const bytes = dxf(
    [
      ...line,
      0,
      'TEXT',
      1,
      'Отвір Ø6',
      10,
      0,
      20,
      0,
      0,
      'MTEXT',
      3,
      '{\\H2x;First',
      1,
      '\\PSecond}',
      0,
      'SPLINE',
      8,
      'OFF',
    ],
    4,
    [0, 'TABLE', 2, 'LAYER', 0, 'LAYER', 2, 'OFF', 70, 0, 62, -7, 0, 'ENDTAB'],
  );
  const result = importDxf(bytes, 'notes.dxf');
  assert.deepEqual(result.parts[0].sourceNotes, ['Отвір Ø6', 'First\nSecond']);
  assert.ok(result.warnings.some((warning) => warning.includes('hidden-layer')));
});

test('unsupported essential entities, nonplanar coordinates, widths and binary DXF reject explicitly', () => {
  for (const type of ['INSERT', 'SPLINE', 'DIMENSION', 'HATCH', 'ELLIPSE'])
    assert.throws(() => importDxf(dxf([...line, 0, type]), 'bad.dxf'), new RegExp(type));
  assert.throws(() => importDxf(dxf([...line, 30, 0, 31, 2]), '3d.dxf'), /nonplanar/);
  assert.throws(() => importDxf(dxf([...line, 230, -1]), 'ocs.dxf'), /extrusion/);
  assert.throws(
    () => importDxf(dxf([0, 'LWPOLYLINE', 90, 2, 43, 2, 10, 0, 20, 0, 10, 10, 20, 0]), 'wide.dxf'),
    /wide polylines/,
  );
  assert.throws(
    () => importDxf(new TextEncoder().encode('AutoCAD Binary DXF\r\n'), 'binary.dxf'),
    /binary DXF/,
  );
});

test('2D DXF and exact dimensions survive the validated project format without fake views', () => {
  const part = importDxf(dxf(line), 'plan.dxf').parts[0];
  const state = {
    parts: [part],
    activeId: part.id,
    selected: new Set([part.id]),
    settings: { ...defaultSettings },
    annotations: {},
    description: '',
    layouts: {},
    dimensions: {
      [part.id]: [
        {
          id: 'width',
          viewId: 'front' as const,
          kind: 'horizontal' as const,
          a: [0, 0] as [number, number],
          b: [10, 0] as [number, number],
          value: 10,
          offset: 10,
          automatic: false,
        },
      ],
    },
  };
  const parsed = parseProject(serializeProject(state));
  assert.equal(parsed.parts[0].sourceKind, 'dxf');
  assert.equal(parsed.parts[0].views.length, 1);
  assert.equal(parsed.dimensions[part.id][0].value, 10);
  const invalid = JSON.parse(serializeProject(state));
  invalid.dimensions[part.id][0].viewId = 'top';
  assert.throws(() => parseProject(JSON.stringify(invalid)), /missing projection/);
});

test('the original public inspection plate has exact nominal envelope, holes and R5 bulge corners', async () => {
  const bytes = await fs.readFile(
    new URL('../public/examples/inspection-plate.dxf', import.meta.url),
  );
  const part = importDxf(bytes, 'inspection-plate.dxf').parts[0];
  near(part.views[0].bounds.maxX - part.views[0].bounds.minX, 70);
  near(part.views[0].bounds.maxY - part.views[0].bounds.minY, 40);
  assert.deepEqual(
    part.views[0].edges
      .filter((edge) => edge.closed)
      .map((edge) => edge.radius)
      .sort((a, b) => a! - b!),
    [3, 3, 8],
  );
  const corners = part.views[0].edges.filter((edge) => edge.kind === 'circle' && !edge.closed);
  assert.equal(corners.length, 4);
  for (const corner of corners) near(corner.radius!, 5);
});
