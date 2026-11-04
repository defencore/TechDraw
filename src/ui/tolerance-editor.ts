import type { Dimension, DimensionTolerance } from '../model';
import { button, option } from './components';
import { escapeHtml as e } from './utils';

export type ToleranceMode = 'none' | DimensionTolerance['kind'];

export function renderToleranceFields(mode: ToleranceMode, dimension: Dimension): string {
  const tolerance = dimension.tolerance;
  const unit = dimension.kind === 'angle' ? '°' : 'mm';
  const input = (label: string, key: string, value: string, decimal = true) =>
    `<label class="field"><span>${label}</span><input data-tolerance-field="${key}" aria-label="${label}" value="${e(value)}" maxlength="32" autocomplete="off"${decimal ? ' inputmode="decimal"' : ''}/></label>`;
  if (mode === 'symmetric')
    return `${input(`Symmetric deviation (± ${unit})`, 'magnitude', tolerance?.kind === mode ? tolerance.magnitude : '')}<p class="field-help">Enter a non-negative deviation. The measured size stays unchanged.</p>`;
  if (mode === 'deviation')
    return `<div class="field-row">${input(`Upper deviation (${unit})`, 'upper', tolerance?.kind === mode ? tolerance.upper : '')}${input(`Lower deviation (${unit})`, 'lower', tolerance?.kind === mode ? tolerance.lower : '')}</div><p class="field-help">Use signed deviations from the measured size. Upper must be greater than or equal to lower. Enter 0 for zero.</p>`;
  if (mode === 'fit')
    return `${input('Fit designation', 'designation', tolerance?.kind === mode ? tolerance.designation : '', false)}<p class="field-help">For example H7, g6 or H7/g6. Enter a verified designation; numeric limits are not calculated.</p>`;
  return '<p class="field-help">Choose a tolerance type to add it beside this dimension.</p>';
}

export function renderToleranceEditor(dimension: Dimension): string {
  const mode = dimension.tolerance?.kind ?? 'none';
  return `<div class="inspector-rule"></div><div class="dimension-heading"><span class="section-label">TOLERANCE</span>${button('remove-tolerance', 'Clear', undefined, 'text-button', `aria-label="Clear dimension tolerance" ${!dimension.tolerance ? 'disabled' : ''}`)}</div>
    <label class="field"><span>Tolerance type</span><select id="tolerance-kind" aria-label="Tolerance type">${option('none', 'None', mode)}${option('symmetric', 'Symmetric ±', mode)}${option('deviation', 'Upper / lower deviations', mode)}${dimension.kind === 'angle' ? '' : option('fit', 'Fit designation', mode)}</select></label>
    <div id="tolerance-fields">${renderToleranceFields(mode, dimension)}</div>
    <p id="tolerance-preview" class="field-help" aria-live="polite"></p>
    <p id="tolerance-error" class="layout-warning" role="alert" hidden></p>
    ${button('apply-tolerance', 'Apply tolerance', undefined, 'secondary tolerance-apply', mode === 'none' && !dimension.tolerance ? 'disabled' : '')}
    <p class="field-help">Apply saves the tolerance to this dimension and its PDF. Undo restores the previous value. Use Arrange if labels need more space.</p><div class="inspector-rule"></div>`;
}
