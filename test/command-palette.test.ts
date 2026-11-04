import assert from 'node:assert/strict';
import test from 'node:test';
import { CommandPaletteController, searchCommands } from '../src/ui/command-palette';
import {
  getCommands,
  type Command,
  type CommandContext,
  type CommandId,
} from '../src/ui/command-registry';

const context: CommandContext = {
  busy: false,
  partCount: 1,
  hasActivePart: true,
  selectedPartCount: 1,
  selectionCount: 1,
  dimensionCount: 4,
  canUndo: true,
  canRedo: false,
};

/** A bounded DOM host exercises focus and dispatched UI events without a browser dependency. */
class ElementHost {
  children: ElementHost[] = [];
  parent?: ElementHost;
  className = '';
  id = '';
  type = '';
  value = '';
  tabIndex = 0;
  open = false;
  autocomplete = '';
  spellcheck = true;
  placeholder = '';
  innerHTML = '';
  dataset: Record<string, string> = {};
  private text = '';
  private attributes = new Map<string, string>();
  private listeners = new Map<string, ((event: any) => void)[]>();
  constructor(
    readonly tag: string,
    readonly document: DocumentHost,
  ) {}
  get textContent(): string {
    return this.text + this.children.map((child) => child.textContent).join('');
  }
  set textContent(value: string) {
    this.text = value;
    this.replaceChildren();
  }
  get isConnected(): boolean {
    return this === this.document.body || !!this.parent?.isConnected;
  }
  classList = {
    toggle: (name: string, selected: boolean) => {
      const names = new Set(this.className.split(' ').filter(Boolean));
      if (selected) names.add(name);
      else names.delete(name);
      this.className = [...names].join(' ');
    },
  };
  append(...children: ElementHost[]) {
    for (const child of children) {
      child.remove();
      child.parent = this;
      this.children.push(child);
    }
  }
  replaceChildren(...children: ElementHost[]) {
    for (const child of this.children) child.parent = undefined;
    this.children = [];
    this.append(...children);
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = undefined;
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
    if (name === 'open') this.open = true;
  }
  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }
  removeAttribute(name: string) {
    this.attributes.delete(name);
    if (name === 'open') this.open = false;
  }
  addEventListener(name: string, handler: (event: any) => void) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), handler]);
  }
  focus() {
    this.document.activeElement = this;
  }
  select() {}
  scrollIntoView() {}
  showModal() {
    this.open = true;
    this.focus();
  }
  close() {
    this.open = false;
    this.fire('close');
  }
  getBoundingClientRect() {
    return { left: 100, right: 500, top: 100, bottom: 500 };
  }
  fire(type: string, properties: Record<string, unknown> = {}) {
    const event = {
      target: this,
      key: '',
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      isComposing: false,
      defaultPrevented: false,
      stopped: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      stopPropagation() {
        this.stopped = true;
      },
      ...properties,
    };
    let current: ElementHost | undefined = this;
    while (current) {
      for (const listener of current.listeners.get(type) ?? []) listener(event);
      if (event.stopped) break;
      current = current.parent;
    }
    return event;
  }
  descendants(className: string): ElementHost[] {
    return this.children.flatMap((child) => [
      ...(child.className.split(' ').includes(className) ? [child] : []),
      ...child.descendants(className),
    ]);
  }
}
class DocumentHost {
  body = new ElementHost('body', this);
  activeElement: ElementHost = this.body;
  createElement(tag: string) {
    return new ElementHost(tag, this);
  }
}
function workspace() {
  const document = new DocumentHost();
  const launcher = document.createElement('button');
  document.body.append(launcher);
  launcher.focus();
  let commands = getCommands(context);
  const executed: CommandId[] = [];
  let closes = 0;
  const controller = new CommandPaletteController(
    {
      getCommands: () => commands,
      execute: (id) => {
        assert.equal(controller.isOpen, false);
        assert.equal(document.activeElement, launcher);
        executed.push(id);
      },
      onClose: () => {
        closes++;
      },
    },
    document as unknown as Document,
  );
  const find = (name: string) => document.body.descendants(name)[0];
  return {
    document,
    launcher,
    controller,
    executed,
    closes: () => closes,
    find,
    setCommands: (value: Command[]) => {
      commands = value;
    },
  };
}

test('search uses all query terms across labels, groups and keywords and keeps disabled reasons discoverable', () => {
  const commands = getCommands(context);
  assert.equal(searchCommands(commands, 'title metadata')[0]?.id, 'tab:details');
  assert.equal(searchCommands(commands, 'dimension horizontal')[0]?.id, 'tool:horizontal');
  assert.ok(
    searchCommands(commands, 'redo').some(
      (command) => command.id === 'redo' && !command.enabled && !!command.disabledReason,
    ),
  );
  assert.equal(searchCommands(commands, 'no-such-tool').length, 0);
  assert.ok(!searchCommands(commands, '').some((command) => command.hidden));
});

test('open owns input focus, arrow and Enter execute the selected command, and close restores the launcher', () => {
  const app = workspace();
  app.controller.open('zoom-');
  const input = app.find('command-palette-search');
  assert.equal(app.document.activeElement, input);
  assert.equal(app.find('command-palette-results').getAttribute('role'), 'listbox');
  assert.equal(input.getAttribute('role'), 'combobox');
  input.fire('keydown', { key: 'ArrowDown' });
  input.fire('keydown', { key: 'Enter' });
  assert.deepEqual(app.executed, ['zoom-out']);
  assert.equal(app.closes(), 1);
  assert.equal(app.find('command-palette').open, false);
});

test('disabled commands stay visible with a reason and cannot run by Enter or click', () => {
  const app = workspace();
  app.controller.open('redo');
  const input = app.find('command-palette-search'),
    option = app.find('command-palette-option');
  assert.equal(option.getAttribute('aria-disabled'), 'true');
  assert.match(app.find('command-palette-reason').textContent, /nothing to redo/);
  input.fire('keydown', { key: 'Enter' });
  option.fire('click');
  assert.deepEqual(app.executed, []);
  assert.equal(app.controller.isOpen, true);
});

test('execution rechecks current availability and an update preserves the search input and modal node', () => {
  const app = workspace();
  app.controller.open('horizontal');
  const dialog = app.find('command-palette'),
    input = app.find('command-palette-search');
  app.setCommands(getCommands({ ...context, busy: true }));
  input.fire('keydown', { key: 'Enter' });
  assert.deepEqual(app.executed, []);
  assert.equal(app.controller.isOpen, true);
  assert.equal(app.find('command-palette'), dialog);
  assert.equal(input.value, 'horizontal');
  assert.match(app.find('command-palette-reason').textContent, /Wait for/);
});

test('empty results are safe, Tab stays in the dialog, and Escape returns focus once', () => {
  const app = workspace();
  app.controller.open('no-such-command');
  const input = app.find('command-palette-search');
  assert.match(app.find('command-palette-status').textContent, /No commands found/);
  input.fire('keydown', { key: 'ArrowDown' });
  input.fire('keydown', { key: 'Enter' });
  assert.deepEqual(app.executed, []);
  input.fire('keydown', { key: 'Tab' });
  assert.equal(app.document.activeElement, app.find('command-palette-close'));
  app.find('command-palette-close').fire('keydown', { key: 'Tab', shiftKey: true });
  assert.equal(app.document.activeElement, input);
  input.fire('keydown', { key: 'Escape' });
  assert.equal(app.document.activeElement, app.launcher);
  assert.equal(app.closes(), 1);
  app.controller.dispose();
  assert.equal(app.document.body.descendants('command-palette').length, 0);
  assert.equal(app.closes(), 1);
});

test('search input events filter live, and text labels are assigned without interpreting markup', () => {
  const app = workspace();
  app.setCommands([{ ...getCommands(context)[0], label: '<img src=x> Import', group: 'File' }]);
  app.controller.open();
  assert.equal(app.find('command-palette-label').textContent, '<img src=x> Import');
  assert.equal(app.find('command-palette-label').innerHTML, '');
  const input = app.find('command-palette-search');
  input.value = 'unmatched';
  input.fire('input');
  assert.equal(app.document.body.descendants('command-palette-option').length, 0);
  input.fire('keydown', { key: 'k', ctrlKey: true });
  assert.equal(app.controller.isOpen, false);
});

test('Save from command search uses the shared shortcut matcher and prevents the browser action', () => {
  for (const modifier of [{ ctrlKey: true }, { metaKey: true }]) {
    const app = workspace();
    app.controller.open('horizontal');
    const event = app.find('command-palette-search').fire('keydown', { key: 's', ...modifier });
    assert.equal(event.defaultPrevented, true);
    assert.deepEqual(app.executed, ['save-project']);
    assert.equal(app.controller.isOpen, false);
  }
});

test('unavailable Save in command search stays reserved and explains why without closing the dialog', () => {
  for (const unavailable of [
    { ...context, busy: true },
    { ...context, partCount: 0, hasActivePart: false },
  ]) {
    const app = workspace();
    app.setCommands(getCommands(unavailable));
    app.controller.open('horizontal');
    const event = app.find('command-palette-search').fire('keydown', { key: 's', ctrlKey: true });
    assert.equal(event.defaultPrevented, true);
    assert.deepEqual(app.executed, []);
    assert.equal(app.controller.isOpen, true);
    assert.equal(app.find('command-palette-search').value, 'horizontal');
    assert.match(app.find('command-palette-status').textContent, /Wait for|Import or open/);
  }
});
