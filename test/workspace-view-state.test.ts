import assert from 'node:assert/strict';
import test from 'node:test';
import { WorkspaceViewState } from '../src/ui/workspace-view-state';

function section(label: string, open = false) {
  return {
    id: '',
    dataset: {},
    className: 'section',
    open,
    querySelector: () => ({ textContent: label }),
  };
}
function panel(key: string, details: ReturnType<typeof section>[], top = 0) {
  return {
    dataset: { panelViewKey: key },
    scrollTop: top,
    scrollLeft: 0,
    querySelectorAll: () => details,
  };
}
const root = (items: ReturnType<typeof panel>[]) =>
  ({ querySelectorAll: () => items }) as unknown as ParentNode;

test('panel context belongs to its part/tab and section identity rather than DOM order', () => {
  const state = new WorkspaceViewState();
  state.capture(root([panel('part-a:instructions', [section('General', true)], 240)]));
  const added = section('New section'),
    general = section('General');
  const restored = panel('part-a:instructions', [added, general]);
  const other = panel('part-b:instructions', [section('General')], 200);
  state.restore(root([restored, other]));
  assert.equal(restored.scrollTop, 240);
  assert.equal(general.open, true);
  assert.equal(added.open, false);
  assert.equal(other.scrollTop, 0);
  assert.equal(other.querySelectorAll()[0].open, false);
});
