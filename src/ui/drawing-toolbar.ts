import type { CanvasTool } from './drawing-canvas';
import { dimensionTools } from './command-registry';
import { button } from './components';
import type { GridSettings } from './drawing-grid';
import { renderGridSpacingEditor } from './grid-spacing-editor';

interface ToolbarContext {
  tool: CanvasTool;
  enabled: boolean;
  canUndo: boolean;
  canRedo: boolean;
  zoomOptions: string;
  grid: GridSettings;
  customGrid?: boolean;
  mode?: 'dimensions' | 'annotations';
}

export function renderWorkspaceControls({
  tool,
  enabled,
  canUndo,
  canRedo,
  zoomOptions,
  grid,
  customGrid = false,
  mode = 'dimensions',
}: ToolbarContext): string {
  const control = (
    action: string,
    label: string,
    glyph: string,
    options: {
      shortcut?: string;
      keyHint?: string;
      selected?: boolean;
      disabled?: boolean;
      dimension?: boolean;
    } = {},
  ) =>
    button(
      action,
      `<span class="dock-tooltip" aria-hidden="true"><span>${label}</span>${options.keyHint || options.shortcut ? `<kbd>${options.keyHint ?? options.shortcut}</kbd>` : ''}</span>`,
      glyph,
      `dock-button${options.dimension ? ' dimension-tool' : ''}${options.selected ? ' active' : ''}`,
      `aria-label="${options.dimension ? `Add ${label.toLowerCase()} dimension` : label}"${options.selected === undefined ? '' : ` aria-pressed="${options.selected}"`}${options.shortcut ? ` aria-keyshortcuts="${options.shortcut}"` : ''}${options.disabled || !enabled ? ' disabled' : ''}`,
    );
  const divider = '<span class="dock-divider" aria-hidden="true"></span>';
  return `<div class="workspace-dock" role="toolbar" aria-label="Drawing tools">
    <div class="dock-mode-switch" role="group" aria-label="Drawing mode">${button('tab:dimensions', 'Dimensions', undefined, `dock-mode${mode === 'dimensions' ? ' active' : ''}`, `aria-pressed="${mode === 'dimensions'}"${enabled ? '' : ' disabled'}`)}${button('tab:annotations', 'Markup', undefined, `dock-mode${mode === 'annotations' ? ' active' : ''}`, `aria-pressed="${mode === 'annotations'}"${enabled ? '' : ' disabled'}`)}</div>
    ${divider}
    <div class="dock-group navigation-tools" role="group" aria-label="Navigation">${control('tool:select', mode === 'annotations' ? 'Select and move marks' : 'Select and move dimensions', 'pointer', { selected: tool === 'select', shortcut: 'Escape', keyHint: 'Esc' })}${control('tool:box-select', 'Box select dimensions', 'boxSelect', { selected: tool === 'box-select', shortcut: 'B' })}${control('tool:pan', 'Pan drawing', 'hand', { selected: tool === 'pan', shortcut: 'P' })}</div>
    ${divider}
    ${
      mode === 'annotations'
        ? `<div class="dock-group dimension-tools annotation-tools" role="group" aria-label="Markup">${(
            [
              ['text', 'Add text', 'text'],
              ['arrow', 'Add arrow', 'arrow'],
              ['rectangle', 'Add rectangle', 'rectangle'],
              ['ellipse', 'Add ellipse', 'ellipse'],
              ['freehand', 'Draw freehand', 'freehand'],
            ] as const
          )
            .map(([id, label, glyph]) =>
              control(`tool:${id}`, label, glyph, { selected: tool === id }),
            )
            .join('')}</div>`
        : `<div class="dock-group dimension-tools" role="group" aria-label="Add dimensions">${dimensionTools.map(({ id, label, icon, shortcut }) => control(`tool:${id}`, label, icon, { shortcut, selected: tool === id, dimension: true })).join('')}</div>`
    }
    ${divider}
    ${mode === 'dimensions' ? `<div class="dock-group automatic-tools" role="group" aria-label="Automatic dimensions">${control('auto-dimensions', 'Refresh automatic suggestions', 'magic')}${control('arrange-dimensions', 'Auto layout', 'layers')}</div>${divider}` : ''}
    <div class="dock-group history-tools" role="group" aria-label="History">${control('undo', 'Undo', 'undo', { disabled: !canUndo, shortcut: 'Control+Z Meta+Z', keyHint: 'Ctrl/⌘ Z' })}${control('redo', 'Redo', 'redo', { disabled: !canRedo, shortcut: 'Control+Shift+Z Meta+Shift+Z', keyHint: 'Ctrl/⌘ Shift Z' })}</div>
  </div>
  <div class="grid-dock" role="toolbar" aria-label="Grid controls"><span id="grid-density" class="grid-density" hidden></span>${control('toggle-grid', 'Show grid', 'grid', { selected: grid.visible, shortcut: 'G' })}${control('toggle-grid-snap', 'Snap to grid', 'magnet', { selected: grid.snap, shortcut: 'S' })}<span class="dock-divider" aria-hidden="true"></span>${renderGridSpacingEditor(grid.spacing, enabled, customGrid)}</div>
  <div class="viewport-dock" role="toolbar" aria-label="View controls">${control('zoom-out', 'Zoom out', 'minus', { keyHint: '-' })}<select id="zoom" aria-label="Sheet zoom" ${enabled ? '' : 'disabled'}>${zoomOptions}</select>${control('zoom-in', 'Zoom in', 'plus', { keyHint: '+' })}${divider}${control('fit', 'Fit sheet', 'fit', { shortcut: '0' })}</div>`;
}
