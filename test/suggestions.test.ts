import test from 'node:test';
import assert from 'node:assert/strict';
import type { Dimension } from '../src/model';
import { mergeDimensionSuggestions } from '../src/drawing/suggestions';

const linear = (id: string, value = 80): Dimension => ({
  id,
  kind: 'horizontal',
  viewId: 'front',
  a: [0, 0],
  b: [value, 0],
  value,
  offset: 9,
  automatic: true,
});

test('refreshing suggestions keeps manual geometry and exact tolerance text while replacing obsolete automatic measurements', () => {
  const manual = {
    ...linear('manual', 35),
    automatic: false,
    offset: -20,
    tolerance: { kind: 'fit' as const, designation: 'H7' },
  };
  const specified = {
    ...linear('old-overall'),
    tolerance: { kind: 'deviation' as const, upper: '0.100', lower: '-0.025' },
    prefix: 'REF ',
    suffix: ' finish after coating',
  };
  const current = [manual, specified, linear('old-obsolete', 15)];
  const original = structuredClone(current);
  const result = mergeDimensionSuggestions(current, [
    linear('new-overall'),
    linear('new-length', 60),
  ]);
  assert.deepEqual(result.dimensions[0], manual);
  assert.equal(result.dimensions.find((dimension) => dimension.value === 80)?.id, 'old-overall');
  assert.deepEqual(
    result.dimensions.find((dimension) => dimension.value === 80)?.tolerance,
    specified.tolerance,
  );
  assert.equal(
    result.dimensions.find((dimension) => dimension.value === 80)?.suffix,
    specified.suffix,
  );
  assert.equal(
    result.dimensions.some((dimension) => dimension.id === 'old-obsolete'),
    false,
  );
  assert.deepEqual(current, original);
  assert.equal(result.preservedManual, 1);
  assert.equal(result.preservedSpecifications, 1);
});

test('a manually authored measurement suppresses the same suggestion without losing its placement', () => {
  const manual = { ...linear('manual'), automatic: false, offset: -18 };
  const result = mergeDimensionSuggestions([manual], [linear('new')]);
  assert.deepEqual(result.dimensions, [manual]);
});

test('refresh never discards an existing specification when a matching manual dimension has no tolerance', () => {
  const manual = { ...linear('manual'), automatic: false };
  const specified = {
    ...linear('specified'),
    tolerance: { kind: 'fit' as const, designation: 'H7' },
  };
  const result = mergeDimensionSuggestions([manual, specified], [linear('new')]);
  assert.equal(result.dimensions.length, 2);
  assert.deepEqual(
    result.dimensions.find((dimension) => dimension.id === 'specified')?.tolerance,
    specified.tolerance,
  );
});

test('a specification on a retired automatic measurement becomes an explicit retained dimension and never collides with new serial IDs', () => {
  const retired = {
    ...linear('auto-0', 35),
    tolerance: { kind: 'symmetric' as const, magnitude: '0.050' },
  };
  const result = mergeDimensionSuggestions([retired], [linear('auto-0', 80)]);
  const protectedDimension = result.dimensions.find((dimension) => dimension.value === 35)!;
  assert.equal(protectedDimension.automatic, false);
  assert.deepEqual(protectedDimension.tolerance, retired.tolerance);
  assert.equal(
    new Set(result.dimensions.map((dimension) => dimension.id)).size,
    result.dimensions.length,
  );
});

test('a different suggested measurement never inherits a retired annotation identity or its pending editor draft', () => {
  const result = mergeDimensionSuggestions([linear('auto-0', 15)], [linear('auto-0', 80)]);
  assert.equal(result.dimensions.length, 1);
  assert.notEqual(result.dimensions[0].id, 'auto-0');
  assert.equal(result.dimensions[0].value, 80);
  const next = mergeDimensionSuggestions(result.dimensions, [linear('auto-0', 60)]);
  assert.notEqual(next.dimensions[0].id, 'auto-0');
  assert.notEqual(next.dimensions[0].id, result.dimensions[0].id);
  const again = mergeDimensionSuggestions(next.dimensions, [linear('auto-0', 60)]);
  assert.equal(again.dimensions[0].id, next.dimensions[0].id);
});

test('grouped hole specifications survive selecting a clearer representative edge, while individual manual hole dimensions do not erase a group callout', () => {
  const old: Dimension = {
    id: 'holes',
    kind: 'diameter',
    viewId: 'top',
    a: [12, 12],
    b: [15, 12],
    value: 6,
    offset: 10,
    automatic: true,
    suffix: ' (4x)',
    tolerance: { kind: 'fit', designation: 'H7' },
  };
  const fresh = {
    ...structuredClone(old),
    id: 'new-holes',
    a: [68, 38] as [number, number],
    b: [71, 38] as [number, number],
  };
  delete fresh.tolerance;
  const individual = {
    ...structuredClone(old),
    id: 'manual-hole',
    automatic: false,
    suffix: undefined,
  };
  const result = mergeDimensionSuggestions([old, individual], [fresh]);
  assert.equal(result.dimensions.length, 2);
  assert.deepEqual(result.dimensions.find((dimension) => dimension.automatic)?.a, fresh.a);
  assert.deepEqual(
    result.dimensions.find((dimension) => dimension.automatic)?.tolerance,
    old.tolerance,
  );
  assert.equal(result.dimensions.find((dimension) => dimension.automatic)?.id, old.id);
  const custom = { ...old, suffix: ' THRU' };
  const customized = mergeDimensionSuggestions([custom], [fresh]);
  assert.equal(customized.dimensions.length, 1);
  assert.equal(customized.dimensions[0].id, custom.id);
  assert.equal(customized.dimensions[0].suffix, ' THRU');
  assert.deepEqual(customized.dimensions[0].tolerance, old.tolerance);
  for (const suffix of [' (2x)', '']) {
    const editedQuantity = { ...old, suffix };
    delete editedQuantity.tolerance;
    const refreshed = mergeDimensionSuggestions([editedQuantity], [fresh]);
    assert.equal(refreshed.dimensions.length, 1);
    assert.equal(refreshed.dimensions[0].suffix, suffix);
    assert.equal(refreshed.dimensions[0].id, old.id);
    assert.equal(refreshed.preservedSpecifications, 1);
  }
});

test('refresh retains locked automatic dimensions wholesale and keeps retired locked measurements', () => {
  const locked: Dimension = {
    ...linear('locked'),
    locked: true,
    offset: -32,
    textOffset: [12, 4],
    tolerance: { kind: 'fit', designation: 'H7' },
  };
  const retired: Dimension = { ...linear('retired', 35), locked: true, offset: 27 };
  const current = [locked, retired];
  const before = structuredClone(current);
  const result = mergeDimensionSuggestions(current, [linear('fresh'), linear('new', 50)]);
  assert.deepEqual(
    result.dimensions.find((dimension) => dimension.id === 'locked'),
    locked,
  );
  assert.deepEqual(
    result.dimensions.find((dimension) => dimension.id === 'retired'),
    retired,
  );
  assert.equal(result.dimensions.filter((dimension) => dimension.value === 80).length, 1);
  assert.deepEqual(current, before);
});

test('locked radius callouts retain their exact attachment when a new suggestion chooses another point on the same circle', () => {
  const locked: Dimension = {
    id: 'radius',
    viewId: 'front',
    kind: 'radius',
    a: [10, 10],
    b: [15, 10],
    value: 5,
    offset: -20,
    automatic: true,
    locked: true,
  };
  const suggestion: Dimension = {
    ...locked,
    id: 'new-radius',
    b: [10, 15],
    offset: 10,
    locked: undefined,
  };
  assert.deepEqual(mergeDimensionSuggestions([locked], [suggestion]).dimensions, [locked]);
  const manual = { ...locked, automatic: false };
  assert.deepEqual(mergeDimensionSuggestions([manual], [suggestion]).dimensions, [manual]);
});
