import assert from 'node:assert/strict';
import test from 'node:test';
import type { Dimension, DrawingAnnotation, Part } from '../src/model';
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
    instructions: {},
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
    instructions: structuredClone(state.instructions),
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

test('locking dimensions and review marks is one explicit undoable operation and generic edits cannot unlock them', () => {
  const { document, part } = fixture();
  const note: DrawingAnnotation = {
    id: 'note',
    kind: 'text',
    points: [[20, 30]],
    text: 'Inspect fit',
    strokeWidth: 0.35,
    color: '#2678d4',
  };
  document.changeAnnotations([note]);
  const selection = { dimensions: new Set(['manual']), annotations: new Set(['note']) };
  const layout = structuredClone(document.layout(part));
  assert.equal(document.setSelectionLocked(selection, true), true);
  const lockedDimensions = structuredClone(document.dimensions),
    lockedAnnotations = structuredClone(document.annotations);
  assert.equal(document.hasLocks, true);
  assert.equal(document.setSelectionLocked(selection, true), false);
  assert.equal(
    document.changeDimensions(
      document.dimensions.map((item) => ({ ...item, offset: 99, locked: false })),
    ),
    false,
  );
  assert.equal(
    document.changeAnnotations(
      document.annotations.map((item) => ({
        ...item,
        color: '#ffffff',
        text: 'Changed',
        locked: false,
      })),
    ),
    false,
  );
  assert.equal(document.changeDimensions([]), false);
  assert.equal(document.changeAnnotations([]), false);
  assert.deepEqual(document.dimensions, lockedDimensions);
  assert.deepEqual(document.annotations, lockedAnnotations);
  assert.equal(document.travel('undo'), true);
  assert.equal(Boolean(document.dimensions[0].locked), false);
  assert.equal(Boolean(document.annotations[0].locked), false);
  assert.equal(document.travel('redo'), true);
  assert.deepEqual(document.dimensions, lockedDimensions);
  assert.deepEqual(document.annotations, lockedAnnotations);
  assert.equal(document.setSelectionLocked(selection, false), true);
  assert.equal(document.hasLocks, false);
  assert.equal(document.travel('undo'), true);
  assert.equal(document.dimensions[0].locked, true);
  assert.equal(document.annotations[0].locked, true);
  assert.deepEqual(document.layout(part), layout);
});

test('mixed generic edits retain omitted locks in source order while committing unlocked changes', () => {
  const { document, dimension } = fixture();
  const fixed: Dimension = { ...dimension, id: 'fixed', offset: 27 };
  const other: Dimension = { ...dimension, id: 'other', offset: 31 };
  document.changeDimensions([dimension, fixed, other]);
  const fixedNote: DrawingAnnotation = {
    id: 'fixed-note',
    kind: 'text',
    points: [[20, 30]],
    text: 'Keep',
    strokeWidth: 0.35,
    color: '#e34d59',
  };
  const editableNote: DrawingAnnotation = { ...fixedNote, id: 'edit-note', text: 'Editable' };
  document.changeAnnotations([editableNote, fixedNote]);
  document.setSelectionLocked(
    { dimensions: new Set(['fixed']), annotations: new Set(['fixed-note']) },
    true,
  );
  const protectedDimension = structuredClone(document.dimensions[1]),
    protectedNote = structuredClone(document.annotations[1]);
  assert.equal(
    document.changeDimensions([
      { ...other, offset: 55 },
      { ...dimension, offset: 60 },
    ]),
    true,
  );
  assert.deepEqual(
    document.dimensions.map((item) => item.id),
    ['other', 'fixed', 'manual'],
  );
  assert.deepEqual(document.dimensions[1], protectedDimension);
  assert.equal(document.changeAnnotations([{ ...editableNote, text: 'Updated' }]), true);
  assert.deepEqual(document.annotations[1], protectedNote);
  assert.equal(document.annotations[0].text, 'Updated');
});

test('active locks refuse reflow and preserve cached physical geometry, while another unlocked part can arrange', () => {
  const { document, state, part } = fixture();
  const layout = structuredClone(document.layout(part));
  document.setSelectionLocked({ dimensions: new Set(['manual']), annotations: new Set() }, true);
  assert.equal(document.changeDimensions(document.dimensions, { arrange: true }), false);
  assert.deepEqual(document.layout(part), layout);
  const other: Part = { ...structuredClone(part), id: 'other' };
  document.addPart(other);
  state.activeId = other.id;
  document.layout(other);
  assert.equal(document.changeDimensions(document.dimensions, { arrange: true }), true);
  document.layout(other);
  assert.deepEqual(state.layouts[part.id], layout);
  state.activeId = part.id;
  state.settings.format = 'A1';
  assert.deepEqual(
    document.layout(part),
    layout,
    'direct settings mutations cannot move an already locked cached drawing',
  );
});

test('instructions invalidate only their own unlocked layout and undo restores text with the original physical drawing', () => {
  const { document, state, part } = fixture();
  const layout = structuredClone(document.layout(part));
  const next = 'Deburr edges. Inspect the bore after finishing.';
  assert.equal(document.setInstructions(part.id, next), true);
  assert.equal(document.getInstructions(part.id), next);
  assert.equal(state.layouts[part.id], undefined);
  assert.equal(document.setInstructions(part.id, next), false);
  assert.equal(document.travel('undo'), true);
  assert.equal(document.getInstructions(part.id), '');
  assert.deepEqual(document.layout(part), layout);
  assert.equal(document.travel('redo'), true);
  assert.equal(document.getInstructions(part.id), next);
  assert.equal(state.layouts[part.id], undefined);
});

test('editing a non-active part records that part history and leaves the active part untouched', () => {
  const { document, state, part } = fixture();
  const other: Part = { ...structuredClone(part), id: 'other' };
  document.addPart(other);
  const otherLayout = document.layout(other);
  const activeLayout = structuredClone(document.layout(part));
  assert.equal(state.activeId, part.id);
  assert.equal(document.setInstructions(other.id, 'Machine the second element.'), true);
  assert.equal(state.activeId, part.id);
  assert.equal(document.getInstructions(part.id), '');
  assert.deepEqual(document.layout(part), activeLayout);
  assert.equal(document.history?.canUndo, false);
  state.activeId = other.id;
  assert.equal(document.travel('undo'), true);
  assert.equal(document.getInstructions(other.id), '');
  assert.deepEqual(document.layout(other), otherLayout);
});

test('instructions retain locked layouts exactly, remain independently undoable and validate direct API input', () => {
  const { document, part } = fixture();
  const layout = structuredClone(document.layout(part));
  document.setSelectionLocked({ dimensions: new Set(['manual']), annotations: new Set() }, true);
  const locked = structuredClone(document.dimensions);
  assert.equal(document.setInstructions(part.id, 'Inspect every hole before assembly.'), true);
  assert.deepEqual(document.layout(part), layout);
  assert.deepEqual(document.dimensions, locked);
  assert.equal(document.travel('undo'), true);
  assert.equal(document.getInstructions(part.id), '');
  assert.deepEqual(document.dimensions, locked);
  assert.deepEqual(document.layout(part), layout);
  assert.throws(() => document.setInstructions(part.id, '\uD800'), /manufacturing instructions/);
  assert.throws(
    () => document.setInstructions(part.id, 'x'.repeat(20001)),
    /manufacturing instructions/,
  );
  assert.equal(document.setInstructions('unknown', 'Do not create orphan data.'), false);
});

test('dimension and markup history preserve instructions, and part removal clears only its instructions', () => {
  const { document, state, part, dimension } = fixture();
  document.setInstructions(part.id, 'Keep this instruction.');
  document.changeDimensions([{ ...dimension, offset: 24 }]);
  document.travel('undo');
  assert.equal(document.getInstructions(part.id), 'Keep this instruction.');
  document.changeAnnotations([
    { id: 'note', kind: 'text', points: [[20, 30]], text: 'Review', strokeWidth: 0.3 },
  ]);
  document.travel('undo');
  assert.equal(document.getInstructions(part.id), 'Keep this instruction.');
  document.removePart(part.id);
  assert.deepEqual(state.instructions, {});
});
