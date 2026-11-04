import type { DrawingAnnotation } from '../model';
import { annotationColor } from '../drawing/annotation-style';
import { icon } from './icons';
import {
  defaultAnnotationOptions,
  validateAnnotationOptions,
  type AnnotationOptions,
} from './annotation-tools';
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!,
  );

/** Text opens the unified composer; graphics keep their inline editing controls. */
export function renderAnnotationEditor(
  annotation?: DrawingAnnotation,
  options = defaultAnnotationOptions,
  tool?: string,
): string {
  const text = annotation?.text ?? options.text,
    fontSize = annotation?.fontSize ?? options.fontSize;
  const color = annotationColor(annotation ? annotation.color : options.color);
  const lockControl = annotation
    ? `<button type="button" class="item-lock-button" data-annotation-action="lock" aria-label="${annotation.locked ? 'Unlock annotation' : 'Lock annotation'}" aria-pressed="${!!annotation.locked}">${icon(annotation.locked ? 'unlock' : 'lock')}<span>${annotation.locked ? 'Unlock' : 'Lock'}</span></button>`
    : '';
  if (annotation?.kind === 'text')
    return `<section class="annotation-editor annotation-text-summary" aria-label="Text note"><div class="annotation-editor-header"><div class="section-label">Text note</div>${lockControl}</div>${annotation.locked ? '<p class="locked-item-notice" role="status">Locked. Unlock to move, edit or delete this annotation.</p>' : ''}<p class="annotation-note-content" data-user-content>${escape(text)}</p><p class="field-help">${fontSize} mm</p><fieldset class="annotation-edit-fields"${annotation.locked ? ' disabled' : ''}><div class="annotation-editor-actions"><button type="button" data-annotation-action="edit-text">Edit text</button><button type="button" data-annotation-action="delete">Delete annotation</button></div></fieldset></section>`;
  if (!annotation && tool === 'text') return '';
  const colors = [
    ['Red', '#e34d59'],
    ['Amber', '#d28b00'],
    ['Green', '#14836b'],
    ['Blue', '#2678d4'],
    ['Purple', '#8b5bd6'],
    ['Gray', '#5c697a'],
  ];
  const colorControls = `<div class="annotation-colors"><span class="field-label">Color</span><div class="annotation-color-palette" role="group" aria-label="Annotation colors">${colors.map(([name, value]) => `<button type="button" class="annotation-color-swatch" data-annotation-color="${value}" style="--annotation-color:${value}" aria-label="${name}" aria-pressed="${color === value}"><span aria-hidden="true"></span></button>`).join('')}<label class="annotation-custom-color"><span>Custom color</span><input id="annotation-color" data-annotation-setting="color" data-user-content type="color" value="${color}" aria-label="Custom color"/></label></div></div>`;
  const coordinate = (name: string, label: string, value: number) =>
    `<label>${label} (mm)<input data-annotation-coordinate="${name}" type="number" step="0.1" value="${value}"/></label>`;
  let geometry = '';
  if (annotation) {
    const a = annotation.points[0],
      b = annotation.points.at(-1)!;
    geometry = `<details class="annotation-geometry-editor"><summary>Position and size</summary>${coordinate('x', 'Anchor X', a[0])}${coordinate('y', 'Anchor Y', a[1])}${['arrow', 'rectangle', 'ellipse'].includes(annotation.kind) ? coordinate('width', 'Width', Math.abs(b[0] - a[0])) + coordinate('height', 'Height', Math.abs(b[1] - a[1])) : ''}</details>`;
  }
  return `<section class="annotation-editor" aria-label="Review annotations"><div class="annotation-editor-header"><div class="section-label">${annotation ? 'EDIT ANNOTATION' : 'REVIEW ANNOTATIONS'}</div>${lockControl}</div>${annotation?.locked ? '<p class="locked-item-notice" role="status">Locked. Unlock to move, edit or delete this annotation.</p>' : ''}<fieldset class="annotation-edit-fields"${annotation?.locked ? ' disabled' : ''}>${colorControls}<label>Line width (mm)<input id="annotation-stroke-width" data-annotation-setting="strokeWidth" type="number" min="0.1" max="10" step="0.05" value="${annotation?.strokeWidth ?? options.strokeWidth}"/></label>${geometry}${annotation ? `<div class="annotation-editor-actions"><button type="button" data-annotation-action="apply">Apply changes</button><button type="button" data-annotation-action="delete">Delete annotation</button></div>` : `<p class="field-help">Choose Arrow, Rectangle, Ellipse or Freehand, then drag on the drawing.</p>`}</fieldset></section>`;
}

export function readAnnotationOptions(
  root: ParentNode,
  defaults = defaultAnnotationOptions,
): AnnotationOptions {
  return validateAnnotationOptions({
    text: defaults.text,
    fontSize: defaults.fontSize,
    strokeWidth: Number(
      root.querySelector<HTMLInputElement>('[data-annotation-setting="strokeWidth"]')?.value ??
        defaults.strokeWidth,
    ),
    color:
      root.querySelector<HTMLInputElement>('[data-annotation-setting="color"]')?.value ??
      defaults.color,
  });
}

export function readAnnotationEdit(
  root: ParentNode,
  annotation: DrawingAnnotation,
): DrawingAnnotation {
  if (annotation.kind === 'text')
    throw new TypeError('Text notes must be edited with the text annotation editor.');
  const options = readAnnotationOptions(root, {
    ...defaultAnnotationOptions,
    strokeWidth: annotation.strokeWidth,
    color: annotationColor(annotation.color),
  });
  const read = (name: string, fallback: number): number => {
    const control = root.querySelector<HTMLInputElement>(`[data-annotation-coordinate="${name}"]`);
    const value = control ? Number(control.value) : fallback;
    if (!Number.isFinite(value) || Math.abs(value) > 10000 || control?.value === '')
      throw new Error('Annotation positions and sizes must be finite paper millimetres.');
    return value;
  };
  const a = annotation.points[0],
    b = annotation.points.at(-1)!;
  const x = read('x', a[0]),
    y = read('y', a[1]);
  let points = annotation.points.map((p) => [p[0] + x - a[0], p[1] + y - a[1]] as [number, number]);
  if (['arrow', 'rectangle', 'ellipse'].includes(annotation.kind)) {
    const width = read('width', Math.abs(b[0] - a[0])),
      height = read('height', Math.abs(b[1] - a[1]));
    if (
      width < 0 ||
      height < 0 ||
      (annotation.kind === 'arrow' ? width + height < 0.1 : width < 0.1 || height < 0.1)
    )
      throw new Error('Use a visible positive graphic size.');
    points = [
      [x, y],
      [x + (Math.sign(b[0] - a[0]) || 1) * width, y + (Math.sign(b[1] - a[1]) || 1) * height],
    ];
  }
  if (points.some((p) => p.some((value) => Math.abs(value) > 10000)))
    throw new Error('Annotation points exceed the supported sheet coordinates.');
  return {
    ...annotation,
    points,
    strokeWidth: options.strokeWidth,
    color: options.color,
  };
}
