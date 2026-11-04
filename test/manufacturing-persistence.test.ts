import assert from 'node:assert/strict';
import test from 'node:test';
import type { Dimension, ManufacturingData, Part } from '../src/model';
import { effectivePartType } from '../src/manufacturing/catalog';
import { autoDimensions, formatDimension } from '../src/drawing/dimensions';
import { mergeDimensionSuggestions } from '../src/drawing/suggestions';
import { renderDrawing } from '../src/drawing/render';
import { defaultSettings, type WorkspaceState } from '../src/state';
import { WorkspaceDocument } from '../src/workspace-document';
import { parseProject, serializeProject } from '../src/project';
import { SourceRepository } from '../src/io/source-repository';
import { createProjectArchive, openProjectArchive } from '../src/io/project-archive';

function part(id: string): Part {
  return {
    id,
    name: id,
    sourceName: 'shared.step',
    sourceId: 'source-a',
    path: ['shared.step', id],
    unit: 'mm',
    warnings: [],
    bounds: { min: [0, 0, 0], max: [40, 20, 10] },
    views: (['front', 'top', 'right', 'iso'] as const).map((view) => ({
      id: view,
      name: view,
      bounds: { minX: 0, minY: 0, maxX: 40, maxY: 20 },
      edges: [
        {
          id: `${view}-edge`,
          kind: 'line',
          hidden: false,
          points: [
            [0, 0],
            [40, 20],
          ],
        },
      ],
    })),
  };
}
function fixture() {
  const parts = [part('part-a'), part('part-b')];
  const state: WorkspaceState = {
    description: 'Assembly instructions',
    parts,
    activeId: 'part-a',
    selected: new Set(parts.map((p) => p.id)),
    dimensions: { 'part-a': [], 'part-b': [] },
    annotations: {},
    instructions: {},
    layouts: {},
    settings: { ...defaultSettings },
  };
  const document = new WorkspaceDocument(state);
  return { state, document, parts };
}
const shaft: ManufacturingData = {
  type: 'shaft',
  profiles: {
    shaft: {
      fields: { thread: 'M6 × 1', journalFits: 'Ø12 h6' },
      parameters: [
        {
          id: 'shaft-extra',
          label: 'Balance requirement',
          symbol: 'G',
          value: 'Engineer supplied',
        },
      ],
    },
  },
};
const plate: ManufacturingData = {
  type: 'plate',
  profiles: {
    plate: { fields: { thickness: '5 ±0.05', flatness: 'Datum A, 0.05' }, parameters: [] },
  },
};
const manual: Dimension = {
  id: 'manual',
  viewId: 'front',
  kind: 'horizontal',
  a: [0, 0],
  b: [40, 0],
  value: 40,
  offset: 12,
  automatic: false,
  tolerance: { kind: 'fit', designation: 'H7' },
};

test('switching part types preserves inactive profile values, independent gear data and reversible layouts', () => {
  const { state, document, parts } = fixture();
  parts[0].gearSpecification = { type: 'external-spur', teeth: 24, normalModule: 1 };
  assert.equal(effectivePartType(parts[0]), 'gear');
  const originalLayout = document.layout(parts[0]);
  const input = structuredClone(shaft);
  assert.equal(document.setManufacturing('part-a', input), true);
  input.profiles.shaft!.fields.thread = 'changed after commit';
  assert.equal(parts[0].manufacturing?.profiles.shaft?.fields.thread, 'M6 × 1');
  assert.equal(state.layouts['part-a'], undefined);
  assert.equal(document.setManufacturing('part-a', structuredClone(plate)), true);
  assert.deepEqual(parts[0].manufacturing?.profiles.shaft, shaft.profiles.shaft);
  assert.deepEqual(parts[0].manufacturing?.profiles.plate, plate.profiles.plate);
  assert.equal(document.setManufacturing('part-a', { type: 'shaft', profiles: {} }), true);
  assert.equal(effectivePartType(parts[0]), 'shaft');
  assert.deepEqual(parts[0].gearSpecification, {
    type: 'external-spur',
    teeth: 24,
    normalModule: 1,
  });
  assert.equal(parts[1].manufacturing, undefined);
  assert.equal(document.travel('undo'), true);
  assert.equal(effectivePartType(parts[0]), 'plate');
  assert.equal(document.travel('undo'), true);
  assert.deepEqual(parts[0].manufacturing, shaft);
  assert.equal(document.travel('undo'), true);
  assert.equal(parts[0].manufacturing, undefined);
  assert.deepEqual(state.layouts['part-a'], originalLayout);
  assert.equal(document.travel('redo'), true);
  assert.deepEqual(parts[0].manufacturing, shaft);
});

test('nonactive profile edits own the target history, explicit removal is undoable, and no-op edits add no history', () => {
  const { state, document, parts } = fixture();
  assert.equal(document.setManufacturing('unknown', shaft), false);
  assert.equal(document.setManufacturing('part-b', shaft), true);
  assert.equal(document.history?.canUndo, false);
  state.activeId = 'part-b';
  assert.equal(document.travel('undo'), true);
  assert.equal(parts[1].manufacturing, undefined);
  assert.equal(document.travel('redo'), true);
  assert.equal(document.setManufacturing('part-b', structuredClone(shaft)), false);
  assert.equal(document.setManufacturing('part-b'), true);
  assert.equal(parts[1].manufacturing, undefined);
  assert.equal(document.travel('undo'), true);
  assert.deepEqual(parts[1].manufacturing, shaft);
});

test('type changes safely refresh plain automatic suggestions while retaining authored specifications', () => {
  const { state, document, parts } = fixture();
  state.dimensions['part-a'] = [
    {
      ...manual,
      id: 'stale-auto',
      a: [0, 0],
      b: [7, 0],
      value: 7,
      automatic: true,
      tolerance: undefined,
    },
    { ...manual, id: 'qualified-auto', a: [0, 0], b: [11, 0], value: 11, automatic: true },
  ];
  document.setManufacturing('part-a', shaft);
  const dimensions = state.dimensions['part-a'];
  assert.ok(!dimensions.some((d) => d.id === 'stale-auto'));
  const retained = dimensions.find((d) => d.id === 'qualified-auto');
  assert.ok(retained);
  assert.equal(retained.automatic, false);
  assert.deepEqual(retained.tolerance, manual.tolerance);
  assert.ok(dimensions.some((d) => d.automatic));
  assert.equal(document.travel('undo'), true);
  assert.equal(parts[0].manufacturing, undefined);
  assert.deepEqual(
    state.dimensions['part-a'].map((d) => d.id),
    ['stale-auto', 'qualified-auto'],
  );
});

test('an explicit general profile replaces gear-specific suggestions and undo restores the prior gear set', () => {
  const { state, document, parts } = fixture();
  const target = parts[0];
  target.features = {
    circles: [0, 10].map((x, index) => ({
      id: `station-${index}`,
      center: [x, 10, 10],
      normal: [1, 0, 0],
      radius: 4,
      closed: true,
    })),
    gear: {
      axis: { origin: [5, 10, 10], direction: [1, 0, 0] },
      toothCount: 12,
      outsideDiameter: 18,
      rootDiameter: 14,
      faceWidth: 5,
      overallLength: 10,
      hubDiameter: 8,
      boreDiameter: 3,
      profile: 'unverified',
      evidence: 'repeated-tip-root-arcs',
    },
  };
  target.gearSpecification = { type: 'external-spur', normalModule: 1 };
  state.dimensions[target.id] = autoDimensions(target);
  const original = structuredClone(state.dimensions[target.id]);
  assert.ok(original.some((d) => d.id.includes('-auto-gear-')));
  document.setManufacturing(target.id, { type: 'general', profiles: {} });
  assert.equal(effectivePartType(target), 'general');
  const measurements = (dimensions: Dimension[]) =>
    dimensions.map((d) => JSON.stringify([d.viewId, d.kind, d.a, d.b, d.value])).sort();
  assert.deepEqual(measurements(state.dimensions[target.id]), measurements(autoDimensions(target)));
  assert.ok(!state.dimensions[target.id].some((d) => d.id.endsWith('-auto-gear-outside')));
  assert.ok(target.features.gear);
  assert.ok(target.gearSpecification);
  assert.equal(document.travel('undo'), true);
  assert.equal(effectivePartType(target), 'gear');
  assert.deepEqual(state.dimensions[target.id], original);
});

test('Gear to Bushing preserves the exact fractional bore label through regeneration, layout and undo', () => {
  const { state, document, parts } = fixture(),
    target = parts[0];
  target.bounds = { min: [0, -12, -12], max: [8, 12, 12] };
  for (const view of target.views) {
    view.bounds = {
      minX: view.id === 'front' || view.id === 'top' ? 0 : -12,
      minY: -12,
      maxX: view.id === 'front' || view.id === 'top' ? 8 : 12,
      maxY: 12,
    };
    view.edges = [
      {
        id: `${view.id}-outline`,
        kind: 'line',
        hidden: false,
        points: [
          [view.bounds.minX, -12],
          [view.bounds.maxX, 12],
        ],
      },
    ];
  }
  target.views
    .find((view) => view.id === 'right')!
    .edges.push({
      id: 'fractional-bore',
      kind: 'circle',
      hidden: false,
      closed: true,
      center: [0, 0],
      radius: 1.5875,
      points: [
        [1.5875, 0],
        [0, 1.5875],
        [-1.5875, 0],
        [0, -1.5875],
        [1.5875, 0],
      ],
    });
  target.features = {
    circles: [0, 8].map((x) => ({
      id: `bore-${x}`,
      center: [x, 0, 0],
      normal: [1, 0, 0],
      radius: 1.5875,
      closed: true,
    })),
    gear: {
      axis: { origin: [6, 0, 0], direction: [1, 0, 0] },
      toothCount: 20,
      outsideDiameter: 24,
      rootDiameter: 20,
      faceWidth: 4,
      overallLength: 8,
      boreDiameter: 3.175,
      profile: 'unverified',
      evidence: 'repeated-tip-root-arcs',
    },
  };
  state.dimensions[target.id] = autoDimensions(target);
  const original = structuredClone(state.dimensions[target.id]);
  const before = original.find(
    (dimension) => dimension.kind === 'diameter' && dimension.value === 3.175,
  )!;
  assert.equal(before.minimumPrecision, 3);
  assert.equal(formatDimension(before, state.settings.precision), 'Ø3.175');
  assert.equal(document.setManufacturing(target.id, { type: 'bushing', profiles: {} }), true);
  assert.equal(effectivePartType(target), 'bushing');
  const layout = document.layout(target);
  const after = state.dimensions[target.id].find((dimension) => dimension.id === before.id)!;
  assert.equal(after.value, 3.175);
  assert.equal(after.minimumPrecision, 3);
  assert.equal(formatDimension(after, state.settings.precision), 'Ø3.175');
  assert.match(
    renderDrawing(target, state.dimensions[target.id], state.settings, undefined, layout).svg,
    />Ø3\.175<\/text>/,
  );
  assert.equal(document.travel('undo'), true);
  assert.equal(effectivePartType(target), 'gear');
  assert.deepEqual(state.dimensions[target.id], original);
  assert.equal(
    formatDimension(
      state.dimensions[target.id].find((dimension) => dimension.id === before.id)!,
      state.settings.precision,
    ),
    'Ø3.175',
  );
});

test('matched suggestions keep the stricter precision supplied by either source without inventing a precision field', () => {
  for (const [previous, suggested, expected] of [
    [3, undefined, 3],
    [4, 2, 4],
    [2, 5, 5],
    [undefined, undefined, undefined],
  ]) {
    const old: Dimension = {
      ...manual,
      automatic: true,
      tolerance: undefined,
      minimumPrecision: previous,
    };
    const next: Dimension = { ...old, id: 'fresh-suggestion', minimumPrecision: suggested };
    const result = mergeDimensionSuggestions([old], [next]).dimensions[0];
    assert.equal(result.minimumPrecision, expected);
    assert.equal(result.id, old.id);
    assert.equal(old.minimumPrecision, previous);
    assert.equal(next.minimumPrecision, suggested);
  }
});

test('manual dimensions and review marks prevent replacement, while locks retain the exact physical layout', () => {
  const { state, document, parts } = fixture();
  state.dimensions['part-a'] = [structuredClone(manual)];
  document.setManufacturing('part-a', shaft);
  assert.deepEqual(state.dimensions['part-a'], [manual]);
  state.dimensions['part-a'] = [{ ...manual, automatic: true, locked: true }];
  const layout = document.layout(parts[0]);
  const dimensions = structuredClone(state.dimensions['part-a']);
  document.setManufacturing('part-a', plate);
  assert.equal(state.layouts['part-a'], layout);
  assert.deepEqual(state.dimensions['part-a'], dimensions);
  state.dimensions['part-a'] = [{ ...manual, automatic: true }];
  state.annotations['part-a'] = [
    {
      id: 'review',
      kind: 'text',
      points: [[5, 5]],
      text: 'Keep this note',
      fontSize: 3,
      strokeWidth: 0.5,
    },
  ];
  const before = structuredClone(state.dimensions['part-a']);
  document.setManufacturing('part-a', shaft);
  assert.deepEqual(state.dimensions['part-a'], before);
  assert.equal(state.annotations['part-a'][0].text, 'Keep this note');
});

test('profiles survive ordinary dimension/instruction undo, validated JSON and a byte-preserving shared-source ZIP', async () => {
  const { state, document, parts } = fixture();
  document.setManufacturing('part-a', shaft);
  document.setManufacturing('part-b', {
    type: 'custom',
    profiles: {
      custom: {
        customName: 'Instrument carrier',
        fields: { inspection: 'Перевірити Ø6 😀' },
        parameters: [{ id: 'custom-one', label: 'Special control', symbol: 'Ø', value: '6 ±0.02' }],
      },
    },
  });
  document.setInstructions('part-a', 'Deburr after machining.');
  document.changeDimensions([manual]);
  assert.equal(document.travel('undo'), true);
  assert.deepEqual(parts[0].manufacturing, shaft);
  assert.equal(document.getInstructions('part-a'), 'Deburr after machining.');
  const parsed = parseProject(serializeProject(state));
  assert.deepEqual(
    parsed.parts.map((p) => p.manufacturing),
    parts.map((p) => p.manufacturing),
  );
  const original = new TextEncoder().encode('Original public-safe test source bytes.');
  const sources = new SourceRepository();
  sources.add({ id: 'source-a', name: 'shared.step', kind: 'step', bytes: original });
  const opened = await openProjectArchive(await createProjectArchive(state, sources.all()));
  assert.equal(opened.sources.length, 1);
  assert.deepEqual(opened.sources[0].bytes, original);
  assert.deepEqual(
    opened.project.parts.map((p) => p.manufacturing),
    parts.map((p) => p.manufacturing),
  );
});

test('malformed manufacturing data is rejected before document mutation or project replacement', () => {
  const { state, document, parts } = fixture();
  const invalids: unknown[] = [
    null,
    { type: 'worm', profiles: {} },
    { type: 'shaft', profiles: { shaft: { fields: { unknown: 'x' }, parameters: [] } } },
    { type: 'shaft', profiles: { bevel: { fields: {}, parameters: [] } } },
    { type: 'general', profiles: { general: { fields: { inspection: 1 }, parameters: [] } } },
    {
      type: 'custom',
      profiles: { custom: { fields: { inspection: 'bad\uD800' }, parameters: [] } },
    },
    {
      type: 'custom',
      profiles: {
        custom: {
          fields: {},
          parameters: [
            { id: 'dup', label: 'One', value: '1' },
            { id: 'dup', label: 'Two', value: '2' },
          ],
        },
      },
    },
  ];
  const original = JSON.parse(serializeProject(state));
  for (const data of invalids) {
    assert.throws(
      () => document.setManufacturing('part-a', data as ManufacturingData),
      /manufacturing data/,
    );
    assert.equal(parts[0].manufacturing, undefined);
    assert.equal(document.history?.canUndo, false);
    const project = structuredClone(original);
    project.parts[0].manufacturing = data;
    assert.throws(() => parseProject(JSON.stringify(project)), /Invalid project/);
  }
  const empty = parseProject(serializeProject(state));
  assert.equal(empty.parts[0].manufacturing, undefined);
});
