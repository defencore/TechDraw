import type { DrawingAnnotation } from '../model';
import { validateAnnotationOptions, type AnnotationOptions } from './annotation-tools';
import { escapeHtml as e } from './utils';

interface TextAnnotationEditorContext {
  annotation?: DrawingAnnotation;
  options: AnnotationOptions;
}

/** One native form handles both text creation and editing without touching document geometry. */
export function renderTextAnnotationEditor({
  annotation,
  options,
}: TextAnnotationEditorContext): string {
  const values = validateAnnotationOptions({
    ...options,
    text: annotation?.text ?? options.text,
    fontSize: annotation?.fontSize ?? options.fontSize,
    color: annotation?.color ?? options.color,
    strokeWidth: annotation?.strokeWidth ?? options.strokeWidth,
  });
  const colors = [
    ['Red', '#e34d59'],
    ['Amber', '#d28b00'],
    ['Green', '#14836b'],
    ['Blue', '#2678d4'],
    ['Purple', '#8b5bd6'],
    ['Gray', '#5c697a'],
  ];
  return `<form id="text-note-form" class="text-note-form" aria-labelledby="text-note-title"><header class="text-note-heading"><h2 id="text-note-title">${annotation ? 'Edit text note' : 'Add text note'}</h2></header><div class="text-note-body"><label class="text-note-field" for="text-note-content"><span>Text</span><textarea id="text-note-content" data-user-content rows="4" maxlength="10000" placeholder="Type your note…" aria-describedby="text-note-error" required>${e(values.text)}</textarea></label><div class="text-note-color-field"><span class="text-note-label">Color</span><div class="text-note-palette" role="group" aria-label="Annotation colors">${colors.map(([name, color]) => `<button type="button" class="text-note-swatch" data-text-note-color="${color}" style="--text-note-swatch:${color}" aria-label="${name}" aria-pressed="${values.color === color}"><span aria-hidden="true"></span></button>`).join('')}</div></div><div class="text-note-settings"><label class="text-note-field text-note-custom-color" for="text-note-color"><span>Custom color</span><input id="text-note-color" data-user-content type="color" value="${values.color}"/></label><label class="text-note-field" for="text-note-font-size"><span>Text size (mm)</span><input id="text-note-font-size" type="number" inputmode="decimal" min="1" max="100" step="any" value="${values.fontSize}" required/></label></div><div class="text-note-preview-section"><span class="text-note-label">Preview</span><div class="text-note-preview-shell"><div id="text-note-preview" data-user-content aria-label="Text preview" style="color:${values.color};font-size:${values.fontSize}mm">${e(values.text)}</div></div></div><p id="text-note-error" class="text-note-error" role="alert" hidden></p></div><footer class="text-note-actions"><button type="button" data-text-note-action="cancel">Cancel</button><button type="submit" class="text-note-submit">${annotation ? 'Save changes' : 'Add note'}</button></footer></form>`;
}
