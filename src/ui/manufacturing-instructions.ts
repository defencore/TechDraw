const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!,
  );

export function renderManufacturingInstructions(
  text: string,
  enabled: boolean,
  options: { dirty?: boolean; locked?: boolean } = {},
): string {
  return `<section class="manufacturing-instructions" aria-label="Manufacturing instructions"><label class="field"><span>Manufacturing instructions</span><textarea id="manufacturing-instructions" data-user-content rows="10" maxlength="20000" placeholder="One manufacturing step per line" ${enabled ? '' : 'disabled'}>${escape(text)}</textarea></label><p class="field-help">Included on this part drawing, PDF and project archive.</p>${options.locked ? '<p class="field-help instructions-lock-hint">Locked drawing positions will be kept. Shorten the text or unlock items if it does not fit.</p>' : ''}<div class="instructions-editor-actions"><button type="button" data-instructions-action="apply" ${enabled && options.dirty !== false ? '' : 'disabled'}>Apply instructions</button><button type="button" data-instructions-action="reset" ${enabled && options.dirty !== false ? '' : 'disabled'}>Reset draft</button></div><p class="field-help">Apply to preview the instructions. Saving or exporting also includes pending instructions. Undo restores the previous instructions.</p></section>`;
}
