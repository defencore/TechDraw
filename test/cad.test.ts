import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { test, before } from 'node:test';
import initOpenCascade from 'replicad-opencascadejs';
import { exportSTEP, makeBaseBox, makeCylinder, setOC } from 'replicad';
import { cleanProjectedEdges, importStep } from '../src/cad/engine';
import type { ProjectedEdge } from '../src/model';
import { readStepProducts, stepPartDisplayName } from '../src/cad/step-metadata';
import { createLinearDimension } from '../src/measurements';
import { SourceRepository } from '../src/io/source-repository';
import { createProjectArchive, openProjectArchive } from '../src/io/project-archive';
import { defaultSettings } from '../src/state';

before(async () => {
  const wasm = await fs.readFile(
    new URL('../node_modules/replicad-opencascadejs/dist/replicad_single.wasm', import.meta.url),
  );
  setOC(await initOpenCascade({ wasmBinary: wasm, print: () => {}, printErr: () => {} }));
});

const near = (actual: number, expected: number, tolerance = 1e-6) =>
  assert.ok(
    Math.abs(actual - expected) < tolerance,
    `${actual} must equal ${expected} within ${tolerance}`,
  );

test('real STEP preserves nominal dimensions, component placement, products and four HLR views', async () => {
  const bytes = await fs.readFile(new URL('../public/examples/mounting-kit.step', import.meta.url));
  const result = await importStep(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    'mounting-kit.step',
  );
  assert.equal(result.parts.length, 2);
  const plate = result.parts.find((part) => part.name === 'Mounting plate')!;
  const spacer = result.parts.find((part) => part.name === 'Spacer')!;
  assert.ok(plate);
  assert.ok(spacer);
  assert.deepEqual(plate.path, ['mounting-kit.step', 'Mounting plate']);
  near(plate.bounds.max[0] - plate.bounds.min[0], 80);
  near(plate.bounds.max[1] - plate.bounds.min[1], 50);
  near(plate.bounds.max[2] - plate.bounds.min[2], 12);
  near(spacer.bounds.min[0], 88);
  near(spacer.bounds.max[0], 112);
  assert.equal(plate.features?.circles.length, 10);
  assert.ok(
    plate.features!.circles.every((circle) => circle.closed && Math.abs(circle.normal[2]) === 1),
  );
  for (const part of result.parts) {
    assert.equal(part.unit, 'mm');
    assert.deepEqual(
      part.views.map((view) => view.id),
      ['front', 'top', 'right', 'iso'],
    );
    for (const view of part.views) {
      assert.ok(view.edges.some((edge) => !edge.hidden));
      assert.ok(view.anchors?.length);
      assert.ok(view.edges.flatMap((edge) => edge.points).every((p) => p.every(Number.isFinite)));
    }
  }
  const holes = plate.views
    .find((view) => view.id === 'top')!
    .edges.filter((edge) => edge.kind === 'circle' && !edge.hidden);
  assert.equal(holes.length, 5);
  assert.deepEqual(
    holes.map((edge) => edge.radius).sort((a, b) => a! - b!),
    [3, 3, 3, 3, 8],
  );
  assert.ok(holes.every((edge) => edge.closed));
  assert.ok(
    holes.some(
      (edge) => Math.abs(edge.center![0] - 40) < 1e-6 && Math.abs(edge.center![1] + 25) < 1e-6,
    ),
  );
  assert.ok(plate.views.find((view) => view.id === 'front')!.edges.some((edge) => edge.hidden));
  assert.ok(
    plate.views
      .find((view) => view.id === 'front')!
      .edges.some(
        (edge) => edge.kind === 'line' && edge.sourcePoints && Math.abs(edge.length! - 80) < 1e-6,
      ),
  );
});

test('a real multi-part STEP archive stores one original assembly and distinct manufacturing instructions for every element', async () => {
  const bytes = await fs.readFile(new URL('../public/examples/mounting-kit.step', import.meta.url));
  const originals = new SourceRepository();
  const source = originals.add({ name: 'mounting-kit.step', kind: 'step', bytes });
  const result = await importStep(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    source.name,
  );
  const instructions: Record<string, string> = {};
  for (const part of result.parts) {
    part.sourceId = source.id;
    instructions[part.id] =
      part.name === 'Mounting plate'
        ? 'Deburr the plate and inspect the mounting holes.'
        : 'Inspect the spacer bore after machining.';
  }
  const state = {
    parts: result.parts,
    activeId: result.parts[0].id,
    selected: new Set(result.parts.map((part) => part.id)),
    dimensions: Object.fromEntries(result.parts.map((part) => [part.id, []])),
    annotations: {},
    instructions,
    layouts: {},
    settings: { ...defaultSettings },
    description: 'One compact assembly drawing project.',
  };
  const opened = await openProjectArchive(await createProjectArchive(state, originals.all()));
  assert.equal(opened.project.parts.length, 2);
  assert.equal(opened.sources.length, 1);
  assert.deepEqual(opened.sources[0].bytes, new Uint8Array(bytes));
  for (const part of opened.project.parts) {
    assert.equal(part.sourceId, source.id);
    assert.equal(opened.project.instructions[part.id], instructions[part.id]);
    assert.equal(part.views.length, 4);
  }
});

test('single-solid exporter boilerplate falls back to the file stem while meaningful product names remain intact', async () => {
  const generic = 'Open CASCADE STEP translator 7.8 5';
  assert.equal(stepPartDisplayName(generic, 'flight-lower-cover.STEP', 1, 0), 'flight-lower-cover');
  assert.equal(stepPartDisplayName(generic, 'assembly.step', 2, 0), generic);
  assert.equal(
    stepPartDisplayName('Open CASCADE mounting bracket', 'bracket.step', 1, 0),
    'Open CASCADE mounting bracket',
  );
  assert.equal(
    stepPartDisplayName('Open CASCADE STEP translator coupling', 'coupling.step', 1, 0),
    'Open CASCADE STEP translator coupling',
  );
  const block = makeBaseBox(10, 12, 4);
  try {
    const source = exportSTEP([{ shape: block, name: generic }], { unit: 'MM', modelUnit: 'MM' });
    const result = await importStep(await source.arrayBuffer(), 'flight-lower-cover.step');
    assert.equal(result.parts[0].name, 'flight-lower-cover');
    assert.deepEqual(result.parts[0].path, ['flight-lower-cover.step', 'flight-lower-cover']);
  } finally {
    block.delete();
  }
});

test('projection cleanup removes coincident and hidden-over-visible strokes while preserving nearby detail', () => {
  const line = (id: string, start: number, end: number, y = 0, hidden = false): ProjectedEdge => ({
    id,
    kind: 'line',
    hidden,
    points: [
      [start, y],
      [end, y],
    ],
  });
  const result = cleanProjectedEdges([
    line('visible', 2, 8),
    line('duplicate-reversed', 8, 2),
    line('hidden', 0, 10, 0, true),
    line('nearby-real-groove', 2, 8, 0.00001),
  ]);
  assert.equal(result.filter((edge) => !edge.hidden).length, 2);
  assert.deepEqual(
    result.filter((edge) => edge.hidden).map((edge) => edge.points),
    [
      [
        [0, 0],
        [2, 0],
      ],
      [
        [8, 0],
        [10, 0],
      ],
    ],
  );
  const circle: ProjectedEdge = {
    id: 'rim',
    kind: 'circle',
    hidden: false,
    closed: true,
    center: [0, 0],
    radius: 4,
    points: [
      [4, 0],
      [0, 4],
      [-4, 0],
      [0, -4],
      [4, 0],
    ],
  };
  assert.equal(
    cleanProjectedEdges([circle, { ...circle, id: 'rear-rim', hidden: true }]).length,
    1,
  );
  const curve: ProjectedEdge = {
    id: 'curve',
    kind: 'curve',
    hidden: false,
    points: [
      [0, 0],
      [1, 2],
      [2, 0],
    ],
  };
  assert.equal(
    cleanProjectedEdges([
      curve,
      { ...curve, id: 'reversed-curve', points: [...curve.points].reverse() },
    ]).length,
    1,
  );
  const longLine = line('long', 0, 1e6);
  const almostParallel: ProjectedEdge = {
    id: 'small-angle',
    kind: 'line',
    hidden: false,
    points: [
      [0, 0],
      [1e6, 0.00001],
    ],
  };
  assert.equal(
    cleanProjectedEdges([longLine, almostParallel]).length,
    2,
    'Nearly parallel edges remain distinct when their actual separation exceeds kernel tolerance',
  );
});

test('rounded parts omit G1 tangent boundaries and retain complete physical outlines', async () => {
  const rounded = makeBaseBox(30, 20, 10).fillet(2);
  try {
    const source = exportSTEP([{ shape: rounded, name: 'Rounded block' }], {
      unit: 'MM',
      modelUnit: 'MM',
    });
    const result = await importStep(await source.arrayBuffer(), 'rounded.step');
    for (const view of result.parts[0].views.filter((view) => view.id !== 'iso')) {
      // A rounded rectangle has four straight sides and four corner arcs. The
      // sixteen internal tangent transitions returned by OCCT are omitted.
      assert.equal(view.edges.length, 8);
      assert.equal(view.edges.filter((edge) => edge.kind === 'circle').length, 4);
      assert.equal(view.edges.filter((edge) => edge.kind === 'line').length, 4);
      assert.ok(view.edges.every((edge) => !edge.hidden));
    }
  } finally {
    rounded.delete();
  }
});

test('an edge-on cylindrical rim is one straight stroke, not overlapping degenerate splines', async () => {
  const cylinder = makeCylinder(4, 20);
  try {
    const source = exportSTEP([{ shape: cylinder, name: 'Plain shaft' }], {
      unit: 'MM',
      modelUnit: 'MM',
    });
    const result = await importStep(await source.arrayBuffer(), 'shaft.step');
    const part = result.parts[0];
    for (const view of part.views.filter((view) => view.id === 'front' || view.id === 'right')) {
      assert.equal(view.edges.length, 4);
      assert.ok(view.edges.every((edge) => edge.kind === 'line' && !edge.hidden));
      assert.ok(view.edges.every((edge) => edge.sourcePoints !== undefined));
    }
    assert.equal(part.views.find((view) => view.id === 'top')!.edges.length, 1);
    assert.deepEqual(
      part.features?.circles.map((circle) => circle.radius),
      [4, 4],
    );
  } finally {
    cylinder.delete();
  }
});

test('inch source STEP converts to mm instead of silently changing scale', async () => {
  const block = makeBaseBox(25.4, 50.8, 12.7);
  try {
    const source = exportSTEP([{ shape: block, name: 'Inch block' }], {
      unit: 'INCH',
      modelUnit: 'MM',
    });
    const result = await importStep(await source.arrayBuffer(), 'inch.step');
    const { min, max } = result.parts[0].bounds;
    near(max[0] - min[0], 25.4);
    near(max[1] - min[1], 50.8);
    near(max[2] - min[2], 12.7);
  } finally {
    block.delete();
  }
});

test('invalid STEP fails with an actionable error', async () => {
  await assert.rejects(
    importStep(new TextEncoder().encode('not a STEP file').buffer, 'bad.step'),
    /not a readable STEP model/,
  );
});

test('true source lengths survive projection so tilted geometry cannot receive a false aligned dimension', async () => {
  const tilted = makeBaseBox(10, 10, 10).rotate(35, [0, 0, 0], [1, 0, 0]);
  try {
    const file = exportSTEP([{ shape: tilted, name: 'Tilted cube' }], {
      unit: 'MM',
      modelUnit: 'MM',
    });
    const result = await importStep(await file.arrayBuffer(), 'tilted.step');
    const edges = result.parts[0].views.find((view) => view.id === 'front')!.edges;
    const shortened = edges.find(
      (edge) =>
        edge.sourcePoints &&
        edge.length! -
          Math.hypot(
            edge.points.at(-1)![0] - edge.points[0][0],
            edge.points.at(-1)![1] - edge.points[0][1],
          ) >
          0.01,
    );
    assert.ok(shortened, 'The kernel must retain source length evidence for a tilted edge');
    assert.throws(
      () =>
        createLinearDimension(
          'front',
          shortened.points[0],
          shortened.points.at(-1)!,
          'aligned',
          shortened.sourcePoints![0],
          shortened.sourcePoints!.at(-1),
          shortened.length,
        ),
      /foreshortened/,
    );
  } finally {
    tilted.delete();
  }
});

test('real nested STEP preserves semantic ancestry and composed assembly placement', async () => {
  const bytes = await fs.readFile(
    new URL('../public/examples/nested-assembly.step', import.meta.url),
  );
  const result = await importStep(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    'nested-assembly.step',
  );
  assert.equal(result.parts.length, 1);
  assert.deepEqual(result.parts[0].path, [
    'nested-assembly.step',
    'Main assembly',
    'Sub assembly',
    'Test block',
  ]);
  assert.equal(result.parts[0].name, 'Test block');
  assert.deepEqual(result.parts[0].bounds, { min: [95, 15, 0], max: [105, 25, 10] });
});

test('STEP metadata resolves nested product paths and escaped names without reading geometry', () => {
  const products = readStepProducts(`
    #1=PRODUCT('root','Main assembly','',()); #2=PRODUCT_DEFINITION_FORMATION('','',#1); #3=PRODUCT_DEFINITION('','',#2,#99);
    #4=PRODUCT('sub','Bracket assembly','',()); #5=PRODUCT_DEFINITION_FORMATION('','',#4); #6=PRODUCT_DEFINITION('','',#5,#99);
    #7=PRODUCT('leaf','Bob''s plate #3','',()); #8=PRODUCT_DEFINITION_FORMATION('','',#7); #9=PRODUCT_DEFINITION('','',#8,#99);
    #10=NEXT_ASSEMBLY_USAGE_OCCURRENCE('','','',#3,#6,$); #11=NEXT_ASSEMBLY_USAGE_OCCURRENCE('','','',#6,#9,$);
  `);
  assert.deepEqual(products, [
    {
      definitionId: 9,
      name: "Bob's plate #3",
      paths: [['Main assembly', 'Bracket assembly', "Bob's plate #3"]],
    },
  ]);
});
