import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkspaceViews } from '../src/ui/views';
import { defaultSettings, type WorkspaceState } from '../src/state';
import { defaultDimensionFilter } from '../src/ui/dimension-browser';
import { option } from '../src/ui/components';
import { renderDrawingViewerControls } from '../src/ui/viewer-controls';
import type { Part } from '../src/model';

const state: WorkspaceState = {
  parts: [],
  activeId: null,
  selected: new Set(),
  settings: { ...defaultSettings },
  dimensions: {},
  annotations: {},
  layouts: {},
  instructions: {},
  description: '',
};

test('workspace views build only the selected expensive inspector panel', () => {
  for (const selected of ['sheet', 'dimensions', 'annotations', 'instructions', 'manufacturing']) {
    const calls: string[] = [];
    const panel = (name: string) => () => {
      calls.push(name);
      return `Panel ${name}`;
    };
    const views = createWorkspaceViews({
      state,
      inspectorTab: selected,
      selectedDimensionIds: new Set(),
      dimensionFilter: defaultDimensionFilter,
      placement: { view: 'front', mode: 'cascade', gap: 10 },
      autoDetail: 'balanced',
      collapsedBranches: new Set(),
      annotationPanel: panel('annotations'),
      instructionsPanel: panel('instructions'),
      manufacturingPanel: panel('manufacturing'),
    });
    assert.deepEqual(calls, []);
    views.renderParts();
    assert.deepEqual(calls, []);
    const markup = views.renderInspector();
    if (['annotations', 'instructions', 'manufacturing'].includes(selected)) {
      assert.equal(markup, `Panel ${selected}`);
      assert.deepEqual(calls, [selected]);
    } else assert.deepEqual(calls, []);
  }
});

test('select option metadata remains escaped without changing value selection', () => {
  const value = 'part" title="unsafe';
  const markup = option(value, '<part> & name', value);
  assert.match(markup, /value="part&quot; title=&quot;unsafe" selected/);
  assert.match(markup, /&lt;part&gt; &amp; name/);
  assert.doesNotMatch(markup, /title="unsafe|<part>/);
});

test('viewer keeps full protected part names available and respects fullscreen capability', () => {
  const part = { id: 'one', name: 'PL3D.SAMPLE-ABCDEF12 Valve <body>' } as Part;
  const base = {
    parts: [part],
    activeId: 'one',
    appearance: 'paper' as const,
    keepAwake: false,
    wakeStatus: 'off' as const,
    wakeLabel: 'Screen lock off',
    fullscreenAvailable: false,
    fullscreen: false,
  };
  const markup = renderDrawingViewerControls(base);
  assert.match(markup, /data-user-content title="PL3D\.SAMPLE-ABCDEF12 Valve &lt;body&gt;"/);
  assert.match(markup, />Valve &lt;body&gt;<\/option>/);
  assert.doesNotMatch(markup, /data-action="toggle-native-fullscreen"/);
  const fullscreen = renderDrawingViewerControls({
    ...base,
    fullscreenAvailable: true,
    fullscreen: true,
  });
  assert.match(fullscreen, /data-action="toggle-native-fullscreen"[^>]*aria-pressed="true"/);
  assert.match(fullscreen, /aria-label="Exit system fullscreen"/);
});
