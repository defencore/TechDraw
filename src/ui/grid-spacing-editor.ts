import { t } from './i18n';
import { escapeHtml as e } from './utils';

export const GRID_PRESETS = [1, 1.25, 2.54, 5, 10] as const;

/** Custom remains explicit even when its entered value equals a common preset. */
export function renderGridSpacingEditor(
  spacing: number,
  enabled: boolean,
  custom: boolean,
): string {
  const customSelected = custom || !GRID_PRESETS.some((value) => value === spacing);
  const disabled = enabled ? '' : ' disabled';
  return `<div class="grid-spacing-editor${customSelected ? ' custom' : ''}"><label class="grid-preset-label"><span class="sr-only">${e(t('Grid spacing on paper'))}</span><select id="grid-preset" aria-label="${e(t('Grid spacing on paper'))}"${disabled}>${GRID_PRESETS.map((value) => `<option value="${value}"${!customSelected && value === spacing ? ' selected' : ''}>${value}×${value} ${e(t('mm'))}</option>`).join('')}<option value="custom"${customSelected ? ' selected' : ''}>${e(t('Custom…'))}</option></select></label>${customSelected ? `<label class="grid-custom-spacing"><span class="sr-only">${e(t('Custom grid step'))}</span><input id="grid-spacing" aria-label="${e(t('Custom grid step'))}" type="number" min="0.1" max="100" step="0.01" value="${e(String(spacing))}"${disabled}/><span aria-hidden="true">${e(t('mm'))}</span></label>` : ''}</div>`;
}
