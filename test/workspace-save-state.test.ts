import assert from 'node:assert/strict';
import test from 'node:test';
import { WorkspaceSaveState } from '../src/application/workspace-save-state';
import { publicPart, publicWorkspace } from './fixtures/workspace';

test('a saved/opened drawing warns only after editable document data changes, including Undo', () => {
  const document = publicWorkspace();
  const saved = new WorkspaceSaveState(document.state);
  assert.equal(saved.hasChanges(document.state), false);
  document.setInstructions('part', 'Deburr');
  assert.equal(saved.hasChanges(document.state), true);
  saved.markSaved(document.state);
  assert.equal(saved.hasChanges(document.state), false);
  document.travel('undo');
  assert.equal(saved.hasChanges(document.state), true);
  document.travel('redo');
  assert.equal(saved.hasChanges(document.state), false);
  document.state.description = 'New handover note';
  assert.equal(saved.hasChanges(document.state), true);
});

test('navigation and selection order do not change the saved document or traverse CAD geometry', () => {
  const document = publicWorkspace([publicPart('one'), publicPart('two')]);
  for (const part of document.state.parts)
    Object.defineProperty(part, 'views', {
      get() {
        throw new Error('Geometry must not be serialized');
      },
    });
  const saved = new WorkspaceSaveState(document.state);
  document.state.activeId = 'two';
  document.state.selected = new Set(['two', 'one']);
  assert.equal(saved.hasChanges(document.state), false);
  document.state.selected.delete('one');
  assert.equal(saved.hasChanges(document.state), true);
});
