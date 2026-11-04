import type { DimensionKind } from '../model';
import { button } from './components';
import type { GridSettings } from './drawing-grid';

export const dimensionTools: {
  id: DimensionKind;
  label: string;
  icon: string;
  shortcut: string;
}[] = [
  {
    id: 'horizontal',
    label: 'Horizontal',
    icon: 'dimensionHorizontal',
    shortcut: 'H',
  },
  {
    id: 'vertical',
    label: 'Vertical',
    icon: 'dimensionVertical',
    shortcut: 'V',
  },
  {
    id: 'aligned',
    label: 'Aligned',
    icon: 'dimensionAligned',
    shortcut: 'L',
  },
  {
    id: 'diameter',
    label: 'Diameter',
    icon: 'dimensionDiameter',
    shortcut: 'D',
  },
  {
    id: 'radius',
    label: 'Radius',
    icon: 'dimensionRadius',
    shortcut: 'R',
  },
  {
    id: 'angle',
    label: 'Angle',
    icon: 'dimensionAngle',
    shortcut: 'A',
  },
];

interface ToolbarContext {
  tool: 'select' | 'pan' | DimensionKind;
  enabled: boolean;
  canUndo: boolean;
  canRedo: boolean;
  zoomOptions: string;
  grid: GridSettings;
}

export function renderWorkspaceControls({
  tool,
  enabled,
  canUndo,
  canRedo,
  zoomOptions,
  grid,
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
    <div class="dock-group navigation-tools" role="group" aria-label="Navigation">${control('tool:select', 'Select and move dimensions', 'pointer', { selected: tool === 'select', shortcut: 'Escape', keyHint: 'Esc' })}${control('tool:pan', 'Pan drawing', 'hand', { selected: tool === 'pan', keyHint: 'Space' })}</div>
    ${divider}
    <div class="dock-group dimension-tools" role="group" aria-label="Add dimensions">${dimensionTools.map(({ id, label, icon, shortcut }) => control(`tool:${id}`, label, icon, { shortcut, selected: tool === id, dimension: true })).join('')}</div>
    ${divider}
    <div class="dock-group automatic-tools" role="group" aria-label="Automatic dimensions">${control('auto-dimensions', 'Refresh automatic suggestions', 'magic')}${control('arrange-dimensions', 'Auto layout', 'layers')}</div>
    ${divider}
    <div class="dock-group history-tools" role="group" aria-label="History">${control('undo', 'Undo', 'undo', { disabled: !canUndo, shortcut: 'Control+Z Meta+Z', keyHint: 'Ctrl/⌘ Z' })}${control('redo', 'Redo', 'redo', { disabled: !canRedo, shortcut: 'Control+Shift+Z Meta+Shift+Z', keyHint: 'Ctrl/⌘ Shift Z' })}</div>
  </div>
  <div class="grid-dock" role="toolbar" aria-label="Grid controls"><span id="grid-density" class="grid-density" hidden></span>${control('toggle-grid', 'Show grid', 'grid', { selected: grid.visible, shortcut: 'G' })}${control('toggle-grid-snap', 'Snap to grid', 'magnet', { selected: grid.snap, shortcut: 'S' })}<span class="dock-divider" aria-hidden="true"></span><label class="grid-step"><input id="grid-spacing" aria-label="Grid step in millimetres on paper" type="number" min="0.1" max="100" step="0.1" value="${grid.spacing}" list="grid-presets" ${enabled ? '' : 'disabled'}/><span>mm</span></label><datalist id="grid-presets">${[1, 2, 5, 10, 20].map((value) => `<option value="${value}"></option>`).join('')}</datalist></div>
  <div class="viewport-dock" role="toolbar" aria-label="View controls">${control('zoom-out', 'Zoom out', 'minus', { keyHint: '-' })}<select id="zoom" aria-label="Sheet zoom" ${enabled ? '' : 'disabled'}>${zoomOptions}</select>${control('zoom-in', 'Zoom in', 'plus', { keyHint: '+' })}${divider}${control('fit', 'Fit sheet', 'fit', { shortcut: '0' })}</div>`;
}
