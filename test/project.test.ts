import test from 'node:test';
import assert from 'node:assert/strict';
import type { DrawingAnnotation, DrawingLayout, Part, Projection } from '../src/model';
import { parseProject, serializeProject, snapshotProject } from '../src/project';
import { defaultSettings, type WorkspaceState } from '../src/state';
import { DEFAULT_ANNOTATION_COLOR } from '../src/drawing/annotation-style';

function workspace(): WorkspaceState {
  const views: Projection[] = (['front', 'top', 'right', 'iso'] as const).map((id) => ({
    id,
    name: id,
    bounds: { minX: 0, minY: 0, maxX: 20.123456789, maxY: 10 },
    edges: [
      {
        id: 'edge',
        kind: 'line',
        hidden: false,
        points: [
          [0, 0],
          [20.123456789, 10],
        ],
      },
    ],
    anchors: [{ id: 'origin', point: [0, 0], source: [0, 0, 0] }],
  }));
  const part: Part = {
    id: 'part-1',
    name: 'Plate',
    sourceName: 'assembly.step',
    path: ['Assembly', 'Plate'],
    unit: 'mm',
    bounds: { min: [0, 0, 0], max: [20.123456789, 10, 3] },
    views,
    warnings: [],
    features: {
      circles: [
        { id: 'bore', center: [5, 5, 3], normal: [0, 0, 1], radius: 2.123456789, closed: true },
      ],
    },
  };
  return {
    parts: [part],
    activeId: part.id,
    selected: new Set([part.id]),
    settings: { ...defaultSettings },
    annotations: {},
    instructions: {},
    description: '',
    layouts: {},
    dimensions: {
      [part.id]: [
        {
          id: 'width',
          viewId: 'front',
          kind: 'horizontal',
          a: [0, 0],
          b: [20.123456789, 0],
          value: 20.123456789,
          offset: 10,
          automatic: true,
        },
      ],
    },
  };
}
const source = () => JSON.parse(serializeProject(workspace()));

test('saving snapshots clone only validated document data without retaining mutable input arrays', () => {
  const state = workspace();
  const snapshot = snapshotProject(state);
  const expected = parseProject(serializeProject(state));
  assert.deepEqual(snapshot, expected);
  state.parts[0].views[0].edges[0].points[0][0] = 99;
  state.dimensions['part-1'][0].offset = 44;
  state.settings.title = 'Edited after snapshot';
  assert.deepEqual(snapshot, expected);
});

test('analytic edge metadata must agree with the displayed line or circular geometry', () => {
  const straight = source();
  straight.parts[0].views[0].edges[0].points = [
    [0, 0],
    [5, 2],
    [10, 0],
  ];
  assert.throws(() => parseProject(JSON.stringify(straight)), /straight endpoint segment/);
  straight.parts[0].views[0].edges[0].points = [
    [0, 0],
    [15, 0],
    [10, 0],
  ];
  assert.throws(() => parseProject(JSON.stringify(straight)), /straight endpoint segment/);
  const circular = source();
  const edge = {
    id: 'verified-circle',
    kind: 'circle',
    hidden: false,
    center: [2, 2],
    radius: 2,
    closed: true,
    points: [
      [4, 2],
      [2, 4],
      [0, 2],
      [2, 0],
      [4, 2],
    ],
  };
  circular.parts[0].views[0].edges = [edge];
  assert.equal(parseProject(JSON.stringify(circular)).parts[0].views[0].edges[0].radius, 2);
  edge.radius = 3;
  assert.throws(() => parseProject(JSON.stringify(circular)), /analytic center and radius/);
  edge.radius = 2;
  edge.points.pop();
  assert.throws(() => parseProject(JSON.stringify(circular)), /return to their starting point/);
});

function fixedLayout(): DrawingLayout {
  return {
    scale: 0.5,
    viewTransforms: {
      front: { x: 205.123456789, y: 71.25, scale: 0.5 },
      top: { x: 205.123456789, y: 153.875, scale: 0.5 },
      right: { x: 80.5, y: 71.25, scale: 0.5 },
      iso: { x: 75.875, y: 151.25, scale: 0.5 },
    },
  };
}

test('sheet layout survives project roundtrip and manual dimension changes without reflow', () => {
  const state = workspace();
  state.layouts['part-1'] = fixedLayout();
  state.dimensions['part-1'][0].offset = 27.125;
  state.dimensions['part-1'][0].textOffset = [13.25, -5.75];
  const reopened = parseProject(serializeProject(state));
  assert.deepEqual(reopened.layouts['part-1'], fixedLayout());
  assert.equal(reopened.dimensions['part-1'][0].offset, 27.125);
  assert.deepEqual(reopened.dimensions['part-1'][0].textOffset, [13.25, -5.75]);
  assert.notEqual(reopened.layouts['part-1'], state.layouts['part-1']);
  assert.notEqual(
    reopened.layouts['part-1'].viewTransforms,
    state.layouts['part-1'].viewTransforms,
  );
});

test('projects without saved layout metadata remain editable', () => {
  const project = source();
  delete project.layouts;
  assert.deepEqual(Object.keys(parseProject(JSON.stringify(project)).layouts), []);
});

test('invalid, inconsistent or orphan view layouts are rejected before rendering', () => {
  const mutations = [
    (p: any) => {
      p.layouts.orphan = fixedLayout();
    },
    (p: any) => {
      p.layouts['part-1'].scale = 0;
    },
    (p: any) => {
      p.layouts['part-1'].scale = -1;
    },
    (p: any) => {
      p.layouts['part-1'].scale = 1e6 + 1;
    },
    (p: any) => {
      p.layouts['part-1'].scale = Infinity;
    },
    (p: any) => {
      p.layouts['part-1'].viewTransforms.front.x = Infinity;
    },
    (p: any) => {
      p.layouts['part-1'].viewTransforms.front.y = -1e9 - 1;
    },
    (p: any) => {
      p.layouts['part-1'].viewTransforms.front.scale = 0.25;
    },
    (p: any) => {
      delete p.layouts['part-1'].viewTransforms.top;
    },
    (p: any) => {
      p.layouts['part-1'].viewTransforms.back = { x: 0, y: 0, scale: 0.5 };
    },
    (p: any) => {
      p.layouts['part-1'].viewTransforms.iso = [0, 0, 0.5];
    },
    (p: any) => {
      p.layouts['part-1'].viewTransforms = null;
    },
    (p: any) => {
      p.layouts = [];
    },
  ];
  for (const mutate of mutations) {
    const project = source();
    project.layouts['part-1'] = fixedLayout();
    mutate(project);
    assert.throws(() => parseProject(JSON.stringify(project)), /Invalid project/);
  }
});

test('layout parsing keeps only supported geometry fields in fresh objects', () => {
  const project = source();
  project.layouts['part-1'] = { ...fixedLayout(), width: 'untrusted', onload: 'alert(1)' };
  project.layouts['part-1'].viewTransforms.front.style = 'url(javascript:alert(1))';
  Object.defineProperty(project.layouts['part-1'].viewTransforms.front, '__proto__', {
    value: { polluted: true },
    enumerable: true,
  });
  const parsed = parseProject(JSON.stringify(project)).layouts['part-1'];
  assert.deepEqual(parsed, fixedLayout());
  assert.equal(Object.hasOwn(parsed, 'onload'), false);
  assert.equal(Object.hasOwn(parsed.viewTransforms.front, '__proto__'), false);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test('editable project roundtrip preserves precision, selection, annotations and settings', () => {
  const state = workspace();
  state.dimensions['part-1'][0].suffix = ' ±0.05';
  state.dimensions['part-1'][0].textOffset = [3.25, -2];
  state.settings.notes = 'Deburr all edges.\nDo not scale the drawing.';
  state.settings.template = 'eskd-uk';
  state.settings.organization = 'DEFENCORE';
  state.settings.author = 'Іваненко';
  state.settings.checkedBy = 'Петренко';
  state.settings.checkedDate = '04.11.26';
  state.settings.inventoryNumber = 'INV-001';
  const project = parseProject(serializeProject(state));
  assert.deepEqual(project.parts, state.parts);
  assert.deepEqual(project.selected, ['part-1']);
  assert.deepEqual(project.dimensions['part-1'], state.dimensions['part-1']);
  assert.equal(project.dimensions['part-1'][0].value, 20.123456789);
  assert.deepEqual(project.settings, state.settings);
});

test('malformed geometry cannot reach projection or dimension rendering', () => {
  const mutations = [
    (p: any) => {
      delete p.parts[0].views[0].bounds.maxX;
    },
    (p: any) => {
      p.parts[0].views[0].bounds.minX = 100;
    },
    (p: any) => {
      p.parts[0].views[0].edges[0].points[0] = [0, 0, 1];
    },
    (p: any) => {
      p.parts[0].views[0].edges[0].points[0] = [Infinity, 0];
    },
    (p: any) => {
      p.parts[0].views[0].edges[0].points[0] = [-100, 0];
    },
    (p: any) => {
      p.parts[0].views[1].id = 'front';
    },
    (p: any) => {
      p.parts[0].unit = 'inch';
    },
    (p: any) => {
      p.parts[0].views[0].anchors[0].source = [0, 0];
    },
    (p: any) => {
      p.dimensions['part-1'][0].viewId = 'iso';
    },
    (p: any) => {
      p.dimensions['part-1'][0].value = '<script>';
    },
    (p: any) => {
      p.dimensions['part-1'][0].value = 99;
    },
    (p: any) => {
      p.parts[0].features.circles[0].normal = [0, 0, 2];
    },
    (p: any) => {
      p.parts[0].features.circles[0].radius = -1;
    },
  ];
  for (const mutate of mutations) {
    const project = source();
    mutate(project);
    assert.throws(() => parseProject(JSON.stringify(project)), /Invalid project/);
  }
});

test('project data cannot substitute strings for boolean settings or flags', () => {
  for (const mutate of [
    (p: any) => {
      p.settings.hiddenLines = 'false';
    },
    (p: any) => {
      delete p.settings.centerLines;
    },
    (p: any) => {
      p.parts[0].views[0].edges[0].hidden = 0;
    },
    (p: any) => {
      p.dimensions['part-1'][0].automatic = 'true';
    },
  ]) {
    const project = source();
    mutate(project);
    assert.throws(() => parseProject(JSON.stringify(project)), /must be true or false/);
  }
});

test('prototype-like IDs and orphan dimensions or selections are rejected', () => {
  for (const mutate of [
    (p: any) => {
      p.parts[0].id = '__proto__';
    },
    (p: any) => {
      p.dimensions.orphan = [];
    },
    (p: any) => {
      p.selected = ['unknown'];
    },
    (p: any) => {
      p.selected = ['part-1', 'part-1'];
    },
    (p: any) => {
      p.dimensions['part-1'].push(p.dimensions['part-1'][0]);
    },
  ]) {
    const project = source();
    mutate(project);
    assert.throws(() => parseProject(JSON.stringify(project)), /Invalid project/);
  }
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test('untrusted names remain plain text and extra object properties are discarded', () => {
  const project = source();
  project.parts[0].name = '<img src=x onerror="alert(1)">';
  project.parts[0].views[0].onload = 'alert(1)';
  project.parts[0].views[0].edges[0].style = 'url(javascript:alert(1))';
  Object.defineProperty(project.parts[0], '__proto__', {
    value: { polluted: true },
    enumerable: true,
  });
  const parsed = parseProject(JSON.stringify(project));
  assert.equal(parsed.parts[0].name, project.parts[0].name);
  assert.equal(Object.hasOwn(parsed.parts[0], '__proto__'), false);
  assert.equal(Object.hasOwn(parsed.parts[0].views[0], 'onload'), false);
  assert.equal(Object.hasOwn(parsed.parts[0].views[0].edges[0], 'style'), false);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test('resource limits reject oversized arrays before rendering', () => {
  const project = source();
  project.parts[0].views[0].edges[0].points = Array.from({ length: 10001 }, () => [0, 0]);
  assert.throws(() => parseProject(JSON.stringify(project)), /supported limit/);
});

test('angle values must agree with a finite pair of rays and an explicit vertex', () => {
  const project = source();
  project.dimensions['part-1'] = [
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
  assert.equal(parseProject(JSON.stringify(project)).dimensions['part-1'][0].value, 90);
  delete project.dimensions['part-1'][0].vertex;
  assert.throws(() => parseProject(JSON.stringify(project)), /require a vertex/);
});

test('dimension tolerance modes survive project roundtrip without changing nominal measurements', () => {
  const tolerances = [
    { kind: 'symmetric' as const, magnitude: '0.050' },
    { kind: 'deviation' as const, upper: '+0.040', lower: '-0.020' },
    { kind: 'deviation' as const, upper: '-0.010', lower: '-0.030' },
    { kind: 'fit' as const, designation: 'H7/g6' },
  ];
  for (const tolerance of tolerances) {
    const state = workspace(),
      original = structuredClone(state.dimensions['part-1'][0]);
    state.dimensions['part-1'][0].tolerance = tolerance;
    const reopened = parseProject(serializeProject(state)).dimensions['part-1'][0];
    assert.deepEqual(reopened.tolerance, tolerance);
    const { tolerance: omitted, ...nominal } = reopened;
    assert.deepEqual(nominal, original);
  }
  const legacy = source();
  legacy.dimensions['part-1'][0].suffix = ' ±0.05';
  assert.equal(parseProject(JSON.stringify(legacy)).dimensions['part-1'][0].tolerance, undefined);
  assert.equal(parseProject(JSON.stringify(legacy)).dimensions['part-1'][0].suffix, ' ±0.05');
});

test('project tolerance parsing rejects malformed values and keeps only supported data', () => {
  const invalid = [
    null,
    [],
    '0.05',
    { kind: 'unknown' },
    { kind: 'symmetric', magnitude: '-0.050' },
    { kind: 'symmetric', magnitude: '0,05' },
    { kind: 'symmetric', magnitude: '1e-3' },
    { kind: 'symmetric', magnitude: '1000001' },
    { kind: 'symmetric', magnitude: '0.0000000001' },
    { kind: 'deviation', upper: '-0.1', lower: '0.1' },
    { kind: 'deviation', upper: '0.1', lower: '' },
    { kind: 'fit', designation: 'H7<script>' },
  ];
  for (const tolerance of invalid) {
    const project = source();
    project.dimensions['part-1'][0].tolerance = tolerance;
    assert.throws(() => parseProject(JSON.stringify(project)), /Invalid project/);
  }
  const project = source();
  project.dimensions['part-1'][0].tolerance = {
    kind: 'fit',
    designation: 'H7',
    onclick: 'untrusted',
    numericLimits: [0, 1],
  };
  const parsed = parseProject(JSON.stringify(project)).dimensions['part-1'][0].tolerance;
  assert.deepEqual(parsed, { kind: 'fit', designation: 'H7' });
});

test('angular dimensions accept numeric deviations in degrees and reject fit designations', () => {
  const project = source();
  project.dimensions['part-1'] = [
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
      tolerance: { kind: 'symmetric', magnitude: '0.50' },
    },
  ];
  assert.deepEqual(parseProject(JSON.stringify(project)).dimensions['part-1'][0].tolerance, {
    kind: 'symmetric',
    magnitude: '0.50',
  });
  project.dimensions['part-1'][0].tolerance = { kind: 'fit', designation: 'H7' };
  assert.throws(() => parseProject(JSON.stringify(project)), /not valid for angular/);
});

test('paper annotations and project descriptions roundtrip through fresh whitelisted objects', () => {
  const state = workspace();
  state.description = 'Assembly check 😀';
  const note: DrawingAnnotation = {
    id: 'note',
    kind: 'text',
    points: [[25.5, 40.25]],
    text: 'Inspect Ø6 😀',
    strokeWidth: 0.3,
    fontSize: 4,
    color: DEFAULT_ANNOTATION_COLOR,
  };
  state.annotations['part-1'] = [note];
  const parsed = parseProject(serializeProject(state));
  assert.equal(parsed.description, state.description);
  assert.deepEqual(parsed.annotations['part-1'], [note]);
  assert.notEqual(parsed.annotations['part-1'][0], note);
  const data = JSON.parse(serializeProject(state));
  data.annotations['part-1'][0].script = 'discard';
  assert.equal('script' in parseProject(JSON.stringify(data)).annotations['part-1'][0], false);
});

test('malformed or orphan annotations and invalid XML text are rejected before rendering', () => {
  const state = workspace();
  state.annotations['part-1'] = [
    {
      id: 'note',
      kind: 'text',
      points: [[20, 30]],
      text: 'Inspect',
      strokeWidth: 0.3,
      fontSize: 4,
    },
  ];
  const base = JSON.parse(serializeProject(state));
  for (const mutate of [
    (data: any) => {
      data.annotations.orphan = [];
    },
    (data: any) => {
      data.annotations['part-1'][0].strokeWidth = -1;
    },
    (data: any) => {
      data.annotations['part-1'][0].points.push([30, 40]);
    },
    (data: any) => {
      data.annotations['part-1'][0].kind = 'script';
    },
    (data: any) => {
      data.annotations['part-1'][0].text = '\uD800';
    },
    (data: any) => {
      data.settings.title = '\uFFFF';
    },
    (data: any) => {
      data.description = '\uDFFF';
    },
    (data: any) => {
      data.annotations['part-1'].push(data.annotations['part-1'][0]);
    },
  ]) {
    const data = structuredClone(base);
    mutate(data);
    assert.throws(() => parseProject(JSON.stringify(data)), /Invalid project/);
  }
});

test('annotation colors canonicalize six-digit hex and absent archived colors become the shared review color', () => {
  const state = workspace();
  const note: DrawingAnnotation = {
    id: 'colored',
    kind: 'text',
    points: [[25, 40]],
    text: 'Review fit',
    strokeWidth: 0.3,
    fontSize: 4,
    color: '#5B8DEF',
  };
  state.annotations['part-1'] = [note];
  const data = JSON.parse(serializeProject(state));
  const parsed = parseProject(JSON.stringify(data));
  assert.equal(parsed.annotations['part-1'][0].color, '#5b8def');
  assert.equal(note.color, '#5B8DEF', 'normalization cannot mutate the live document');
  delete data.annotations['part-1'][0].color;
  const normalized = parseProject(JSON.stringify(data)).annotations['part-1'][0];
  assert.equal(normalized.color, DEFAULT_ANNOTATION_COLOR);
  const { color: normalizedColor, ...geometry } = normalized;
  const { color: inputColor, ...original } = note;
  assert.deepEqual(geometry, original);
});

test('annotation colors reject CSS names, alpha, shorthand and injection strings', () => {
  const state = workspace();
  state.annotations['part-1'] = [
    { id: 'note', kind: 'text', points: [[20, 30]], text: 'Inspect', strokeWidth: 0.3 },
  ];
  const base = JSON.parse(serializeProject(state));
  for (const color of [
    'red',
    '#abc',
    '#abcdef80',
    ' #abcdef',
    '#abcdef ',
    'rgb(0,0,0)',
    'url(javascript:alert(1))',
    '#fff\" onload=\"x',
    '#12345g',
    '',
    null,
    123456,
    {},
  ]) {
    const data = structuredClone(base);
    data.annotations['part-1'][0].color = color;
    assert.throws(() => parseProject(JSON.stringify(data)), /annotation color/);
  }
});

test('dimension and review lock flags roundtrip as strict optional booleans', () => {
  const state = workspace();
  state.dimensions['part-1'][0].locked = true;
  state.annotations['part-1'] = [
    {
      id: 'note',
      kind: 'text',
      points: [[20, 30]],
      text: 'Keep in place',
      strokeWidth: 0.3,
      color: '#2678d4',
      locked: true,
    },
  ];
  const parsed = parseProject(serializeProject(state));
  assert.equal(parsed.dimensions['part-1'][0].locked, true);
  assert.equal(parsed.annotations['part-1'][0].locked, true);
  assert.equal(parsed.annotations['part-1'][0].color, '#2678d4');
  const base = JSON.parse(serializeProject(state));
  for (const locked of ['true', 'false', 1, 0, null, {}, []])
    for (const kind of ['dimensions', 'annotations']) {
      const data = structuredClone(base);
      data[kind]['part-1'][0].locked = locked;
      assert.throws(() => parseProject(JSON.stringify(data)), /locked flag/);
    }
  base.dimensions['part-1'][0].locked = false;
  base.annotations['part-1'][0].locked = false;
  assert.equal(parseProject(JSON.stringify(base)).annotations['part-1'][0].locked, false);
  delete base.dimensions['part-1'][0].locked;
  delete base.annotations['part-1'][0].locked;
  assert.equal(parseProject(JSON.stringify(base)).annotations['part-1'][0].locked, undefined);
});

test('manufacturing instructions are per-part document data with normalized missing entries', () => {
  const state = workspace();
  state.instructions['part-1'] = 'Deburr sharp edges.\nПеревірити посадку Ø6 😀';
  const parsed = parseProject(serializeProject(state));
  assert.equal(parsed.instructions['part-1'], state.instructions['part-1']);
  assert.notEqual(parsed.instructions, state.instructions);
  assert.equal(
    parsed.settings.notes,
    state.settings.notes,
    'instructions cannot overwrite cached global drawing notes',
  );
  const data = JSON.parse(serializeProject(state));
  delete data.instructions;
  assert.deepEqual(Object.entries(parseProject(JSON.stringify(data)).instructions), [
    ['part-1', ''],
  ]);
  data.instructions = {};
  assert.equal(parseProject(JSON.stringify(data)).instructions['part-1'], '');
});

test('manufacturing instructions reject unknown parts, nontext, oversized values and malformed Unicode', () => {
  const base = source();
  for (const value of [
    null,
    1,
    false,
    [],
    {},
    'x'.repeat(20001),
    '\uD800',
    '\uFFFF',
    'text\u0001',
  ]) {
    const data = structuredClone(base);
    data.instructions = { 'part-1': value };
    assert.throws(() => parseProject(JSON.stringify(data)), /manufacturing instructions/);
  }
  const unknown = structuredClone(base);
  unknown.instructions = { orphan: 'Machine this part.' };
  assert.throws(() => parseProject(JSON.stringify(unknown)), /unknown part/);
});
