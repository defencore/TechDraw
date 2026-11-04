import assert from 'node:assert/strict';
import test from 'node:test';
import { renderDrawingFeedback } from '../src/ui/drawing-feedback';

test('sheet warning feedback escapes imported text, deduplicates and prioritizes overflow', () => {
  const imported = 'Drawing title <img src=x onerror="alert(1)"> & notes';
  const overflow = 'Dimensions exceed the drawing area.';
  const warnings = [imported, ` ${imported} `, '', overflow];
  const original = [...warnings];
  const markup = renderDrawingFeedback(warnings);
  assert.deepEqual(warnings, original);
  assert.ok(!markup.includes('<img'));
  assert.match(markup, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt; &amp; notes/);
  assert.equal(markup.match(/Drawing title/g)?.length, 1);
  assert.ok(markup.indexOf(overflow) < markup.indexOf('Drawing title'));
  assert.match(markup, /data-action="arrange-dimensions"/);
});

test('layout actions are offered for layout warnings and empty feedback has no controls', () => {
  assert.equal(renderDrawingFeedback(['', '  ']), '');
  const coverage = renderDrawingFeedback(['Review the remaining shaft shoulder stations.']);
  assert.ok(!coverage.includes('data-action="arrange-dimensions"'));
  assert.match(coverage, /data-action="tab:sheet"/);
  const overlap = renderDrawingFeedback(['Some dimension labels overlap. Use Auto layout.']);
  assert.match(overlap, /data-action="arrange-dimensions"/);
});
