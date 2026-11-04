import assert from 'node:assert/strict';
import test from 'node:test';
import { ManufacturingEditorController } from '../src/ui/manufacturing-editor-controller';
import { publicPart, publicWorkspace } from './fixtures/workspace';

function fixture() {
  const document = publicWorkspace([publicPart('gear'), publicPart('plate')]);
  document.setManufacturing('gear', { type: 'gear', profiles: {} });
  let renders = 0;
  let busy = false;
  const controller = new ManufacturingEditorController({
    document,
    busy: () => busy,
    render: () => {
      renders++;
    },
    refresh() {},
    report() {},
  });
  return {
    document,
    controller,
    renders: () => renders,
    busy: () => {
      busy = true;
    },
  };
}

test('boundary validation prevents partial commits and renders once after every valid branch commits', () => {
  const { document, controller, renders } = fixture();
  controller.updateInstructions('Machine before coating.');
  controller.updateGear({ type: 'external-spur', normalModule: '-' });
  document.state.activeId = 'plate';
  controller.updateInstructions('Deburr after drilling.');
  assert.throws(() => controller.flush(), /decimal/);
  assert.equal(document.getInstructions('gear'), '');
  assert.equal(document.getInstructions('plate'), '');
  assert.equal(document.state.parts[0].gearSpecification, undefined);
  assert.equal(renders(), 0);
  document.state.activeId = 'gear';
  controller.updateGear({ type: 'external-spur', normalModule: '1' });
  controller.flush();
  assert.equal(document.getInstructions('gear'), 'Machine before coating.');
  assert.equal(document.getInstructions('plate'), 'Deburr after drilling.');
  assert.equal(document.active?.gearSpecification?.normalModule, 1);
  assert.equal(renders(), 1);
  assert.equal(controller.hasPendingChanges(), false);
});

test('hidden history steps invalidate stale gear and instruction drafts even when values return to their baseline', () => {
  const { document, controller } = fixture();
  document.setInstructions('gear', 'A');
  document.setGearSpecification('gear', { type: 'external-spur', normalModule: 1 });
  controller.updateInstructions('Unsaved text');
  controller.updateGear({ type: 'external-spur', normalModule: '3' });
  document.setInstructions('gear', 'B');
  document.setGearSpecification('gear', { type: 'external-spur', normalModule: 2 });
  controller.reconcileHistory();
  assert.equal(document.travel('undo'), true);
  controller.reconcileHistory();
  assert.equal(document.travel('undo'), true);
  controller.reconcileHistory();
  controller.flush();
  assert.equal(document.getInstructions('gear'), 'A');
  assert.equal(document.active?.gearSpecification?.normalModule, 1);
  assert.equal(controller.hasPendingChanges(), false);
});

test('unrelated drawing undo retains unfinished engineering drafts and an inactive gear draft does not block another type', () => {
  const { document, controller } = fixture();
  controller.updateInstructions('Pending instruction');
  controller.updateGear({ type: 'external-spur', normalModule: '-' });
  document.changeDimensions([
    {
      id: 'manual',
      kind: 'horizontal',
      viewId: 'front',
      a: [0, 0],
      b: [10, 0],
      value: 10,
      offset: 10,
      automatic: false,
    },
  ]);
  assert.equal(document.travel('undo'), true);
  controller.reconcileHistory();
  assert.equal(controller.instructionDraft(document.active!), 'Pending instruction');
  assert.equal(controller.gearDraft(document.active!)?.normalModule, '-');
  document.setManufacturing('gear', { type: 'shaft', profiles: {} });
  controller.flush();
  assert.equal(document.getInstructions('gear'), 'Pending instruction');
  assert.equal(document.active?.gearSpecification, undefined);
  assert.equal(controller.hasPendingChanges(), true);
  controller.clearPart('gear');
  assert.equal(controller.hasPendingChanges(), false);
});

test('busy editors cannot mutate drafts and editing back to committed text clears pending changes', () => {
  const context = fixture();
  context.document.setInstructions('gear', 'Original');
  context.controller.updateInstructions('Changed');
  assert.equal(context.controller.hasPendingChanges(), true);
  context.controller.updateInstructions('Original');
  assert.equal(context.controller.hasPendingChanges(), false);
  context.busy();
  context.controller.updateInstructions('Must not appear');
  context.controller.updateGear({ type: 'external-spur', normalModule: '4' });
  assert.equal(context.controller.hasPendingChanges(), false);
});
