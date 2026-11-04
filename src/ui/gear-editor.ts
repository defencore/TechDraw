import type { GearSpecification, Part } from '../model';
import {
  gearReferenceDiameter,
  gearSourceHints,
  missingGearFields,
  parseGearSpecification,
} from '../gears/specification';
import { button } from './components';
import { t } from './i18n';
import { escapeHtml as e } from './utils';

export type GearEditorDraft = Partial<Record<keyof GearSpecification, string>>;
const numericFields = [
  'teeth',
  'normalModule',
  'normalPressureAngle',
  'profileShift',
  'helixAngle',
] as const;
const textFields = [
  'profileReference',
  'accuracy',
  'inspection',
  'toothSurfaceFinish',
  'heatTreatment',
  'toothEdge',
] as const;
const fields = ['type', ...numericFields, 'helixHand', ...textFields] as const;
const labels: Record<keyof GearSpecification, string> = {
  type: 'Gear type',
  teeth: 'Tooth count',
  normalModule: 'Normal module',
  normalPressureAngle: 'Normal pressure angle',
  profileShift: 'Profile shift',
  helixAngle: 'Helix angle',
  helixHand: 'Helix hand',
  profileReference: 'Basic rack / tooth profile',
  accuracy: 'Accuracy and backlash',
  inspection: 'Inspection dimensions',
  toothSurfaceFinish: 'Tooth flank finish',
  heatTreatment: 'Heat treatment and hardness',
  toothEdge: 'Tooth edge treatment',
};

/** Raw input remains separate from the validated engineering specification. */
export function captureGearEditor(root: ParentNode): GearEditorDraft {
  const draft: GearEditorDraft = {};
  for (const field of root.querySelectorAll<
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  >('[data-gear-field]')) {
    const key = field.dataset.gearField as keyof GearSpecification;
    if (fields.includes(key)) draft[key] = field.value;
  }
  return draft;
}

export function parseGearEditorDraft(draft: GearEditorDraft): GearSpecification {
  if (draft.type !== 'external-spur' && draft.type !== 'external-helical')
    return parseGearSpecification({ type: draft.type });
  const raw: Record<string, unknown> = { type: draft.type };
  for (const key of numericFields) {
    if (key === 'helixAngle' && draft.type !== 'external-helical') continue;
    const value = draft[key]?.trim() ?? '';
    if (!value) continue;
    if (!/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(value))
      throw new Error(t('Enter a decimal value for {field}.', { field: t(labels[key]) }));
    raw[key] = Number(value.replace(',', '.'));
  }
  if (draft.type === 'external-helical' && draft.helixHand?.trim()) raw.helixHand = draft.helixHand;
  for (const key of textFields) if (draft[key]?.trim()) raw[key] = draft[key];
  return parseGearSpecification(raw);
}

export function readGearEditor(root: ParentNode): GearSpecification {
  return parseGearEditorDraft(captureGearEditor(root));
}

/** Switching gear type does not erase the temporarily inactive helical draft. */
export function syncGearEditorType(root: ParentNode): void {
  const form = root.querySelector<HTMLElement>('#gear-editor-form');
  const type = root.querySelector<HTMLSelectElement>('#gear-type');
  const helical = root.querySelector<HTMLFieldSetElement>('.gear-helical-fields');
  if (helical)
    helical.disabled = form?.dataset.enabled !== 'true' || type?.value !== 'external-helical';
}

/** Symbol insertion uses the current text selection and the normal draft input event. */
export function handleGearEditorClick(root: ParentNode, target: Element): boolean {
  const control = target.closest<HTMLButtonElement>('[data-gear-symbol]');
  if (!control) return false;
  const symbol = control.dataset.gearSymbol;
  const key = control.dataset.gearSymbolTarget;
  if (
    !['±', 'Ø'].includes(symbol ?? '') ||
    !['inspection', 'toothSurfaceFinish'].includes(key ?? '')
  )
    return false;
  const field = root.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    `[data-gear-field="${key}"]`,
  );
  if (!field || field.disabled || control.disabled || control.closest('fieldset:disabled'))
    return true;
  const start = field.selectionStart ?? field.value.length;
  const end = field.selectionEnd ?? start;
  field.setRangeText(symbol!, start, end, 'end');
  field.focus({ preventScroll: true });
  field.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}

export function renderGearEditor(
  part: Part,
  draft?: GearSpecification | GearEditorDraft,
  enabled = true,
): string {
  const geometry = part.features?.gear;
  const source = draft ?? part.gearSpecification;
  const values: GearEditorDraft = {};
  for (const key of fields) if (source?.[key] !== undefined) values[key] = String(source[key]);
  if (values.teeth === undefined && geometry) values.teeth = String(geometry.toothCount);
  const type = values.type ?? '';
  const hint = gearSourceHints(part);
  const disabled = enabled ? '' : ' disabled';
  const numberField = (key: (typeof numericFields)[number], unit = '') =>
    `<label class="field"><span>${e(t(labels[key]))}${unit ? ` (${e(t(unit))})` : ''}</span><input data-gear-field="${key}" type="text" inputmode="${key === 'teeth' ? 'numeric' : 'decimal'}" maxlength="32" value="${e(values[key] ?? '')}" placeholder="${e(t('Specify'))}" autocomplete="off"/></label>`;
  const symbolButtons = (key: 'inspection' | 'toothSurfaceFinish') =>
    `<div class="gear-symbols" role="group" aria-label="${e(t('Insert a symbol'))}">${['±', 'Ø'].map((symbol) => `<button type="button" data-gear-symbol="${symbol}" data-gear-symbol-target="${key}" aria-label="${e(t(symbol === '±' ? 'Insert plus-minus sign' : 'Insert diameter sign'))}">${symbol}</button>`).join('')}</div>`;
  const textField = (key: (typeof textFields)[number], multiline = false) =>
    `<label class="field"><span>${e(t(labels[key]))}</span>${multiline ? `<textarea data-user-content data-gear-field="${key}" maxlength="1000" rows="3">${e(values[key] ?? '')}</textarea>` : `<input data-gear-field="${key}" maxlength="400" value="${e(values[key] ?? '')}" placeholder="${e(t('Specify'))}"/>`}</label>${key === 'inspection' || key === 'toothSurfaceFinish' ? symbolButtons(key) : ''}`;
  const measured = (label: string, value: number | undefined, unit = 'mm') =>
    value === undefined
      ? ''
      : `<div><dt>${e(t(label))}</dt><dd>${Number(value.toFixed(4))}${unit ? ` ${e(t(unit))}` : ''}</dd></div>`;
  const sourceGeometry = geometry
    ? `<section class="gear-measured"><div class="gear-section-heading"><strong>${e(t('Measured geometry'))}</strong><span class="gear-source-badge">${e(t('From STEP'))}</span></div><dl>${measured('Tooth count', geometry.toothCount, '')}${measured('Outside diameter', geometry.outsideDiameter)}${measured('Face width', geometry.faceWidth)}${measured('Bore diameter', geometry.boreDiameter)}${measured('Root diameter', geometry.rootDiameter)}${measured('Hub diameter', geometry.hubDiameter)}${measured('Overall length', geometry.overallLength)}</dl><p>${e(t('These measurements do not verify the tooth profile or manufacturing specification.'))}</p></section>`
    : `<p class="field-help">${e(t('No gear geometry was detected. Enter the specification manually.'))}</p>`;
  const hints =
    hint.teeth !== undefined || hint.normalModule !== undefined
      ? `<details class="gear-source-hints"><summary>${e(t('Unverified source-name hints'))}</summary><p>${hint.teeth !== undefined ? `${e(t('Tooth count'))}: ${hint.teeth}. ` : ''}${hint.normalModule !== undefined ? `${e(t('Module'))}: ${hint.normalModule}.` : ''}</p><p>${e(t('Names are labels, not manufacturing data. Values are not applied automatically.'))}</p></details>`
      : '';
  let specification: GearSpecification | undefined;
  let invalidDraft = false;
  try {
    specification = parseGearEditorDraft(values);
  } catch {
    invalidDraft = Boolean(type);
  }
  const missing = missingGearFields({ ...part, gearSpecification: undefined }, specification);
  const status = invalidDraft
    ? `<p class="gear-data-status">${e(t('Unapplied draft. Apply checks the current values.'))}</p>`
    : `<div class="gear-data-status" role="status"><strong>${e(t(missing.length ? 'Manufacturing data needs review' : 'Review the supplied gear data before manufacture'))}</strong>${missing.length ? `<p>${e(t('Still to specify'))}: ${missing.map((label) => e(t(label))).join(', ')}.</p>` : ''}</div>`;
  const reference = specification
    ? gearReferenceDiameter(specification, geometry?.toothCount)
    : undefined;
  const mismatch =
    geometry && specification?.teeth !== undefined && specification.teeth !== geometry.toothCount
      ? `<p class="gear-data-status">${e(t('The supplied tooth count differs from the measured geometry. Review both before manufacture.'))}</p>`
      : '';
  return `<section class="gear-editor" aria-label="${e(t('Gear parameters'))}"><div class="gear-editor-heading"><h2>${e(t('Gear setup'))}</h2><span class="gear-source-badge">${e(t(part.gearSpecification ? 'Engineer supplied' : 'Draft'))}</span></div>${sourceGeometry}${hints}<form id="gear-editor-form" data-enabled="${enabled}" novalidate><fieldset class="gear-fields"${disabled}><label class="field"><span>${e(t('Gear type'))}</span><select id="gear-type" data-gear-field="type"><option value=""${!type ? ' selected' : ''}>${e(t('Choose gear type'))}</option><option value="external-spur"${type === 'external-spur' ? ' selected' : ''}>${e(t('External spur gear'))}</option><option value="external-helical"${type === 'external-helical' ? ' selected' : ''}>${e(t('External helical gear'))}</option></select></label><div class="field-row">${numberField('teeth')}${numberField('normalModule', 'mm')}</div><div class="field-row">${numberField('normalPressureAngle', '°')}${numberField('profileShift', 'x')}</div><p class="field-help">${e(t('Module and pressure angle use the normal system. No pressure angle or profile shift is assumed.'))}</p><fieldset class="gear-helical-fields"${enabled && type === 'external-helical' ? '' : ' disabled'}><legend>${e(t('Helical gears only'))}</legend><div class="field-row">${numberField('helixAngle', '°')}<label class="field"><span>${e(t('Helix hand'))}</span><select data-gear-field="helixHand"><option value="">${e(t('Choose direction'))}</option><option value="left"${values.helixHand === 'left' ? ' selected' : ''}>${e(t('Left-hand'))}</option><option value="right"${values.helixHand === 'right' ? ' selected' : ''}>${e(t('Right-hand'))}</option></select></label></div></fieldset><details class="gear-details"><summary>${e(t('Profile, accuracy and inspection'))}</summary>${textField('profileReference')}${textField('accuracy')}${textField('inspection', true)}<p class="field-help">${e(t('Enter the applicable profile and accuracy standard. Specify a verified inspection method and its limits.'))}</p></details><details class="gear-details"><summary>${e(t('Finish and treatment'))}</summary>${textField('toothSurfaceFinish')}${textField('heatTreatment')}${textField('toothEdge')}</details>${reference === undefined ? '' : `<p class="gear-reference"><span>${e(t('Calculated reference diameter'))}</span><strong>${Number(reference.toFixed(4))} ${e(t('mm'))}</strong></p>`}${status}${mismatch}<p class="field-help">${e(t('Material is defined in Title block for the drawing set.'))} ${button('tab:details', 'Open title block', undefined, 'text-button')}</p><div class="gear-editor-actions"><button type="submit" data-gear-action="apply">${e(t('Apply gear data'))}</button><button type="button" data-gear-action="reset">${e(t('Reset draft'))}</button>${part.gearSpecification ? `<button type="button" data-gear-action="remove">${e(t('Remove gear data'))}</button>` : ''}</div></fieldset></form><p class="field-help">${e(t('The parameter table appears on this part drawing. Removing supplied data keeps detected geometry and its draft table.'))}</p></section>`;
}
