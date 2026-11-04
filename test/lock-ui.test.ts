import assert from 'node:assert/strict';
import test from 'node:test';
import type { Dimension, DrawingAnnotation } from '../src/model';
import { renderDimensionEditor } from '../src/ui/dimension-editor';
import { renderAnnotationEditor } from '../src/ui/annotation-editor';

const dimension: Dimension = {
  id: 'width',
  kind: 'horizontal',
  viewId: 'front',
  value: 20,
  a: [0, 0],
  b: [20, 0],
  offset: 10,
  automatic: false,
  locked: true,
};

test('locked editing keeps the Unlock control outside the disabled fields', () => {
  const dimensionMarkup = renderDimensionEditor(dimension, 2);
  const annotation: DrawingAnnotation = {
    id: 'note',
    kind: 'text',
    points: [[10, 20]],
    strokeWidth: 0.35,
    text: 'Keep <this> note',
    fontSize: 3.5,
    color: '#2678d4',
    locked: true,
  };
  const annotationMarkup = renderAnnotationEditor(annotation);
  for (const [markup, action] of [
    [dimensionMarkup, 'data-action="toggle-selection-lock"'],
    [annotationMarkup, 'data-annotation-action="lock"'],
  ]) {
    const fieldset = markup.indexOf('<fieldset');
    assert.ok(fieldset > markup.indexOf(action));
    assert.match(markup.slice(fieldset), /^<fieldset[^>]* disabled>/);
  }
  assert.match(annotationMarkup, /Keep &lt;this&gt; note/);
  assert.equal(annotation.text, 'Keep <this> note');
});

test('a locked focus in a mixed group offers Lock selection rather than a misleading Unlock', () => {
  const markup = renderDimensionEditor(dimension, 2, { count: 2, lockedCount: 1 });
  assert.match(markup, /aria-label="Lock selection"/);
  assert.doesNotMatch(markup, /aria-label="Unlock selection"/);
  assert.match(markup, /data-action="delete-dimension"[^>]* disabled/);
});
