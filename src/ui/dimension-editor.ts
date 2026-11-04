import type { Dimension } from '../model';
import { button } from './components';
import { escapeHtml as e } from './utils';
import { renderToleranceEditor } from './tolerance-editor';
import { t } from './i18n';

export function renderDimensionEditor(dimension: Dimension, precision: number): string {
  const symbol = dimension.kind === 'diameter' ? 'Ø' : dimension.kind === 'radius' ? 'R' : '';
  return `<section class="dimension-editor" aria-label="Selected dimension">
    <div class="dimension-editor-header"><div><span class="section-label">SELECTED DIMENSION</span><div class="dimension-value">${symbol}${dimension.value.toFixed(precision)}<span>${dimension.kind === 'angle' ? '°' : 'mm'}</span></div></div>${button('delete-dimension', 'Delete', 'trash', 'text-button dimension-delete', 'aria-label="Delete selected dimension"')}</div>
    <p class="field-help">${t(dimension.viewId[0].toUpperCase() + dimension.viewId.slice(1))} · ${t(dimension.kind)} · ${t(dimension.automatic ? 'Automatic' : 'Manual')}. ${t('Drag its label or line to move it.')}</p>
    ${renderToleranceEditor(dimension)}
    <details class="dimension-advanced"><summary>Position and notes</summary><label class="field"><span>Distance from geometry (mm on paper)</span><input type="number" data-dimension-setting="offset" value="${dimension.offset.toFixed(1)}" step="1"/></label><label class="field"><span>Prefix</span><input maxlength="120" data-dimension-setting="prefix" value="${e(dimension.prefix ?? '')}" placeholder="Optional"/></label><label class="field"><span>Note after value</span><input maxlength="120" data-dimension-setting="suffix" value="${e(dimension.suffix ?? '')}" placeholder="Optional note"/></label></details>
  </section>`;
}
