import assert from 'node:assert/strict';
import test from 'node:test';
import type { Dimension, Part } from '../src/model';
import { defaultSettings, type WorkspaceState } from '../src/state';
import { WorkspaceDocument } from '../src/workspace-document';

function fixture() {
  const state: WorkspaceState = {
    description: '',
    parts: [],
    selected: new Set(),
    activeId: null,
    dimensions: {},
    annotations: {},
    layouts: {},
    settings: { ...defaultSettings, scale: 1 },
  };
  const document = new WorkspaceDocument(state);
  const part: Part = {
    id: 'part',
    name: 'Plate',
    sourceName: 'plate.step',
    path: ['plate'],
    unit: 'mm',
    bounds: { min: [0, 0, 0], max: [40, 20, 10] },
    warnings: [],
    views: (['front', 'top', 'right', 'iso'] as const).map((id) => ({
      id,
      name: id,
      bounds: { minX: 0, minY: 0, maxX: 40, maxY: 20 },
      edges: [],
    })),
  };
  document.addPart(part);
  state.activeId = part.id;
  document.layout(part);
  const dimension: Dimension = {
    id: 'manual',
    viewId: 'front',
    kind: 'horizontal',
    a: [0, 0],
    b: [40, 0],
    value: 40,
    offset: 10,
    automatic: false,
    tolerance: { kind: 'fit', designation: 'H7' },
  };
  document.changeDimensions([dimension], { record: false });
  return { state, document, part, dimension };
}

test('document edits preserve frozen layout and own independent reversible dimensions', () => {
  const { document, part, dimension } = fixture();
  const layout = structuredClone(document.layout(part));
  const next = structuredClone(document.dimensions);
  next[0].offset = -25;
  assert.equal(document.changeDimensions(next), true);
  next[0].a[0] = 99;
  assert.equal(document.dimensions[0].a[0], 0);
  assert.deepEqual(document.layout(part), layout);
  assert.equal(document.travel('undo'), true);
  assert.deepEqual(document.dimensions, [dimension]);
  assert.equal(document.travel('redo'), true);
  assert.equal(document.dimensions[0].offset, -25);
  assert.deepEqual(document.dimensions[0].tolerance, dimension.tolerance);
});

test('no-op edits do not consume undo history; a real edit after undo drops redo', () => {
  const { document } = fixture();
  assert.equal(document.changeDimensions(structuredClone(document.dimensions)), false);
  assert.equal(document.history?.canUndo, false);
  document.changeDimensions(document.dimensions.map((d) => ({ ...d, offset: 20 })));
  document.travel('undo');
  document.changeDimensions(document.dimensions.map((d) => ({ ...d, offset: 30 })));
  assert.equal(document.travel('redo'), false);
  assert.equal(document.dimensions[0].offset, 30);
});

test('sheet changes invalidate history layouts without discarding annotation specifications', () => {
  const { document, state, part } = fixture();
  const oldLayout = structuredClone(document.layout(part));
  document.changeDimensions(document.dimensions.map((d) => ({ ...d, offset: 20 })));
  state.settings.format = 'A2';
  document.layout(part);
  document.travel('undo');
  assert.equal(state.layouts[part.id], undefined);
  assert.notDeepEqual(document.layout(part), oldLayout);
  assert.equal(document.dimensions[0].offset, 10);
  assert.deepEqual(document.dimensions[0].tolerance, { kind: 'fit', designation: 'H7' });
});

test('opening a project retains its exact layouts and resets document history', () => {
  const { document, state, part } = fixture();
  const saved = structuredClone(document.layout(part));
  saved.viewTransforms.front.x += 13;
  document.changeDimensions(document.dimensions.map((d) => ({ ...d, offset: 20 })));
  document.replace({
    description: '',
    parts: [part],
    dimensions: structuredClone(state.dimensions),
    annotations: structuredClone(state.annotations),
    layouts: { part: saved },
    settings: { ...state.settings },
    selected: ['part'],
  });
  assert.deepEqual(document.layout(part), saved);
  assert.equal(document.history?.canUndo, false);
});

test('removing a part clears its geometry, selection, layout and history ownership', () => {
  const { document, state, part } = fixture();
  document.layout(part);
  document.changeDimensions(document.dimensions.map((d) => ({ ...d, offset: 20 })));
  document.removePart('part');
  assert.equal(state.activeId, null);
  assert.equal(document.active, undefined);
  assert.equal(document.history, undefined);
  assert.deepEqual(state.dimensions, {});
  assert.deepEqual(state.layouts, {});
  assert.deepEqual(state.annotations, {});
  assert.equal(state.selected.size, 0);
});

test('review notes and graphics share undo history with dimensions without changing frozen view geometry', () => {
  const { document, part, dimension } = fixture();
  const layout = structuredClone(document.layout(part));
  const note = {
    id: 'note',
    kind: 'text' as const,
    points: [[20, 30] as [number, number]],
    text: 'Review fit',
    fontSize: 3.5,
    strokeWidth: 0.35,
  };
  assert.equal(document.changeAnnotations([note]), true);
  note.points[0][0] = 99;
  assert.equal(document.annotations[0].points[0][0], 20);
  document.changeDimensions([{ ...dimension, offset: 25 }]);
  assert.equal(document.travel('undo'), true);
  assert.equal(document.annotations.length, 1);
  assert.equal(document.dimensions[0].offset, 10);
  assert.equal(document.travel('undo'), true);
  assert.equal(document.annotations.length, 0);
  assert.equal(document.travel('redo'), true);
  assert.equal(document.annotations[0].text, 'Review fit');
  assert.deepEqual(document.layout(part), layout);
  assert.equal(document.changeAnnotations(structuredClone(document.annotations)), false);
  assert.equal(document.changeAnnotations([]), true);
  assert.equal(document.travel('undo'), true);
  assert.equal(document.annotations[0].points[0][0], 20);
});
