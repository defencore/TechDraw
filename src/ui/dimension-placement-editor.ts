import type { Dimension, ViewId } from '../model';
import { button, option } from './components';
import { escapeHtml } from './utils';

export interface PlacementControls {
  view: Exclude<ViewId, 'iso'>;
  mode: 'cascade' | 'align';
  gap: number;
}

/** Group operations are explicit and never change the measured geometry. */
export function renderDimensionPlacementEditor(
  dimensions: Dimension[],
  selected: ReadonlySet<string>,
  controls: PlacementControls,
  availableViews: readonly Exclude<ViewId, 'iso'>[] = ['front', 'top', 'right'],
): string {
  const count = dimensions.filter((dimension) => selected.has(dimension.id)).length;
  const hasLockedSelection = dimensions.some(
    (dimension) => selected.has(dimension.id) && dimension.locked,
  );
  return `<details class="placement-disclosure"${count > 1 ? ' open' : ''}><summary>${count > 1 ? 'Arrange selected dimensions' : 'Arrange dimensions'}</summary><section class="placement-editor" aria-label="Dimension arrangement">
    <div class="selection-tools"><label class="field"><span>View</span><select id="placement-view">${availableViews.map((view) => option(view, view[0].toUpperCase() + view.slice(1), controls.view)).join('')}</select></label>${button('select-view-dimensions', 'Select view', undefined, 'secondary compact', dimensions.length ? '' : 'disabled')}${button('clear-dimension-selection', 'Clear', undefined, 'text-button', count ? '' : 'disabled')}</div>
    <div class="field-row"><label class="field"><span>Arrangement</span><select id="placement-mode" title="Cascade uses separate lines; Align shares baselines when spans do not overlap.">${option('cascade', 'Cascade', controls.mode)}${option('align', 'Align', controls.mode)}</select></label><label class="field placement-gap"><span>Line gap (mm)</span><input id="placement-gap" type="number" min="7" max="100" step="1" value="${escapeHtml(controls.gap)}"/></label></div>
    <div class="placement-sides" role="group" aria-label="Move selected dimensions to side">${(['left', 'top', 'bottom', 'right'] as const).map((side) => button(`place-dimensions:${side}`, side[0].toUpperCase() + side.slice(1), `side${side[0].toUpperCase() + side.slice(1)}`, 'placement-side', `aria-label="Move selected dimensions ${side}"${count && !hasLockedSelection ? '' : ' disabled'}`)).join('')}</div>
    ${hasLockedSelection ? '<p class="locked-item-notice">Unlock the selection before editing or deleting it.</p>' : ''}
    <p class="field-help">Horizontal: top / bottom. Vertical: left / right. Radius and diameter: any side. Overlapping spans keep separate lines. Grid snap uses the step below the sheet.</p>
  </section></details>`;
}
