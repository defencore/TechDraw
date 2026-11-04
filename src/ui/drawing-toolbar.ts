import type { DimensionKind } from '../model';
import { button } from './components';

export const dimensionTools: {
  id: DimensionKind;
  label: string;
  icon: string;
  shortcut: string;
  hint: string;
}[] = [
  {
    id: 'horizontal',
    label: 'Horizontal',
    icon: 'dimensionHorizontal',
    shortcut: 'H',
    hint: 'Pick a straight edge or two points, then click to place',
  },
  {
    id: 'vertical',
    label: 'Vertical',
    icon: 'dimensionVertical',
    shortcut: 'V',
    hint: 'Pick a straight edge or two points, then click to place',
  },
  {
    id: 'aligned',
    label: 'Aligned',
    icon: 'dimensionAligned',
    shortcut: 'L',
    hint: 'Pick a straight edge or two points, then click to place',
  },
  {
    id: 'diameter',
    label: 'Diameter',
    icon: 'dimensionDiameter',
    shortcut: 'D',
    hint: 'Pick a circular edge, then click to place',
  },
  {
    id: 'radius',
    label: 'Radius',
    icon: 'dimensionRadius',
    shortcut: 'R',
    hint: 'Pick a circular edge, then click to place',
  },
  {
    id: 'angle',
    label: 'Angle',
    icon: 'dimensionAngle',
    shortcut: 'A',
    hint: 'Pick two straight edges, then click to place',
  },
];

interface ToolbarContext {
  tool: 'select' | 'pan' | DimensionKind;
  enabled: boolean;
  canUndo: boolean;
  canRedo: boolean;
  zoomOptions: string;
}

export function renderDrawingToolbar({
  tool,
  enabled,
  canUndo,
  canRedo,
  zoomOptions,
}: ToolbarContext): string {
  return `<div class="drawing-toolbar" role="toolbar" aria-label="Drawing navigation">
    <div class="tool-group">${button('tool:select', 'Select', 'pointer', `tool-button named-tool ${tool === 'select' ? 'active' : ''}`, `aria-label="Select and move dimensions" aria-pressed="${tool === 'select'}" title="Select and move dimensions (Esc)"`)}${button('tool:pan', 'Pan', 'hand', `tool-button named-tool ${tool === 'pan' ? 'active' : ''}`, `aria-label="Pan drawing" aria-pressed="${tool === 'pan'}" title="Pan (Space + drag or middle mouse)"`)}<span class="toolbar-divider"></span>${button('auto-dimensions', 'Auto dimensions', 'dimension', 'quiet', `${enabled ? '' : 'disabled'} title="Generate suggested dimensions"`)}${button('arrange-dimensions', 'Arrange', 'layers', 'quiet', `${enabled ? '' : 'disabled'} title="Place smaller dimensions inside larger ones"`)}</div>
    <div class="tool-group viewport-tools">${button('undo', '', 'undo', 'icon-button', `aria-label="Undo" title="Undo (Ctrl/⌘ Z)" ${canUndo ? '' : 'disabled'}`)}${button('redo', '', 'redo', 'icon-button', `aria-label="Redo" title="Redo (Ctrl/⌘ Shift Z)" ${canRedo ? '' : 'disabled'}`)}<span class="toolbar-divider"></span>${button('fit', '', 'fit', 'icon-button', 'aria-label="Fit sheet" title="Fit sheet (0)"')}${button('zoom-out', '', 'minus', 'icon-button', 'aria-label="Zoom out" title="Zoom out (-)"')}<select id="zoom" aria-label="Sheet zoom">${zoomOptions}</select>${button('zoom-in', '', 'plus', 'icon-button', 'aria-label="Zoom in" title="Zoom in (+)"')}</div>
  </div>
  <div class="dimension-palette" role="toolbar" aria-label="Add dimensions"><span class="dimension-palette-heading">ADD DIMENSION</span><div class="dimension-tools">${dimensionTools.map(({ id, label, icon, shortcut, hint }) => button(`tool:${id}`, `<span>${label}</span>`, icon, `dimension-tool ${tool === id ? 'active' : ''}`, `aria-label="Add ${label.toLowerCase()} dimension" aria-pressed="${tool === id}" title="${label} (${shortcut}) · ${hint}" ${enabled ? '' : 'disabled'}`)).join('')}</div></div>`;
}
