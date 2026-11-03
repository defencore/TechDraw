import type { DrawingSettings } from '../model';
import { button, field } from './components';
import { escapeHtml } from './utils';

/** The editor stays in English; frame labels follow the selected template language. */
export function renderTitleBlockEditor(s: DrawingSettings, partName?: string): string {
  const signoffs = [
    ['Drawn by', 'author', 'signature', 'date'],
    ['Checked by', 'checkedBy', 'checkedSignature', 'checkedDate'],
    ['Technical control', 'technicalControl', 'technicalControlSignature', 'technicalControlDate'],
    ['Standard control', 'standardControl', 'standardControlSignature', 'standardControlDate'],
    ['Approved by', 'approvedBy', 'approvedSignature', 'approvedDate'],
  ] as const;
  return `<div class="dimension-heading"><span class="section-label">TITLE BLOCK</span>${button('clear-title-block', 'Clear', 'trash', 'text-button', 'aria-label="Clear title block and cache" title="Clear all title block fields and their saved cache"')}</div>
    <div id="title-block-warning" aria-live="polite"></div>
    <p id="title-block-cache-status" class="field-help" aria-live="polite"></p>
    <p class="field-help">Clear starts a new title block. Model files are not cached.</p>
    ${field('Drawing title', 'title', s.title, partName ?? 'Use part name')}
    ${field('Drawing number', 'number', s.number, 'e.g. TD-001')}
    ${field('Material', 'material', s.material, 'Specify material')}
    ${field('Organization', 'organization', s.organization, 'Company or department')}
    <div class="field-row">${field('Mass (kg)', 'mass', s.mass)}${field('Document stage / litera', 'litera', s.litera)}</div>
    <div class="field-row">${field('Sheet number', 'sheetNumber', s.sheetNumber, 'Blank for one sheet')}${field('Total sheets', 'sheetCount', s.sheetCount, '1')}</div>
    <p class="field-help">Drawing scale is calculated from Page setup. Blank titles use the part name. These fields apply to the drawing set.</p>
    ${s.template === 'iso' || s.template === 'minimal' ? '<p class="field-help">Choose an ESKD frame to print the full sign-off and inventory sections below.</p>' : ''}
    <div class="inspector-rule"></div><div class="section-label">SIGN-OFF</div>
    ${signoffs.map(([label, name, signature, date], index) => `<details class="title-block-group" ${index === 0 ? 'open' : ''}><summary>${label}${s[name] ? `<span>${escapeHtml(s[name])}</span>` : ''}</summary>${field(`${label} — name`, name, s[name])}<div class="field-row">${field(`${label} — signature`, signature, s[signature])}${field(`${label} — date`, date, s[date], 'DD.MM.YY')}</div></details>`).join('')}
    <details class="title-block-group"><summary>Change record</summary><div class="field-row">${field('Change / revision', 'revision', s.revision)}${field('Changed sheet', 'changeSheet', s.changeSheet)}</div>${field('Change document', 'changeDocument', s.changeDocument)}<div class="field-row">${field('Change signature', 'changeSignature', s.changeSignature)}${field('Change date', 'changeDate', s.changeDate, 'DD.MM.YY')}</div></details>
    <details class="title-block-group"><summary>Inventory and filing</summary>${field('Original inventory number', 'inventoryNumber', s.inventoryNumber)}<div class="field-row">${field('Original filing signature', 'inventorySignature', s.inventorySignature)}${field('Original filing date', 'inventoryDate', s.inventoryDate)}</div>${field('Replaced inventory number', 'replacedInventoryNumber', s.replacedInventoryNumber)}${field('Duplicate inventory number', 'duplicateInventoryNumber', s.duplicateInventoryNumber)}<div class="field-row">${field('Duplicate filing signature', 'duplicateSignature', s.duplicateSignature)}${field('Duplicate filing date', 'duplicateDate', s.duplicateDate)}</div>${field('Copied by', 'copiedBy', s.copiedBy)}</details>
    <div class="inspector-rule"></div><div class="section-label">TECHNICAL REQUIREMENTS</div>
    ${field('General tolerance', 'tolerance', s.tolerance, 'e.g. ISO 2768-m')}
    <label class="field"><span>Technical notes</span><textarea maxlength="10000" data-setting="notes" rows="5">${escapeHtml(s.notes)}</textarea></label>`;
}
