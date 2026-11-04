import assert from 'node:assert/strict';
import test from 'node:test';
import type { GearGeometry, GearSpecification, Part } from '../src/model';
import {
  gearReferenceDiameter,
  gearSourceHints,
  missingGearFields,
  parseGearGeometry,
  parseGearSpecification,
} from '../src/gears/specification';
import { defaultSettings, type WorkspaceState } from '../src/state';
import { WorkspaceDocument } from '../src/workspace-document';
import { parseProject, serializeProject } from '../src/project';
import { createProjectArchive, openProjectArchive } from '../src/io/project-archive';
import { SourceRepository } from '../src/io/source-repository';
import { autoDimensions } from '../src/drawing/dimensions';

/** Standard-sized synthetic wheel; no private model coordinates are used in this fixture. */
const geometry: GearGeometry = {
  axis: { origin: [11, 0, 0], direction: [1, 0, 0] },
  toothCount: 30,
  toothDatumDirection: [0, 1, 0],
  outsideDiameter: 64,
  rootDiameter: 55,
  faceWidth: 10,
  overallLength: 16,
  boreDiameter: 8.25,
  hubDiameter: 24,
  pinHoles: [{ diameter: 3, axis: { origin: [3, 0, 0], direction: [0, 0, 1] } }],
  profile: 'unverified',
  evidence: 'repeated-tip-root-arcs',
};
const specification: GearSpecification = {
  type: 'external-spur',
  teeth: 30,
  normalModule: 2,
  normalPressureAngle: 20,
  profileShift: 0,
  profileReference: 'Engineer-supplied basic rack reference',
  accuracy: 'Engineer-supplied grade',
  inspection: 'Span W and tolerance must be supplied by the designer.',
  toothSurfaceFinish: 'Ra 3.2',
  toothEdge: 'Deburr per manufacturing instructions',
};
function part(id = 'gear-a'): Part {
  return {
    id,
    name: '30-tooth module 2 gear',
    sourceName: 'shared.step',
    sourceId: 'source-a',
    path: ['shared.step', id],
    unit: 'mm',
    warnings: [],
    bounds: { min: [0, -32, -32], max: [16, 32, 32] },
    features: { circles: [], gear: structuredClone(geometry) },
    views: (['front', 'top', 'right', 'iso'] as const).map((id) => ({
      id,
      name: id,
      bounds: { minX: -32, minY: -32, maxX: 32, maxY: 32 },
      edges: [
        {
          id: `${id}-edge`,
          kind: 'line',
          hidden: false,
          points: [
            [-32, -32],
            [32, 32],
          ],
        },
      ],
    })),
  };
}
function workspace(): WorkspaceState {
  const parts = [part(), part('gear-b')];
  return {
    parts,
    activeId: parts[0].id,
    selected: new Set(parts.map((p) => p.id)),
    settings: { ...defaultSettings },
    dimensions: Object.fromEntries(parts.map((p) => [p.id, []])),
    annotations: {},
    instructions: {},
    layouts: {},
    description: '',
  };
}

test('normal-system pitch diameter uses supplied module and type without assuming pressure angle or zero profile shift', () => {
  const incomplete = parseGearSpecification({ type: 'external-spur', normalModule: 1 });
  assert.equal(incomplete.normalPressureAngle, undefined);
  assert.equal(incomplete.profileShift, undefined);
  assert.equal(gearReferenceDiameter(incomplete), undefined);
  assert.equal(gearReferenceDiameter(incomplete, 24), 24);
  assert.equal(gearReferenceDiameter({ ...specification, teeth: 25 }, 24), undefined);
  const helical = parseGearSpecification({
    type: 'external-helical',
    teeth: 24,
    normalModule: 1,
    helixAngle: 30,
  });
  assert.ok(Math.abs(gearReferenceDiameter(helical)! - 24 / Math.cos(Math.PI / 6)) < 1e-12);
  assert.equal(gearReferenceDiameter({ ...helical, helixAngle: undefined }), undefined);
  assert.equal(gearReferenceDiameter(undefined, 24), undefined);
});

test('source-name claims stay hints and missing engineering requirements remain explicit', () => {
  const gear = part();
  assert.deepEqual(gearSourceHints(gear), { teeth: 30, normalModule: 2 });
  assert.equal(gear.gearSpecification, undefined);
  assert.ok(missingGearFields(gear).includes('Normal pressure angle'));
  assert.ok(missingGearFields(gear).includes('Normal module'));
  assert.ok(!missingGearFields(gear).includes('Tooth count'));
  assert.deepEqual(missingGearFields(gear, specification), []);
  assert.deepEqual(gearSourceHints({ name: 'Gearbox module cover' }), {});
  assert.deepEqual(gearSourceHints({ name: '48-tooth module 1,25 wheel' }), {
    teeth: 48,
    normalModule: 1.25,
  });
});

test('gear specifications reject ambiguous units, coercion, invalid counts, control text and mismatched helical fields', () => {
  for (const raw of [
    { type: 'bevel' },
    { ...specification, teeth: 24.5 },
    { ...specification, normalModule: '1' },
    { ...specification, normalModule: 0 },
    { ...specification, normalPressureAngle: 90 },
    { ...specification, pressureAngle: 20 },
    { ...specification, helixAngle: 15 },
    { ...specification, inspection: 'bad\u0001text' },
    { ...specification, accuracy: 'x'.repeat(401) },
  ])
    assert.throws(() => parseGearSpecification(raw), /Invalid gear data/);
  assert.throws(() =>
    parseGearGeometry({ ...geometry, axis: { origin: [0, 0, 0], direction: [2, 0, 0] } }),
  );
  assert.throws(() => parseGearGeometry({ ...geometry, rootDiameter: 65 }));
  assert.throws(() => parseGearGeometry({ ...geometry, toothDatumDirection: [1, 0, 0] }));
  assert.throws(() => parseGearGeometry({ ...geometry, profile: 'verified' }));
  assert.deepEqual(parseGearGeometry(geometry), geometry);
});

test('per-part engineering edits undo and redo with their physical layout without changing the other gear', () => {
  const state = workspace(),
    document = new WorkspaceDocument(state);
  const layout = document.layout(state.parts[0]);
  assert.equal(document.setGearSpecification('gear-a', specification), true);
  assert.equal(state.parts[1].gearSpecification, undefined);
  assert.equal(state.layouts['gear-a'], undefined);
  assert.equal(document.travel('undo'), true);
  assert.equal(state.parts[0].gearSpecification, undefined);
  assert.deepEqual(state.layouts['gear-a'], layout);
  assert.equal(document.travel('redo'), true);
  assert.deepEqual(state.parts[0].gearSpecification, specification);
  state.dimensions['gear-a'] = [
    {
      id: 'fixed',
      viewId: 'front',
      kind: 'horizontal',
      a: [0, 0],
      b: [9, 0],
      value: 9,
      offset: 8,
      automatic: false,
      locked: true,
    },
  ];
  const lockedLayout = document.layout(state.parts[0]);
  assert.equal(
    document.setGearSpecification('gear-a', {
      ...specification,
      inspection: 'Revised control data',
    }),
    true,
  );
  assert.equal(state.layouts['gear-a'], lockedLayout);
});

test('gear evidence and engineering specifications survive validated JSON and a shared-source drawing archive', async () => {
  const state = workspace();
  state.dimensions['gear-a'] = [
    {
      id: 'precise-bore',
      viewId: 'right',
      kind: 'diameter',
      a: [0, 0],
      b: [1.5875, 0],
      value: 3.175,
      offset: 9,
      automatic: true,
      minimumPrecision: 3,
    },
  ];
  state.parts[0].gearSpecification = structuredClone(specification);
  state.parts[1].gearSpecification = {
    type: 'external-helical',
    teeth: 24,
    normalModule: 1,
    helixAngle: 15,
    helixHand: 'left',
  };
  const json = parseProject(serializeProject(state));
  assert.equal(json.dimensions['gear-a'][0].minimumPrecision, 3);
  assert.deepEqual(json.parts[0].features?.gear, geometry);
  assert.deepEqual(json.parts[0].gearSpecification, specification);
  const sources = new SourceRepository();
  const original = new TextEncoder().encode('Original CAD source bytes retained verbatim.');
  sources.add({ id: 'source-a', name: 'shared.step', kind: 'step', bytes: original });
  const reopened = await openProjectArchive(await createProjectArchive(state, sources.all()));
  assert.equal(reopened.sources.length, 1);
  assert.deepEqual(reopened.sources[0].bytes, original);
  assert.deepEqual(
    reopened.project.parts.map((p) => p.gearSpecification),
    state.parts.map((p) => p.gearSpecification),
  );
  const invalid = JSON.parse(serializeProject(state));
  invalid.parts[0].gearSpecification.normalModule = '1';
  assert.throws(() => parseProject(JSON.stringify(invalid)), /Invalid project/);
  delete invalid.parts[0].gearSpecification.normalModule;
  invalid.dimensions['gear-a'][0].minimumPrecision = 3.5;
  assert.throws(() => parseProject(JSON.stringify(invalid)), /minimum dimension precision/);
});

test('paper-scale changes keep generated gear dimensions outside the contour while preserving authored dimensions', () => {
  const state = workspace(),
    document = new WorkspaceDocument(state);
  state.settings.scale = 1;
  state.dimensions['gear-a'] = autoDimensions(state.parts[0]);
  document.layout(state.parts[0]);
  state.settings.scale = 2;
  document.layout(state.parts[0]);
  const pin = state.dimensions['gear-a'].find((d) => d.id.endsWith('pin-0-diameter'))!;
  const view = state.parts[0].views.find((v) => v.id === pin.viewId)!;
  const lineY = -Math.min(pin.a[1], pin.b[1]) * 2 + pin.offset;
  assert.ok(
    lineY >= -view.bounds.minY * 2 + 8.9,
    'The pin label must stay outside the scaled tooth envelope',
  );
  const authored = { ...pin, id: 'authored-pin', automatic: false, offset: 42 };
  state.dimensions['gear-a'].push(authored);
  state.settings.scale = 0.5;
  document.layout(state.parts[0]);
  assert.equal(state.dimensions['gear-a'].find((d) => d.id === authored.id)?.offset, 42);
});
