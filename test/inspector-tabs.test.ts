import assert from 'node:assert/strict';
import test from 'node:test';
import { INSPECTOR_TABS, nextInspectorTab, renderInspectorTabs } from '../src/ui/inspector-tabs';

test('inspector keyboard navigation wraps and Home/End address the first and last panels', () => {
  assert.equal(nextInspectorTab('dimensions', 'ArrowLeft'), 'details');
  assert.equal(nextInspectorTab('details', 'ArrowRight'), 'dimensions');
  assert.equal(nextInspectorTab('instructions', 'Home'), 'dimensions');
  assert.equal(nextInspectorTab('manufacturing', 'End'), 'details');
  assert.equal(nextInspectorTab('sheet', 'Tab'), undefined);
  assert.equal(nextInspectorTab('unknown', 'ArrowRight'), undefined);
});

test('each selected inspector has one keyboard stop and a linked accessible panel', () => {
  for (const tab of INSPECTOR_TABS) {
    const markup = renderInspectorTabs(tab.id);
    assert.equal((markup.match(/tabindex="0"/g) ?? []).length, 1);
    assert.match(markup, new RegExp(`id="inspector-tab-${tab.id}"[^>]*aria-selected="true"`));
    assert.equal(
      (markup.match(/aria-controls="inspector-panel"/g) ?? []).length,
      INSPECTOR_TABS.length,
    );
  }
});
