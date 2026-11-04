import assert from 'node:assert/strict';
import test from 'node:test';
import {
  commandDefinitions,
  dimensionTools,
  findShortcutCommand,
  formatShortcut,
  getCommand,
  getCommands,
  isEditingTarget,
  type CommandContext,
  type ShortcutEvent,
} from '../src/ui/command-registry';

const ready: CommandContext = {
  busy: false,
  partCount: 1,
  hasActivePart: true,
  selectedPartCount: 1,
  selectionCount: 2,
  dimensionCount: 8,
  canUndo: true,
  canRedo: true,
};
const key = (key: string, options: Partial<ShortcutEvent> = {}): ShortcutEvent => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  target: null,
  ...options,
});
const editing = { closest: () => ({}) } as unknown as EventTarget;

test('canonical command IDs and all six dimension tool shortcuts are unique', () => {
  assert.equal(
    new Set(commandDefinitions.map((command) => command.id)).size,
    commandDefinitions.length,
  );
  assert.equal(dimensionTools.length, 6);
  for (const tool of dimensionTools) {
    assert.equal(
      findShortcutCommand(key(tool.shortcut.toLowerCase()), ready)?.id,
      `tool:${tool.id}`,
    );
    assert.equal(getCommand(`tool:${tool.id}`, ready)?.icon, tool.icon);
  }
});

test('availability gives actionable reasons for missing parts, selection, PDF inclusion and history', () => {
  const empty: CommandContext = {
    ...ready,
    partCount: 0,
    hasActivePart: false,
    selectedPartCount: 0,
    selectionCount: 0,
    dimensionCount: 0,
    canUndo: false,
    canRedo: false,
  };
  assert.equal(getCommand('import', empty)?.enabled, true);
  assert.match(getCommand('tool:horizontal', empty)?.disabledReason ?? '', /Import or open/);
  assert.match(
    getCommand('edit-dimension', { ...ready, selectionCount: 0 })?.disabledReason ?? '',
    /Select one or more/,
  );
  assert.match(
    getCommand('export-pdf', { ...ready, selectedPartCount: 0 })?.disabledReason ?? '',
    /include in the PDF/,
  );
  assert.match(
    getCommand('undo', { ...ready, canUndo: false })?.disabledReason ?? '',
    /nothing to undo/,
  );
  assert.match(
    getCommand('redo', { ...ready, canRedo: false })?.disabledReason ?? '',
    /nothing to redo/,
  );
  assert.equal(getCommand('not-a-command', ready), undefined);
});

test('cancel is available only for an import and cannot cancel a PDF export merely because it is busy', () => {
  assert.equal(getCommand('cancel', { ...ready, busy: true, importing: false })?.enabled, false);
  assert.equal(getCommand('cancel', { ...ready, busy: true, importing: true })?.enabled, true);
  assert.equal(getCommand('auto-dimensions', { ...ready, busy: true })?.enabled, false);
  assert.equal(getCommand('command-palette', { ...ready, busy: true })?.enabled, true);
});

test('native text editing keeps letter tools, undo, select-all and delete while save and command search stay global', () => {
  assert.equal(isEditingTarget(editing), true);
  for (const event of [
    key('h'),
    key('s'),
    key('z', { ctrlKey: true }),
    key('a', { metaKey: true }),
    key('Delete'),
    key('Backspace'),
  ])
    assert.equal(findShortcutCommand({ ...event, target: editing }, ready), undefined);
  assert.equal(
    findShortcutCommand(key('s', { ctrlKey: true, target: editing }), ready)?.id,
    'save-project',
  );
  assert.equal(
    findShortcutCommand(key('k', { metaKey: true, target: editing }), ready)?.id,
    'command-palette',
  );
  let selector = '';
  isEditingTarget({
    closest: (value: string) => {
      selector = value;
      return null;
    },
  } as unknown as EventTarget);
  assert.match(selector, /contenteditable/);
  assert.match(selector, /role="textbox"/);
});

test('modifier matching avoids accidental tools, respects composition and supports alternate redo and zoom keys', () => {
  assert.equal(findShortcutCommand(key('h', { ctrlKey: true }), ready), undefined);
  assert.equal(findShortcutCommand(key('H', { shiftKey: true }), ready), undefined);
  assert.equal(findShortcutCommand(key('h', { isComposing: true }), ready), undefined);
  assert.equal(findShortcutCommand(key('h', { defaultPrevented: true }), ready), undefined);
  assert.equal(findShortcutCommand(key('y', { ctrlKey: true }), ready)?.id, 'redo');
  assert.equal(findShortcutCommand(key('Z', { metaKey: true, shiftKey: true }), ready)?.id, 'redo');
  assert.equal(findShortcutCommand(key('+', { shiftKey: true }), ready)?.id, 'zoom-in');
  assert.equal(findShortcutCommand(key('='), ready)?.id, 'zoom-in');
  assert.equal(findShortcutCommand(key('+', { ctrlKey: true, shiftKey: true }), ready), undefined);
  assert.equal(formatShortcut('Mod+Shift+Z', true), '⌘ ⇧ Z');
  assert.equal(formatShortcut('+', true), '+');
});

test('active states and destructive undoable metadata are resolved from the same registry', () => {
  const commands = getCommands({
    ...ready,
    tool: 'box-select',
    gridVisible: true,
    gridSnap: false,
    focusMode: true,
    inspectorTab: 'details',
  });
  assert.equal(commands.find((command) => command.id === 'tool:box-select')?.active, true);
  assert.equal(commands.find((command) => command.id === 'toggle-grid')?.active, true);
  assert.equal(commands.find((command) => command.id === 'toggle-grid-snap')?.active, false);
  assert.equal(commands.find((command) => command.id === 'tab:details')?.active, true);
  assert.equal(getCommand('delete-selected-dimensions', ready)?.destructive, true);
  assert.equal(getCommand('delete-selected-dimensions', ready)?.undoable, true);
});

test('Enter leaves native focused controls active and edits the selected annotation only from the drawing surface', () => {
  for (const selector of ['button', 'a[href]', 'summary', '[role="button"]', '[role="link"]']) {
    const target = {
      closest: (selectors: string) => (selectors.split(',').includes(selector) ? {} : null),
    } as unknown as EventTarget;
    assert.equal(
      findShortcutCommand(key('Enter', { target }), ready),
      undefined,
      `Enter must activate ${selector}`,
    );
  }
  const surface = { closest: () => null } as unknown as EventTarget;
  assert.equal(findShortcutCommand(key('Enter', { target: surface }), ready)?.id, 'edit-dimension');
  assert.equal(findShortcutCommand(key('Enter'), ready)?.id, 'edit-dimension');
});

test('owned Save shortcuts stay reserved with a disabled explanation in empty and busy workspaces', () => {
  const empty: CommandContext = {
    ...ready,
    partCount: 0,
    hasActivePart: false,
    selectedPartCount: 0,
  };
  for (const context of [empty, { ...ready, busy: true }])
    for (const modifier of [{ ctrlKey: true }, { metaKey: true }])
      for (const target of [null, editing]) {
        const command = findShortcutCommand(key('s', { ...modifier, target }), context);
        assert.equal(command?.id, 'save-project');
        assert.equal(command.enabled, false);
        assert.ok(command.disabledReason);
      }
});
