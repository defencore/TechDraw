import type { Dimension } from '../model';
import { button } from './components';
import { escapeHtml as e } from './utils';
import { renderToleranceEditor } from './tolerance-editor';
import { t } from './i18n';

export function renderDimensionEditor(
  dimension: Dimension,
  precision: number,
  selection = { count: 1, lockedCount: dimension.locked ? 1 : 0 },
): string {
  const symbol = dimension.kind === 'diameter' ? 'Ø' : dimension.kind === 'radius' ? 'R' : '';
  const allLocked = selection.count > 0 && selection.lockedCount === selection.count;
  return `<section class="dimension-editor" aria-label="Selected dimension">
    <div class="dimension-editor-header"><div><span class="section-label">SELECTED DIMENSION</span><div class="dimension-value">${symbol}${dimension.value.toFixed(precision)}<span>${dimension.kind === 'angle' ? '°' : 'mm'}</span></div></div><div class="dimension-editor-actions">${button('toggle-selection-lock', allLocked ? 'Unlock' : 'Lock', allLocked ? 'unlock' : 'lock', 'item-lock-button', `aria-label="${allLocked ? 'Unlock selection' : 'Lock selection'}" aria-pressed="${allLocked}"`)}${button('delete-dimension', 'Delete', 'trash', 'text-button dimension-delete', `aria-label="Delete selected dimension"${selection.lockedCount ? ' disabled' : ''}`)}</div></div>
    <p class="field-help">${t(dimension.viewId[0].toUpperCase() + dimension.viewId.slice(1))} · ${t(dimension.kind)} · ${t(dimension.automatic ? 'Automatic' : 'Manual')}.${selection.lockedCount ? '' : ` ${t('Drag its label or line to move it.')}`}</p>
    ${dimension.locked ? '<p class="locked-item-notice" role="status">Locked. Unlock to move, edit or delete this dimension.</p>' : ''}
    <fieldset class="dimension-edit-fields"${dimension.locked ? ' disabled' : ''}>
    ${renderToleranceEditor(dimension)}
    <details class="dimension-advanced"><summary>Position and notes</summary><label class="field"><span>Distance from geometry (mm on paper)</span><input type="number" data-dimension-setting="offset" value="${dimension.offset.toFixed(1)}" step="1"/></label><label class="field"><span>Prefix</span><input maxlength="120" data-dimension-setting="prefix" value="${e(dimension.prefix ?? '')}" placeholder="Optional"/></label><label class="field"><span>Note after value</span><input maxlength="120" data-dimension-setting="suffix" value="${e(dimension.suffix ?? '')}" placeholder="Optional note"/></label></details>
    </fieldset>
  </section>`;
}
