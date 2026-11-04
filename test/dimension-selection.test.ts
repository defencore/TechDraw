import assert from 'node:assert/strict';
import test from 'node:test';
import { DimensionSelection } from '../src/ui/dimension-selection';

test('focusing a selected annotation preserves its group for dragging', () => {
  const selection = new DimensionSelection();
  selection.select('width');
  selection.select('height', true);
  selection.select('width');
  assert.deepEqual([...selection.ids], ['width', 'height']);
  assert.equal(selection.focus, 'width');
  selection.select('diameter');
  assert.deepEqual([...selection.ids], ['diameter']);
  assert.equal(selection.focus, 'diameter');
});

test('additive toggle repairs focus without clearing other annotations', () => {
  const selection = new DimensionSelection();
  selection.replace(['first', 'second', 'third']);
  selection.select('second', true);
  assert.deepEqual([...selection.ids], ['first', 'third']);
  assert.equal(selection.focus, 'third');
  selection.select('third', true);
  assert.equal(selection.focus, 'first');
  selection.select('first', true);
  assert.equal(selection.focus, undefined);
  assert.equal(selection.ids.size, 0);
});

test('checkbox state is idempotent and can focus any member explicitly', () => {
  const selection = new DimensionSelection();
  selection.set('width', true);
  selection.set('height', true);
  selection.set('width', true);
  assert.deepEqual([...selection.ids], ['width', 'height']);
  assert.equal(selection.focus, 'width');
  selection.set('width', false);
  selection.set('width', false);
  assert.equal(selection.focus, 'height');
  assert.deepEqual([...selection.ids], ['height']);
});

test('replace and retain prevent stale focus after regeneration, delete and undo', () => {
  const selection = new DimensionSelection();
  selection.replace(['first', 'second', 'second', 'third'], 'second');
  selection.retain(['first', 'third', 'new']);
  assert.deepEqual([...selection.ids], ['first', 'third']);
  assert.equal(selection.focus, 'third');
  selection.retain(['first']);
  assert.equal(selection.focus, 'first');
  selection.retain([]);
  assert.equal(selection.focus, undefined);
  selection.replace(['new'], 'stale');
  assert.equal(selection.focus, 'new');
  selection.replace([]);
  assert.equal(selection.focus, undefined);
});

test('empty plain selection clears the group while an additive empty hit keeps it', () => {
  const selection = new DimensionSelection();
  selection.replace(['width', 'height']);
  selection.select(undefined, true);
  assert.equal(selection.ids.size, 2);
  selection.select();
  assert.equal(selection.focus, undefined);
  assert.equal(selection.ids.size, 0);
  selection.replace(['width']);
  selection.clear();
  assert.equal(selection.ids.size, 0);
  assert.equal(selection.focus, undefined);
});
