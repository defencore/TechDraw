import type { DrawingAnnotation } from '../model';
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

/** A regular inline form supports keyboard and touch editing without modal prompts. */
export function renderAnnotationEditor(
  annotation?: DrawingAnnotation,
  options = defaultAnnotationOptions,
): string {
  const text = annotation?.text ?? options.text,
    fontSize = annotation?.fontSize ?? options.fontSize;
  const coordinate = (name: string, label: string, value: number) =>
    `<label>${label} (mm)<input data-annotation-coordinate="${name}" type="number" step="0.1" value="${value}"/></label>`;
  let geometry = '';
  if (annotation) {
    const a = annotation.points[0],
      b = annotation.points.at(-1)!;
    geometry = `<details class="annotation-geometry-editor"><summary>Position and size</summary>${coordinate('x', 'Anchor X', a[0])}${coordinate('y', 'Anchor Y', a[1])}${['arrow', 'rectangle', 'ellipse'].includes(annotation.kind) ? coordinate('width', 'Width', Math.abs(b[0] - a[0])) + coordinate('height', 'Height', Math.abs(b[1] - a[1])) : ''}</details>`;
  }
  return `<section class="annotation-editor" aria-label="Review annotations"><div class="section-label">${annotation ? 'EDIT ANNOTATION' : 'REVIEW ANNOTATIONS'}</div>${!annotation || annotation.kind === 'text' ? `<label>Text<textarea id="annotation-text" data-annotation-setting="text" rows="3" placeholder="Enter a note, then click the sheet to place it">${escape(text)}</textarea></label><label>Text size (mm)<input id="annotation-font-size" data-annotation-setting="fontSize" type="number" min="1" max="100" step="0.5" value="${fontSize}"/></label>` : ''}<label>Line width (mm)<input id="annotation-stroke-width" data-annotation-setting="strokeWidth" type="number" min="0.1" max="10" step="0.05" value="${annotation?.strokeWidth ?? options.strokeWidth}"/></label>${geometry}${annotation ? `<div class="annotation-editor-actions"><button type="button" data-annotation-action="apply">Apply changes</button><button type="button" data-annotation-action="delete">Delete annotation</button></div>` : '<p class="field-help">Choose Text, Arrow, Rectangle, Ellipse or Freehand. Drag a graphic on the sheet; click to place text. Select an annotation to move or edit it.</p>'}</section>`;
}

export function readAnnotationOptions(
  root: ParentNode,
  defaults = defaultAnnotationOptions,
): AnnotationOptions {
  return validateAnnotationOptions({
    text:
      root.querySelector<HTMLTextAreaElement>('[data-annotation-setting="text"]')?.value ??
      defaults.text,
    fontSize: Number(
      root.querySelector<HTMLInputElement>('[data-annotation-setting="fontSize"]')?.value ??
        defaults.fontSize,
    ),
    strokeWidth: Number(
      root.querySelector<HTMLInputElement>('[data-annotation-setting="strokeWidth"]')?.value ??
        defaults.strokeWidth,
    ),
  });
}

export function readAnnotationEdit(
  root: ParentNode,
  annotation: DrawingAnnotation,
): DrawingAnnotation {
  const options = readAnnotationOptions(root, {
    ...defaultAnnotationOptions,
    text: annotation.text ?? '',
    fontSize: annotation.fontSize ?? 3.5,
    strokeWidth: annotation.strokeWidth,
  });
  if (annotation.kind === 'text' && !options.text.trim())
    throw new Error('Annotation text cannot be empty.');
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
    ...(annotation.kind === 'text' ? { text: options.text, fontSize: options.fontSize } : {}),
  };
}
