import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeToleranceNumber,
  parseDimensionTolerance,
  parseToleranceNumber,
  tryParseDimensionTolerance,
} from '../src/drawing/tolerances';

test('canonical tolerance decimals retain explicit precision and support signed deviations', () => {
  for (const [text, expected] of [
    ['0', 0],
    ['+0.050', 0.05],
    ['-0.050', -0.05],
    ['0.000000001', 1e-9],
    ['1000000.000000000', 1e6],
    ['-1000000', -1e6],
  ] as const)
    assert.equal(parseToleranceNumber(text), expected);
  for (const value of [
    '',
    ' ',
    '0,05',
    '.05',
    '01.05',
    '1.',
    '1e-3',
    'NaN',
    'Infinity',
    '0.0000000001',
    '1000000.000000001',
    '-1000000.000000001',
    '0'.repeat(33),
    '1\n',
    0.05,
    null,
    undefined,
  ])
    assert.equal(
      parseToleranceNumber(value),
      undefined,
      `${JSON.stringify(value)} must not be accepted as stored decimal text`,
    );
});

test('completed UI decimals accept a comma and leading dot without losing fractional zeros', () => {
  assert.equal(normalizeToleranceNumber('  +0,050  '), '+0.050');
  assert.equal(normalizeToleranceNumber('-.0500'), '-0.0500');
  assert.equal(normalizeToleranceNumber('−0,0500'), '-0.0500');
  assert.equal(normalizeToleranceNumber('000,0500'), '0.0500');
  assert.equal(normalizeToleranceNumber('005'), '5');
  for (const value of [
    '',
    '-',
    '+',
    '.',
    '0.',
    '1e-3',
    '0,1,2',
    '1 000',
    '1000001',
    '0.0000000001',
  ])
    assert.equal(normalizeToleranceNumber(value), undefined);
});

test('symmetric and asymmetric tolerances validate order and preserve written precision', () => {
  assert.deepEqual(parseDimensionTolerance({ kind: 'symmetric', magnitude: '+0.050' }), {
    kind: 'symmetric',
    magnitude: '0.050',
  });
  assert.deepEqual(parseDimensionTolerance({ kind: 'symmetric', magnitude: '-0.000' }), {
    kind: 'symmetric',
    magnitude: '0.000',
  });
  for (const limits of [
    { upper: '+0.040', lower: '-0.020' },
    { upper: '-0.010', lower: '-0.030' },
    { upper: '+0.030', lower: '+0.010' },
    { upper: '0', lower: '0' },
  ])
    assert.deepEqual(parseDimensionTolerance({ kind: 'deviation', ...limits }), {
      kind: 'deviation',
      ...limits,
    });
  assert.throws(
    () => parseDimensionTolerance({ kind: 'symmetric', magnitude: '-0.05' }),
    /cannot be negative/,
  );
  assert.throws(
    () => parseDimensionTolerance({ kind: 'deviation', upper: '-0.1', lower: '0.1' }),
    /greater than or equal/,
  );
  assert.throws(
    () => parseDimensionTolerance({ kind: 'deviation', upper: '0.1', lower: '' }),
    /Lower deviation/,
  );
});

test('fit designations remain manual text and only syntactically valid ASCII fields are accepted', () => {
  for (const designation of ['H7', 'h6', 'JS7', 'js6', 'H7/g6', 'H01', 'h0', 'H99'])
    assert.deepEqual(parseDimensionTolerance({ kind: 'fit', designation }), {
      kind: 'fit',
      designation,
    });
  for (const designation of [
    'H7 / g6',
    'H7+g6',
    'H7/g6/h8',
    'H',
    '7',
    'H777',
    'WORD7',
    'H7<script>',
    'Н7',
    'H7\n',
    'H'.repeat(25),
  ])
    assert.throws(() => parseDimensionTolerance({ kind: 'fit', designation }), /fit designation/);
});

test('tolerance parsing rejects invalid shapes and strips unsupported object properties', () => {
  for (const value of [
    null,
    undefined,
    [],
    '±0.05',
    {},
    { kind: 'none' },
    { kind: 'symmetric', magnitude: 0.05 },
  ]) {
    assert.throws(() => parseDimensionTolerance(value), /Invalid dimension tolerance/);
    assert.equal(tryParseDimensionTolerance(value), undefined);
  }
  const source = {
    kind: 'deviation',
    upper: '+0.050',
    lower: '-0.010',
    style: '<script>',
    units: 'ignored',
  };
  const parsed = parseDimensionTolerance(source);
  assert.deepEqual(parsed, { kind: 'deviation', upper: '+0.050', lower: '-0.010' });
  assert.notEqual(parsed, source);
  assert.deepEqual(tryParseDimensionTolerance(source), parsed);
});
