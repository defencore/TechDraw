import assert from 'node:assert/strict';
import test from 'node:test';
import { renderGridSpacingEditor } from '../src/ui/grid-spacing-editor';

const options = (markup: string) => [...markup.matchAll(/<option value="([^"]+)"([^>]*)>([^<]+)<\/option>/g)]
  .map((match) => ({ value: match[1], selected: match[2].includes('selected'), label: match[3] }));

test('grid choices keep the requested engineering pitches in order with Custom last', () => {
  const markup = renderGridSpacingEditor(2.54, true, false);
  const choices = options(markup);
  assert.deepEqual(choices.map((choice) => choice.value), ['1', '1.25', '2.54', '5', '10', 'custom']);
  assert.equal(choices.find((choice) => choice.selected)?.value, '2.54');
  assert.equal(choices[2].label, '2.54×2.54 mm');
  assert.doesNotMatch(markup, /id="grid-spacing"/);
});

test('explicit Custom survives a preset-equivalent value and exposes a precise separate input', () => {
  const markup = renderGridSpacingEditor(5, true, true);
  assert.equal(options(markup).find((choice) => choice.selected)?.value, 'custom');
  assert.match(markup, /id="grid-spacing"[^>]*step="0\.01"[^>]*value="5"/);
  const nonpreset = renderGridSpacingEditor(3.75, false, false);
  assert.equal(options(nonpreset).find((choice) => choice.selected)?.value, 'custom');
  assert.match(nonpreset, /id="grid-preset"[^>]* disabled/);
  assert.match(nonpreset, /id="grid-spacing"[^>]*value="3\.75"[^>]* disabled/);
});
