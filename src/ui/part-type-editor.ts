import type { ManufacturingProfile, ManufacturingProfileType, Part } from '../model';
import {
  PART_TYPES,
  activeManufacturingProfile,
  effectivePartType,
  manufacturingParameterSections,
  manufacturingProfileDefinition,
  manufacturingProfileFields,
  type ManufacturingFieldDefinition,
} from '../manufacturing/catalog';
import { icon } from './icons';
import { t } from './i18n';
import { escapeHtml as e } from './utils';

/** Capture raw profile text; shared validation runs only when the draft is committed. */
export function captureManufacturingProfile(root: ParentNode): ManufacturingProfile {
  const form = root.querySelector<HTMLElement>('#manufacturing-profile-form');
  const type = form?.dataset.profileType;
  if (!form || !type || type === 'auto' || !PART_TYPES.some((entry) => entry.id === type))
    return { fields: {}, parameters: [] };
  const allowed = new Set(
    manufacturingProfileFields(type as ManufacturingProfileType).map((field) => field.key),
  );
  const fields = Object.fromEntries(
    [...form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-profile-field]')]
      .filter((field) => allowed.has(field.dataset.profileField ?? ''))
      .map((field) => [field.dataset.profileField!, field.value]),
  );
  const parameters = [
    ...form.querySelectorAll<HTMLElement>('.manufacturing-parameter-row[data-parameter-id]'),
  ].map((row) => {
    const value = (key: string) =>
      row.querySelector<HTMLInputElement>(`[data-parameter-field="${key}"]`)?.value ?? '';
    return {
      id: row.dataset.parameterId ?? '',
      label: value('label'),
      symbol: value('symbol'),
      value: value('value'),
    };
  });
  const custom = form.querySelector<HTMLInputElement>('#manufacturing-custom-name');
  return { fields, parameters, ...(custom ? { customName: custom.value } : {}) };
}

/** The type selector and contextual editor are siblings, so Gear keeps its own native form. */
export function renderPartTypeEditor(
  part: Part,
  draft?: ManufacturingProfile,
  enabled = true,
  supplementalEditor = '',
): string {
  const selected = part.manufacturing?.type ?? 'auto';
  const type = effectivePartType(part);
  const automatic = effectivePartType({
    ...part,
    manufacturing: { type: 'auto', profiles: part.manufacturing?.profiles ?? {} },
  });
  const automaticLabel = PART_TYPES.find((entry) => entry.id === automatic)!.label;
  const disabled = enabled ? '' : ' disabled';
  const selector = `<h2 class="part-type-heading">${e(t('Part type'))}</h2><label class="field"><span>${e(t('Drawing profile'))}</span><select id="part-type" data-manufacturing-type${disabled}>${PART_TYPES.map((entry) => `<option value="${entry.id}"${entry.id === selected ? ' selected' : ''}>${e(t(entry.label))}${entry.id === 'auto' ? ` · ${e(t(automaticLabel))}` : ''}</option>`).join('')}</select></label><p class="part-type-selection-help">${e(t('Only the selected type controls the printed parameter table. Other type settings are kept.'))}</p>${selected === 'auto' ? `<p class="field-help">${e(t('Automatic currently uses {type}.', { type: t(automaticLabel) }))}</p>` : ''}`;
  const definition = manufacturingProfileDefinition(type);
  const profile = draft ?? activeManufacturingProfile(part) ?? { fields: {}, parameters: [] };
  const field = (
    label: string,
    value: string,
    attributes: string,
    maximum: number,
    multiline = false,
    symbol?: string,
  ) =>
    `<label class="field"><span>${e(t(label))}${symbol ? ` (${e(symbol)})` : ''}</span>${multiline ? `<textarea data-user-content ${attributes} rows="3" maxlength="${maximum}">${e(value)}</textarea>` : `<input ${attributes} maxlength="${maximum}" value="${e(value)}"/>`}</label>`;
  const profileField = (entry: ManufacturingFieldDefinition) =>
    field(
      entry.label,
      profile.fields[entry.key] ?? '',
      `data-profile-field="${e(entry.key)}"`,
      entry.multiline ? 1000 : 400,
      entry.multiline,
      entry.symbol,
    );
  const primaryFields = definition.fields.map(profileField).join('');
  const primaryFilled = definition.fields.some((entry) => profile.fields[entry.key]?.trim());
  const primary =
    type === 'general' || type === 'custom'
      ? `<details class="manufacturing-universal-group manufacturing-general-requirements"${primaryFilled ? ' open' : ''}><summary><span>${e(t('General requirements'))}</span>${primaryFilled ? `<span class="manufacturing-filled-indicator" aria-label="${e(t('Has entered values'))}">${icon('check')}</span>` : ''}</summary><div class="manufacturing-universal-body">${primaryFields}</div></details>`
      : primaryFields;
  const seen = new Set(definition.fields.map((entry) => entry.key));
  const groups = manufacturingParameterSections()
    .map((section) => {
      const entries = section.fields.filter((entry) => {
        if (seen.has(entry.key)) return false;
        seen.add(entry.key);
        return true;
      });
      if (!entries.length) return '';
      const filled = entries.some((entry) => profile.fields[entry.key]?.trim());
      return `<details class="manufacturing-universal-group" data-manufacturing-section="${e(section.id)}"${filled ? ' open' : ''}><summary><span>${e(t(section.label))}</span>${filled ? `<span class="manufacturing-filled-indicator" aria-label="${e(t('Has entered values'))}">${icon('check')}</span>` : ''}</summary><div class="manufacturing-universal-body">${entries.map(profileField).join('')}</div></details>`;
    })
    .join('');
  const rows = profile.parameters
    .map(
      (row, index) =>
        `<div class="manufacturing-parameter-row" data-parameter-id="${e(row.id)}"><div class="manufacturing-parameter-heading"><strong>${e(t('Parameter {number}', { number: index + 1 }))}</strong><button type="button" data-profile-action="remove-row" data-parameter-id="${e(row.id)}" aria-label="${e(t('Remove parameter {number}', { number: index + 1 }))}" title="${e(t('Remove parameter {number}', { number: index + 1 }))}">${icon('trash')}</button></div>${field('Parameter name', row.label, 'data-parameter-field="label"', 80)}<div class="manufacturing-parameter-values">${field('Symbol', row.symbol ?? '', 'data-parameter-field="symbol"', 24)}${field('Value / requirement', row.value, 'data-parameter-field="value"', 400)}</div></div>`,
    )
    .join('');
  const editor = `<form id="manufacturing-profile-form" data-profile-type="${type}" novalidate><fieldset class="manufacturing-profile-fields"${disabled}><div class="section-label">${e(t(definition.label))}</div><p class="field-help">${e(t('Enter requirements to print on this part drawing. Values do not change the imported geometry.'))}</p>${type !== 'gear' ? field(type === 'custom' ? 'Custom type name' : 'Profile name (optional)', profile.customName ?? '', 'id="manufacturing-custom-name"', 80) : ''}${primary}<div class="manufacturing-universal-heading"><strong>${e(t('Universal parameters'))}</strong><p class="field-help">${e(t('Add requirements from any section for this part.'))} ${e(t('Only filled fields are printed.'))}</p></div>${groups}<details class="manufacturing-parameters"${rows || type === 'custom' ? ' open' : ''}><summary>${e(t('Additional parameters'))}</summary><div class="manufacturing-parameters-body">${rows || `<p class="field-help">${e(t('Add a named requirement or parameter.'))}</p>`}<button type="button" data-profile-action="add-row"${profile.parameters.length >= 20 ? ' disabled' : ''}>${icon('plus')}${e(t('Add parameter'))}</button></div></details><div class="manufacturing-profile-actions"><button type="submit" data-profile-action="apply">${e(t('Apply part requirements'))}</button><button type="button" data-profile-action="reset">${e(t('Reset draft'))}</button></div></fieldset></form>`;
  return `<section class="part-type-editor" aria-label="${e(t('Part type'))}">${selector}${supplementalEditor}${editor}</section>`;
}
