import {
  findShortcutInCommands,
  formatShortcut,
  type Command,
  type CommandId,
} from './command-registry';
import { icon } from './icons';

const searchable = (text: string) =>
  text
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

/** Search metadata only; labels and disabled explanations remain visible in the dialog. */
export function searchCommands(commands: readonly Command[], query: string): Command[] {
  const terms = searchable(query).trim().split(/\s+/).filter(Boolean);
  return commands.filter((command) => {
    if (command.hidden) return false;
    const text = searchable(
      [
        command.label,
        command.group,
        command.id,
        command.shortcut ?? '',
        ...(command.keywords ?? []),
      ].join(' '),
    );
    return terms.every((term) => text.includes(term));
  });
}

export interface CommandPaletteContext {
  getCommands(): readonly Command[];
  execute(id: CommandId): void;
  onClose?(): void;
  mac?: boolean;
}
let paletteSerial = 0;

/** A persistent modal lives outside the rerendered workspace and owns its keyboard events. */
export class CommandPaletteController {
  private readonly instance = ++paletteSerial;
  private dialog?: HTMLDialogElement;
  private input?: HTMLInputElement;
  private results?: HTMLElement;
  private status?: HTMLElement;
  private closeButton?: HTMLButtonElement;
  private options: HTMLButtonElement[] = [];
  private commands: Command[] = [];
  private activeId?: CommandId;
  private previousFocus?: HTMLElement;
  private opened = false;

  constructor(
    private readonly context: CommandPaletteContext,
    private readonly documentRef: Document = document,
  ) {}

  get isOpen(): boolean {
    return this.opened;
  }

  private create(): void {
    if (this.dialog) return;
    const document = this.documentRef;
    const element = <K extends keyof HTMLElementTagNameMap>(
      name: K,
      className: string,
      text?: string,
    ) => {
      const node = document.createElement(name);
      node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    };
    const dialog = element('dialog', 'command-palette');
    dialog.setAttribute('aria-modal', 'true');
    const headingId = `command-palette-heading-${this.instance}`;
    dialog.setAttribute('aria-labelledby', headingId);
    const header = element('div', 'command-palette-header');
    const heading = element('h2', 'command-palette-heading', 'Search commands');
    heading.id = headingId;
    const close = element('button', 'command-palette-close', 'Esc');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close command search');
    close.addEventListener('click', () => this.close());
    header.append(heading, close);
    const search = element('input', 'command-palette-search');
    search.type = 'search';
    search.autocomplete = 'off';
    search.spellcheck = false;
    search.placeholder = 'Search tools, dimensions, files…';
    search.setAttribute('aria-label', 'Search commands');
    search.setAttribute('role', 'combobox');
    search.setAttribute('aria-autocomplete', 'list');
    search.setAttribute('aria-expanded', 'true');
    const results = element('div', 'command-palette-results');
    results.id = `command-palette-results-${this.instance}`;
    results.setAttribute('role', 'listbox');
    results.setAttribute('aria-label', 'Available commands');
    search.setAttribute('aria-controls', results.id);
    const status = element('p', 'command-palette-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const footer = element('div', 'command-palette-footer', '↑ ↓ Navigate · Enter Run · Esc Close');
    dialog.append(header, search, results, status, footer);
    search.addEventListener('input', () => this.update());
    dialog.addEventListener('keydown', (event) => {
      event.stopPropagation();
      this.handleKeydown(event);
    });
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      this.close();
    });
    dialog.addEventListener('close', () => {
      if (this.opened) this.finishClose();
    });
    dialog.addEventListener('click', (event) => {
      if (event.target !== dialog) return;
      const bounds = dialog.getBoundingClientRect();
      if (
        event.clientX < bounds.left ||
        event.clientX > bounds.right ||
        event.clientY < bounds.top ||
        event.clientY > bounds.bottom
      )
        this.close();
    });
    this.dialog = dialog;
    this.input = search;
    this.results = results;
    this.status = status;
    this.closeButton = close;
    document.body.append(dialog);
  }

  open(query = ''): void {
    this.create();
    if (!this.opened) {
      const focused = this.documentRef.activeElement as HTMLElement | null;
      this.previousFocus = focused && typeof focused.focus === 'function' ? focused : undefined;
      this.opened = true;
      this.dialog!.showModal();
    }
    this.input!.value = query;
    this.activeId = undefined;
    this.update();
    this.input!.focus();
    this.input!.select();
  }

  update(): void {
    if (!this.opened || !this.results || !this.input) return;
    this.commands = searchCommands(this.context.getCommands(), this.input.value);
    if (!this.commands.some((command) => command.id === this.activeId))
      this.activeId = this.commands.find((command) => command.enabled)?.id ?? this.commands[0]?.id;
    this.results.replaceChildren();
    this.options = [];
    let currentGroup: string | undefined;
    for (const [index, command] of this.commands.entries()) {
      if (command.group !== currentGroup) {
        const group = this.documentRef.createElement('div');
        group.className = 'command-palette-group';
        group.textContent = command.group;
        group.setAttribute('role', 'presentation');
        this.results.append(group);
        currentGroup = command.group;
      }
      const option = this.documentRef.createElement('button');
      option.type = 'button';
      option.className = 'command-palette-option';
      option.id = `command-palette-option-${this.instance}-${index}`;
      option.tabIndex = -1;
      option.setAttribute('role', 'option');
      option.setAttribute('aria-disabled', String(!command.enabled));
      option.dataset.commandId = command.id;
      if (command.destructive) option.dataset.destructive = 'true';
      if (command.icon) {
        const glyph = this.documentRef.createElement('span');
        glyph.className = 'command-palette-icon';
        glyph.innerHTML = icon(command.icon);
        option.append(glyph);
      }
      const copy = this.documentRef.createElement('span');
      copy.className = 'command-palette-copy';
      const label = this.documentRef.createElement('span');
      label.className = 'command-palette-label';
      label.textContent = command.label;
      copy.append(label);
      if (command.disabledReason) {
        const reason = this.documentRef.createElement('small');
        reason.className = 'command-palette-reason';
        reason.textContent = command.disabledReason;
        copy.append(reason);
      }
      option.append(copy);
      if (command.active) {
        const active = this.documentRef.createElement('span');
        active.className = 'command-palette-current';
        active.textContent = 'Active';
        option.append(active);
      }
      if (command.shortcut) {
        const shortcut = this.documentRef.createElement('kbd');
        shortcut.className = 'command-palette-shortcut';
        shortcut.textContent = formatShortcut(command.shortcut, this.context.mac);
        option.append(shortcut);
      }
      option.addEventListener('mousedown', (event) => event.preventDefault());
      option.addEventListener('click', () => {
        this.activeId = command.id;
        this.runActive();
      });
      this.results.append(option);
      this.options.push(option);
    }
    this.updateActive();
  }

  private updateActive(): void {
    const index = this.commands.findIndex((command) => command.id === this.activeId);
    this.options.forEach((option, optionIndex) => {
      const selected = optionIndex === index;
      option.classList.toggle('active', selected);
      option.setAttribute('aria-selected', String(selected));
    });
    const active = this.options[index];
    if (active) {
      this.input!.setAttribute('aria-activedescendant', active.id);
      active.scrollIntoView?.({ block: 'nearest' });
    } else this.input!.removeAttribute('aria-activedescendant');
    const command = this.commands[index];
    this.status!.textContent = !this.commands.length
      ? 'No commands found. Try another search.'
      : (command?.disabledReason ??
        `${this.commands.length} matching ${this.commands.length === 1 ? 'command' : 'commands'}.`);
  }

  private runActive(): void {
    if (!this.activeId) return;
    const command = this.context.getCommands().find((command) => command.id === this.activeId);
    if (!command?.enabled || command.hidden) {
      this.update();
      return;
    }
    const id = command.id;
    this.close();
    this.context.execute(id);
  }

  handleKeydown(event: KeyboardEvent): boolean {
    if (!this.opened || event.isComposing) return false;
    if (
      event.key === 'Escape' ||
      ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k')
    ) {
      event.preventDefault();
      this.close();
      return true;
    }
    const global = findShortcutInCommands(
      event,
      this.context.getCommands().filter((command) => command.allowWhenEditing),
    );
    if (global) {
      event.preventDefault();
      if (global.enabled) {
        this.activeId = global.id;
        this.runActive();
      } else if (this.status)
        this.status.textContent = global.disabledReason ?? 'This command is unavailable.';
      return true;
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      if (!this.commands.length) return true;
      const current = this.commands.findIndex((command) => command.id === this.activeId);
      const index =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? this.commands.length - 1
            : (current + (event.key === 'ArrowUp' ? -1 : 1) + this.commands.length) %
              this.commands.length;
      this.activeId = this.commands[index].id;
      this.updateActive();
      return true;
    }
    if (event.key === 'Enter' && event.target !== this.closeButton) {
      event.preventDefault();
      this.runActive();
      return true;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      (this.documentRef.activeElement === this.input ? this.closeButton : this.input)?.focus();
      return true;
    }
    return false;
  }

  close(): void {
    if (!this.opened) return;
    this.opened = false;
    this.dialog!.close();
    this.finishClose();
  }

  private finishClose(): void {
    this.opened = false;
    if (this.previousFocus?.isConnected) this.previousFocus.focus();
    this.previousFocus = undefined;
    this.context.onClose?.();
  }

  dispose(): void {
    this.close();
    this.dialog?.remove();
    this.dialog = undefined;
    this.input = undefined;
    this.results = undefined;
    this.options = [];
  }
}
