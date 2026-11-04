import type { Dimension, DimensionTolerance } from '../model';
import { button } from './components';
import { escapeHtml as e } from './utils';

export type ToleranceMode = 'none' | DimensionTolerance['kind'];

export function renderToleranceFields(mode: ToleranceMode, dimension: Dimension): string {
  const tolerance = dimension.tolerance;
  const unit = dimension.kind === 'angle' ? 'degrees' : 'mm';
  const input = (label: string, key: string, value: string, decimal = true) =>
    `<label class="field"><span>${label}</span><input data-tolerance-field="${key}" aria-label="${label}" value="${e(value)}" maxlength="32" autocomplete="off"${decimal ? ' inputmode="decimal"' : ''}/></label>`;
  if (mode === 'symmetric')
    return `<label class="field"><span>Deviation (${unit})</span><span class="tolerance-number"><span class="tolerance-adornment" aria-hidden="true">±</span><input data-tolerance-field="magnitude" aria-label="Symmetric deviation (${unit})" value="${e(tolerance?.kind === mode ? tolerance.magnitude : '')}" maxlength="32" autocomplete="off" inputmode="decimal"/></span></label><p class="field-help">Enter only the number; ± is added automatically. The measured size stays unchanged.</p>`;
  if (mode === 'deviation') {
    const signedField = (key: 'upper' | 'lower', label: string) => {
      const value = tolerance?.kind === mode ? tolerance[key] : '';
      const sign = value ? (value.startsWith('-') ? '-' : '+') : undefined;
      const signButton = (next: '+' | '-') =>
        `<button type="button" class="tolerance-sign-button${sign === next ? ' active' : ''}" data-tolerance-sign="${next}" data-tolerance-target="${key}" aria-pressed="${sign === next}" aria-label="Make ${key} deviation ${next === '+' ? 'positive' : 'negative'}" title="Make ${key} deviation ${next === '+' ? 'positive' : 'negative'}">${next}</button>`;
      return `<div class="field"><label class="tolerance-field-label" for="tolerance-${key}">${label} (${unit})</label><span class="tolerance-number"><input id="tolerance-${key}" data-tolerance-field="${key}" aria-label="${label} (${unit})" value="${e(value)}" maxlength="32" autocomplete="off" inputmode="decimal"/><span class="tolerance-sign-controls" role="group" aria-label="${label} sign">${signButton('+')}${signButton('-')}</span></span></div>`;
    };
    return `<div class="field-row">${signedField('upper', 'Upper deviation')}${signedField('lower', 'Lower deviation')}</div><p class="field-help">Enter deviations from the measured size. Use + or - to choose each sign. Upper must be greater than or equal to lower. Enter 0 for zero.</p>`;
  }
  if (mode === 'fit')
    return `${input('Fit designation', 'designation', tolerance?.kind === mode ? tolerance.designation : '', false)}<p class="field-help">For example H7, g6 or H7/g6. Enter a verified designation; numeric limits are not calculated.</p>`;
  return '<p class="field-help">No tolerance is shown for this dimension. Choose a mode above to add one.</p>';
}

export function renderToleranceEditor(dimension: Dimension): string {
  const mode = dimension.tolerance?.kind ?? 'none';
  const modes: { value: ToleranceMode; label: string }[] = [
    { value: 'none', label: 'None' },
    { value: 'symmetric', label: 'Symmetric ±' },
    { value: 'deviation', label: 'Limits' },
    { value: 'fit', label: 'Fit' },
  ];
  const controls = modes
    .map((item) => {
      const selected = item.value === mode,
        disabled = item.value === 'fit' && dimension.kind === 'angle';
      return `<button type="button" id="tolerance-mode-${item.value}" class="tolerance-mode${selected ? ' active' : ''}" data-tolerance-mode="${item.value}" role="radio" aria-checked="${selected}" tabindex="${selected ? '0' : '-1'}" aria-controls="tolerance-fields"${disabled ? ' disabled title="Fits apply to length dimensions"' : ''}>${item.label}</button>`;
    })
    .join('');
  return `<div class="inspector-rule"></div><div class="dimension-heading"><span class="section-label">TOLERANCE</span>${button('remove-tolerance', 'Clear', undefined, 'text-button', `aria-label="Clear dimension tolerance" ${!dimension.tolerance ? 'disabled' : ''}`)}</div>
    <div id="tolerance-modes" class="tolerance-modes" role="radiogroup" aria-label="Tolerance type">${controls}</div>
    <div id="tolerance-fields">${renderToleranceFields(mode, dimension)}</div>
    <p id="tolerance-preview" class="field-help" aria-live="polite"></p>
    <p id="tolerance-error" class="layout-warning" role="alert" hidden></p>
    ${button('apply-tolerance', 'Apply tolerance', undefined, 'secondary tolerance-apply', mode === 'none' && !dimension.tolerance ? 'disabled' : '')}
    <p class="field-help">Apply saves the tolerance to this dimension and its PDF. Undo restores the previous value. Use Arrange if labels need more space.</p><div class="inspector-rule"></div>`;
}
