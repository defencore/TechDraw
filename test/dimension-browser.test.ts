import assert from 'node:assert/strict';
import test from 'node:test';
import type { Dimension } from '../src/model';
import { defaultDimensionFilter, filterDimensions } from '../src/ui/dimension-browser';

const examples: Dimension[] = [
  {
    id: 'hole',
    viewId: 'top',
    kind: 'diameter',
    a: [10, 10],
    b: [13, 10],
    value: 6,
    offset: 10,
    automatic: true,
    tolerance: { kind: 'fit', designation: 'H7' },
    suffix: ' THRU',
  },
  {
    id: 'corner',
    viewId: 'front',
    kind: 'radius',
    a: [0, 0],
    b: [3, 0],
    value: 3,
    offset: 10,
    automatic: false,
    prefix: 'REF ',
    tolerance: { kind: 'symmetric', magnitude: '0.050' },
    suffix: ' Finish AFTER coating',
  },
  {
    id: 'length',
    viewId: 'front',
    kind: 'horizontal',
    a: [0, 0],
    b: [80, 0],
    value: 80,
    offset: 10,
    automatic: true,
  },
  {
    id: 'height',
    viewId: 'right',
    kind: 'vertical',
    a: [0, 0],
    b: [0, 80],
    value: 80,
    offset: 10,
    automatic: false,
    tolerance: { kind: 'deviation', upper: '+0.020', lower: '-0.010' },
  },
];
const matching = (query: string) =>
  filterDimensions(examples, { ...defaultDimensionFilter, query }).map((dimension) => dimension.id);

test('dimension search is case-insensitive across displayed notes and view/type metadata', () => {
  assert.deepEqual(matching('AFTER Coating'), ['corner']);
  assert.deepEqual(matching('front ref'), ['corner']);
  assert.deepEqual(matching('manual'), ['corner', 'height']);
  assert.deepEqual(matching('THRU'), ['hole']);
});

test('diameter symbols and dia abbreviations find the same measured dimension', () => {
  for (const query of ['Ø6', 'ø 6', '⌀6', '∅ 6', 'dia 6', 'DIA.6', 'diameter6'])
    assert.deepEqual(matching(query), ['hole'], query);
  assert.deepEqual(matching('radius'), ['corner']);
});

test('explicit fit and numeric tolerance text remains searchable with its entered precision', () => {
  assert.deepEqual(matching('h7'), ['hole']);
  assert.deepEqual(matching('±0.050'), ['corner']);
  assert.deepEqual(matching('0,050'), ['corner']);
  assert.deepEqual(matching('−0.010'), ['height']);
  assert.deepEqual(matching('+0.020'), ['height']);
});

test('view and kind filters combine with the query rather than replacing it', () => {
  assert.deepEqual(
    filterDimensions(examples, { query: '80', view: 'front', kind: 'horizontal' }).map(
      (dimension) => dimension.id,
    ),
    ['length'],
  );
  assert.deepEqual(
    filterDimensions(examples, { query: '80', view: 'right', kind: 'vertical' }).map(
      (dimension) => dimension.id,
    ),
    ['height'],
  );
  assert.deepEqual(filterDimensions(examples, { query: '', view: 'top', kind: 'radius' }), []);
  assert.deepEqual(filterDimensions(examples, { query: 'h7', view: 'front', kind: 'all' }), []);
});

test('filtering preserves source data, original order and dimension identities', () => {
  const input = structuredClone(examples),
    before = structuredClone(input);
  const filtered = filterDimensions(input, { query: '  ', view: 'all', kind: 'all' });
  assert.notEqual(filtered, input);
  assert.deepEqual(filtered, before);
  assert.equal(filtered[0], input[0]);
  filterDimensions(input, { query: 'no matching note', view: 'front', kind: 'all' });
  assert.deepEqual(input, before);
});
