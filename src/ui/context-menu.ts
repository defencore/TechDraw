import type { Command, CommandId } from './command-registry';
import { icon } from './icons';
import { escapeHtml } from './utils';

/** A contextual command view uses the same actions and availability as command search. */
export class ContextMenuController {
  private element?: HTMLElement;
  private returnFocus?: HTMLElement;
  constructor(
    private readonly context: {
      getCommands(): Command[];
      execute(id: CommandId): void;
    },
  ) {}

  open(x: number, y: number, ids: readonly CommandId[], label: string): void {
    this.close(false);
    this.returnFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const commands = this.context.getCommands().filter((command) => ids.includes(command.id));
    const menu = document.createElement('div');
    menu.className = 'canvas-context-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', label);
    menu.innerHTML = `<div class="context-menu-heading">${escapeHtml(label)}</div>${commands.map((command) => `<button type="button" role="menuitem" data-command="${escapeHtml(command.id)}" class="context-menu-item${command.destructive ? ' destructive' : ''}" ${command.enabled ? '' : 'disabled'} title="${escapeHtml(command.disabledReason ?? '')}">${command.icon ? icon(command.icon) : ''}<span>${escapeHtml(command.label)}</span>${command.shortcut ? `<kbd>${escapeHtml(command.shortcut.replace('Mod', '⌘/Ctrl'))}</kbd>` : ''}</button>`).join('')}`;
    document.body.append(menu);
    this.element = menu;
    const bounds = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - bounds.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - bounds.height - 8))}px`;
    menu.addEventListener('click', this.onClick);
    menu.addEventListener('keydown', this.onKeydown);
    document.addEventListener('pointerdown', this.outside, true);
    window.addEventListener('resize', this.onResize);
    this.controls()[0]?.focus({ preventScroll: true });
  }

  close(restoreFocus = true): void {
    this.element?.remove();
    this.element = undefined;
    document.removeEventListener('pointerdown', this.outside, true);
    window.removeEventListener('resize', this.onResize);
    if (restoreFocus && this.returnFocus?.isConnected)
      this.returnFocus.focus({ preventScroll: true });
    this.returnFocus = undefined;
  }
  private controls(): HTMLButtonElement[] {
    return [...(this.element?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
  }
  private onResize = () => this.close();
  private outside = (event: PointerEvent) => {
    if (!this.element?.contains(event.target as Node)) this.close(false);
  };
  private onClick = (event: MouseEvent) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-command]');
    if (!button || button.disabled) return;
    const id = button.dataset.command as CommandId;
    this.close();
    this.context.execute(id);
  };
  private onKeydown = (event: KeyboardEvent) => {
    event.stopPropagation();
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault();
      event.stopPropagation();
      this.close();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const controls = this.controls();
    const index = controls.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? controls.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + controls.length) % controls.length;
    controls[next]?.focus();
  };
}
