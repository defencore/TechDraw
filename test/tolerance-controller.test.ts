import assert from 'node:assert/strict';
import test from 'node:test';
import type { Dimension } from '../src/model';
import { DimensionHistory } from '../src/state';
import { ToleranceEditorController, type ToleranceSelection } from '../src/ui/tolerance-controller';

const dimension = (id = 'dimension'): Dimension => ({
  id,
  kind: 'horizontal',
  viewId: 'front',
  value: 10,
  a: [0, 0],
  b: [10, 0],
  offset: 10,
  automatic: false,
});

function workspace() {
  let selection: ToleranceSelection | undefined = { partId: 'part', dimension: dimension() };
  let commits = 0;
  const errors: string[] = [];
  const history = new DimensionHistory();
  const controller = new ToleranceEditorController({
    getSelection: () => selection,
    precision: () => 2,
    commit(current, tolerance) {
      history.record({ dimensions: [current.dimension] });
      const edited = structuredClone(current.dimension);
      if (tolerance) edited.tolerance = tolerance;
      else delete edited.tolerance;
      selection = { ...current, dimension: edited };
      commits++;
    },
    reportError: (message) => errors.push(message),
  });
  return {
    controller,
    history,
    errors,
    select: (next: ToleranceSelection | undefined) => {
      selection = next;
    },
    selection: () => selection,
    commits: () => commits,
  };
}

test('partial signed values and inactive modes survive inspector unmount and selection changes', () => {
  const app = workspace(),
    editor = app.controller;
  editor.setMode('deviation');
  editor.setField('upper', '+');
  editor.setField('lower', '-0.');
  editor.setMode('symmetric');
  editor.setField('magnitude', '0.');
  editor.setMode('deviation');
  assert.deepEqual(editor.draft()?.fields, {
    magnitude: '0.',
    upper: '+',
    lower: '-0.',
    designation: '',
  });
  const first = app.selection()!;
  app.select(undefined);
  editor.restore();
  app.select({ partId: 'second-part', dimension: dimension() });
  editor.setMode('fit');
  editor.setField('designation', 'H7/');
  app.select(first);
  editor.restore();
  assert.equal(editor.draft()?.mode, 'deviation');
  assert.equal(editor.draft()?.fields.lower, '-0.');
  app.select({ partId: 'second-part', dimension: dimension() });
  assert.equal(editor.draft()?.fields.designation, 'H7/');
  assert.equal(app.commits(), 0);
  assert.equal(first.dimension.tolerance, undefined);
});

test('invalid draft never changes a dimension or its undo history', () => {
  const app = workspace(),
    editor = app.controller;
  editor.setMode('deviation');
  editor.setField('upper', '-0.10');
  editor.setField('lower', '+0.10');
  editor.apply();
  assert.equal(app.commits(), 0);
  assert.equal(app.history.canUndo, false);
  assert.equal(app.selection()!.dimension.tolerance, undefined);
  assert.match(app.errors[0], /greater than or equal/);
  assert.equal(editor.draft()?.fields.upper, '-0.10');
  editor.setField('upper', '+');
  editor.apply();
  assert.equal(app.commits(), 0);
  assert.equal(editor.draft()?.fields.upper, '+');
});

test('Apply commits completed values once, preserves nominal geometry, and resets the draft', () => {
  const app = workspace(),
    editor = app.controller;
  const before = structuredClone(app.selection()!.dimension);
  editor.setMode('symmetric');
  editor.setField('magnitude', '0,050');
  editor.apply();
  assert.equal(app.commits(), 1);
  assert.deepEqual(app.selection()!.dimension, {
    ...before,
    tolerance: { kind: 'symmetric', magnitude: '0.050' },
  });
  assert.equal(editor.draft()?.fields.magnitude, '0.050');
  editor.apply();
  assert.equal(app.commits(), 1);
  const previous = app.history.undo({ dimensions: [app.selection()!.dimension] })!;
  assert.deepEqual(previous.dimensions[0], before);
  app.select({ partId: 'part', dimension: previous.dimensions[0] });
  assert.equal(editor.draft()?.mode, 'none');
});

test('Clear removes an applied tolerance in one undoable operation and clears partial inputs', () => {
  const app = workspace(),
    editor = app.controller;
  editor.setMode('fit');
  editor.setField('designation', 'H7');
  editor.apply();
  editor.setMode('deviation');
  editor.setField('upper', '+');
  editor.apply(true);
  assert.equal(app.commits(), 2);
  assert.equal(app.selection()!.dimension.tolerance, undefined);
  assert.equal(editor.draft()?.mode, 'none');
  assert.equal(editor.draft()?.fields.upper, '');
  const previous = app.history.undo({ dimensions: [app.selection()!.dimension] })!;
  assert.deepEqual(previous.dimensions[0].tolerance, { kind: 'fit', designation: 'H7' });
});

test('removed dimensions, removed parts and opened projects cannot inherit abandoned drafts', () => {
  const app = workspace(),
    editor = app.controller;
  editor.setMode('symmetric');
  editor.setField('magnitude', '0.');
  editor.clearDimension('part', 'dimension');
  assert.equal(editor.draft()?.mode, 'none');
  editor.setMode('fit');
  editor.setField('designation', 'H7/');
  editor.clearPart('part');
  assert.equal(editor.draft()?.fields.designation, '');
  editor.setMode('deviation');
  editor.setField('lower', '-');
  editor.reset();
  assert.equal(editor.draft()?.mode, 'none');
  assert.equal(app.commits(), 0);
});

test('an angular dimension cannot switch to a fit, while numeric angular deviations remain editable', () => {
  const app = workspace(),
    editor = app.controller;
  app.select({ partId: 'part', dimension: { ...dimension(), kind: 'angle', value: 45 } });
  editor.setMode('fit');
  assert.equal(editor.draft()?.mode, 'none');
  editor.setMode('symmetric');
  editor.setField('magnitude', '0.5');
  editor.apply();
  assert.equal(app.selection()!.dimension.value, 45);
  assert.deepEqual(app.selection()!.dimension.tolerance, { kind: 'symmetric', magnitude: '0.5' });
});
