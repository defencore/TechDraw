import assert from 'node:assert/strict';
import test from 'node:test';
import { renderDimensionEditor } from '../src/ui/dimension-editor';

test('dimension properties retain a required nominal precision when sheet precision is lower', () => {
  const markup = renderDimensionEditor(
    {
      id: 'inch-bore',
      viewId: 'front',
      kind: 'diameter',
      a: [0, 0],
      b: [3.175, 0],
      value: 3.175,
      minimumPrecision: 3,
      offset: 10,
      automatic: true,
    },
    2,
  );
  assert.match(markup, /class="dimension-value">Ø3\.175<span>mm<\/span>/);
  assert.doesNotMatch(markup, /Ø3\.17<span>/);
});
