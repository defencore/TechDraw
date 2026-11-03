import assert from 'node:assert/strict';
import test from 'node:test';
import { DimensionHistory, type DimensionSnapshot } from '../src/state';

function snapshot(offset: number, scale = 1): DimensionSnapshot {
  return {
    dimensions: [
      {
        id: 'width',
        viewId: 'front',
        kind: 'horizontal',
        a: [0, 0],
        b: [40, 0],
        value: 40,
        offset,
        textOffset: [3, 2],
        automatic: false,
      },
    ],
    layout: {
      scale,
      viewTransforms: {
        front: { x: 205, y: 70, scale },
        top: { x: 205, y: 160, scale },
        right: { x: 80, y: 70, scale },
        iso: { x: 80, y: 160, scale },
      },
    },
  };
}

test('undo and redo restore both dimensions and layout after automatic reflow', () => {
  const history = new DimensionHistory();
  const manual = snapshot(27.125, 1);
  manual.layout!.viewTransforms.front.x = 213.5;
  const automatic = snapshot(12, 0.5);
  automatic.dimensions[0].automatic = true;
  automatic.layout!.viewTransforms.front.x = 190;
  history.record(manual);
  const restored = history.undo(automatic)!;
  assert.deepEqual(restored, manual);
  assert.equal(history.canUndo, false);
  assert.equal(history.canRedo, true);
  assert.deepEqual(history.redo(restored), automatic);
  assert.equal(history.canUndo, true);
  assert.equal(history.canRedo, false);
});

test('manual editing history owns independent dimension points, labels and view transforms', () => {
  const history = new DimensionHistory();
  const before = snapshot(10),
    expectedBefore = structuredClone(before);
  const after = snapshot(25),
    expectedAfter = structuredClone(after);
  history.record(before);
  before.dimensions[0].a[0] = 999;
  before.dimensions[0].textOffset![0] = 999;
  before.layout!.viewTransforms.front.x = 999;
  const restored = history.undo(after)!;
  assert.deepEqual(restored, expectedBefore);
  after.dimensions[0].offset = 999;
  after.layout!.viewTransforms.front.y = 999;
  const redone = history.redo(restored)!;
  assert.deepEqual(redone, expectedAfter);
  restored.dimensions[0].offset = -999;
  restored.layout!.viewTransforms.front.x = -999;
  assert.deepEqual(history.undo(redone), expectedBefore);
});

test('a new edit after undo clears the obsolete redo branch', () => {
  const history = new DimensionHistory();
  history.record(snapshot(10));
  const restored = history.undo(snapshot(20))!;
  assert.equal(history.canRedo, true);
  history.record(restored);
  assert.equal(history.canRedo, false);
  assert.equal(history.redo(snapshot(30)), undefined);
  assert.deepEqual(history.undo(snapshot(30)), snapshot(10));
});

test('snapshots without cached layouts remain reversible', () => {
  const history = new DimensionHistory();
  const before: DimensionSnapshot = { dimensions: [] };
  const after = snapshot(20);
  history.record(before);
  const restored = history.undo(after)!;
  assert.deepEqual(restored, before);
  assert.equal(restored.layout, undefined);
  assert.deepEqual(history.redo(restored), after);
});

test('changing paper invalidates old undo layouts without discarding annotation edits', () => {
  const history = new DimensionHistory();
  const before = snapshot(10),
    after = snapshot(25);
  history.record(before);
  history.invalidateLayouts();
  const currentPaper = snapshot(25, 0.5);
  currentPaper.layout!.viewTransforms.front.x = 100;
  const restored = history.undo(currentPaper)!;
  assert.deepEqual(restored.dimensions, before.dimensions);
  assert.equal(
    restored.layout,
    undefined,
    'The old wide-sheet layout must be regenerated for the new paper',
  );
  assert.equal(
    before.layout!.viewTransforms.front.x,
    205,
    'Invalidation must not mutate the caller-owned snapshot',
  );
  assert.equal(history.canRedo, true);
  const regenerated = { ...restored, layout: currentPaper.layout };
  assert.deepEqual(
    history.redo(regenerated),
    currentPaper,
    'New-paper layouts remain valid in later history operations',
  );
  assert.deepEqual(after.dimensions, currentPaper.dimensions);
});

test('changing paper also invalidates layouts already waiting in the redo branch', () => {
  const history = new DimensionHistory();
  const before = snapshot(10),
    after = snapshot(25);
  history.record(before);
  const restored = history.undo(after)!;
  history.invalidateLayouts();
  const newPaper = snapshot(10, 0.5);
  newPaper.layout!.viewTransforms.front.x = 100;
  const redone = history.redo(newPaper)!;
  assert.deepEqual(redone.dimensions, after.dimensions);
  assert.equal(redone.layout, undefined, 'Redo must not resurrect an obsolete paper layout');
  assert.deepEqual(history.undo({ ...redone, layout: newPaper.layout }), newPaper);
  assert.deepEqual(
    restored,
    before,
    'Previously returned snapshots are independent of later invalidation',
  );
});

test('history retains the latest sixty operations and can redo them in order', () => {
  const history = new DimensionHistory();
  for (let offset = 0; offset < 65; offset++) history.record(snapshot(offset));
  let current = snapshot(65);
  for (let offset = 64; offset >= 5; offset--) {
    current = history.undo(current)!;
    assert.equal(current.dimensions[0].offset, offset);
  }
  assert.equal(history.canUndo, false);
  assert.equal(history.undo(current), undefined);
  for (let offset = 6; offset <= 65; offset++) {
    current = history.redo(current)!;
    assert.equal(current.dimensions[0].offset, offset);
  }
  assert.equal(history.canRedo, false);
});
