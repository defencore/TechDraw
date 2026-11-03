import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLinearDimension, measureAngle } from '../src/measurements';
import type { Point2, ProjectedEdge } from '../src/model';

const line = (a: Point2, b: Point2): ProjectedEdge => ({
  id: 'test',
  kind: 'line',
  hidden: false,
  points: [a, b],
  sourcePoints: [
    [a[0], 0, a[1]],
    [b[0], 0, b[1]],
  ],
});

test('linear dimensions use exact model coordinates and true-length source evidence', () => {
  assert.equal(createLinearDimension('front', [0, 0], [3, 4], 'horizontal').value, 3);
  assert.equal(createLinearDimension('front', [0, 0], [3, 4], 'vertical').value, 4);
  assert.equal(
    createLinearDimension('front', [0, 0], [3, 4], 'aligned', [0, 2, 0], [3, 2, 4]).value,
    5,
  );
  assert.equal(
    createLinearDimension('top', [0, 0], [3, -4], 'aligned', [0, 0, 2], [3, 4, 2]).value,
    5,
  );
  assert.equal(
    createLinearDimension('right', [0, 0], [-3, 4], 'aligned', [2, 0, 0], [2, 3, 4]).value,
    5,
  );
});

test('aligned measurements reject foreshortening and unverifiable projected geometry', () => {
  assert.throws(
    () => createLinearDimension('front', [0, 0], [3, 4], 'aligned', [0, 0, 0], [3, 12, 4]),
    /foreshortened/,
  );
  assert.throws(
    () => createLinearDimension('front', [0, 0], [3, 4], 'aligned'),
    /cannot be verified/,
  );
  assert.throws(
    () => createLinearDimension('iso', [0, 0], [3, 4], 'horizontal'),
    /orthographic|front/,
  );
  assert.throws(
    () => createLinearDimension('front', [0, 0], [0, 4], 'horizontal'),
    /zero distance/,
  );
});

test('angles use stable line intersection and reject projected-angle errors', () => {
  assert.equal(measureAngle('front', line([0, 0], [10, 0]), line([0, 0], [0, 10])).value, 90);
  const acute = measureAngle('front', line([0, 0], [10, 0]), line([0, 0], [10, 10]));
  assert.ok(Math.abs(acute.value - 45) < 1e-12);
  assert.deepEqual(acute.vertex, [0, 0]);
  assert.throws(
    () => measureAngle('front', line([0, 0], [10, 0]), line([0, 1], [10, 1])),
    /parallel/,
  );
  const tilted = line([0, 0], [10, 10]);
  tilted.sourcePoints![1][1] = 10;
  assert.throws(() => measureAngle('front', line([0, 0], [10, 0]), tilted), /foreshortened/);
});
