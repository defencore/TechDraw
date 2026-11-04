import type { Bounds2, DrawingAnnotation, Point2 } from '../model';
import { measureDimensionText } from './dimension-label';
import { applyDrawingAppearance, type DrawingAppearance } from './appearance';

const xml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!,
  );
const n = (value: number) => Number(value.toFixed(5));
const point = (p: Point2) => `${n(p[0])},${n(p[1])}`;

export function annotationBounds(annotation: DrawingAnnotation): Bounds2 {
  const pad = annotation.strokeWidth / 2;
  if (annotation.kind === 'text') {
    const [x, y] = annotation.points[0],
      size = annotation.fontSize ?? 3.5;
    const lines = (annotation.text ?? '').replace(/\r\n?/g, '\n').split('\n');
    return {
      minX: x - 0.5,
      minY: y - size * 1.05,
      maxX: x + Math.max(1, ...lines.map((line) => measureDimensionText(line, size))) + 0.5,
      maxY: y + (lines.length - 1) * size * 1.35 + size * 0.3,
    };
  }
  const bounds = {
    minX: Math.min(...annotation.points.map((p) => p[0])) - pad,
    minY: Math.min(...annotation.points.map((p) => p[1])) - pad,
    maxX: Math.max(...annotation.points.map((p) => p[0])) + pad,
    maxY: Math.max(...annotation.points.map((p) => p[1])) + pad,
  };
  if (annotation.kind === 'arrow')
    for (const p of annotationArrow(annotation)) {
      bounds.minX = Math.min(bounds.minX, p[0] - pad);
      bounds.maxX = Math.max(bounds.maxX, p[0] + pad);
      bounds.minY = Math.min(bounds.minY, p[1] - pad);
      bounds.maxY = Math.max(bounds.maxY, p[1] + pad);
    }
  return bounds;
}

export function annotationArrow(annotation: DrawingAnnotation): Point2[] {
  const a = annotation.points[0],
    b = annotation.points.at(-1)!;
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const dx = (b[0] - a[0]) / length,
    dy = (b[1] - a[1]) / length;
  const head = Math.min(4, Math.max(2, length * 0.3));
  return [
    b,
    [b[0] - dx * head - dy * head * 0.35, b[1] - dy * head + dx * head * 0.35],
    [b[0] - dx * head + dy * head * 0.35, b[1] - dy * head - dx * head * 0.35],
  ];
}

/** Review annotations are anchored to the physical sheet, independent of every view transform. */
export function translateAnnotation(
  annotation: DrawingAnnotation,
  delta: Point2,
): DrawingAnnotation {
  if (!delta.every(Number.isFinite)) throw new RangeError('Annotation movement must be finite.');
  return {
    ...annotation,
    points: annotation.points.map((p) => [p[0] + delta[0], p[1] + delta[1]]),
  };
}

export function renderAnnotation(
  annotation: DrawingAnnotation,
  selected = false,
  appearance: DrawingAppearance = 'paper',
): string {
  const color = selected ? '#16745e' : '#20262b';
  const bounds = annotationBounds(annotation),
    a = annotation.points[0],
    b = annotation.points.at(-1)!;
  let content: string;
  if (annotation.kind === 'text') {
    const size = annotation.fontSize ?? 3.5;
    content =
      `<rect x="${n(bounds.minX)}" y="${n(bounds.minY)}" width="${n(bounds.maxX - bounds.minX)}" height="${n(bounds.maxY - bounds.minY)}" fill="white" stroke="none"/>` +
      (annotation.text ?? '')
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map(
          (line, index) =>
            `<text x="${n(a[0])}" y="${n(a[1] + index * size * 1.35)}" font-size="${size}" fill="${color}" stroke="none">${xml(line)}</text>`,
        )
        .join('');
  } else if (annotation.kind === 'rectangle') {
    content = `<rect x="${n(Math.min(a[0], b[0]))}" y="${n(Math.min(a[1], b[1]))}" width="${n(Math.abs(b[0] - a[0]))}" height="${n(Math.abs(b[1] - a[1]))}"/>`;
  } else if (annotation.kind === 'ellipse') {
    content = `<ellipse cx="${n((a[0] + b[0]) / 2)}" cy="${n((a[1] + b[1]) / 2)}" rx="${n(Math.abs(b[0] - a[0]) / 2)}" ry="${n(Math.abs(b[1] - a[1]) / 2)}"/>`;
  } else {
    content = `<path d="${annotation.points.map((p, index) => `${index ? 'L' : 'M'}${point(p)}`).join(' ')}"/>`;
    if (annotation.kind === 'arrow')
      content += `<path d="M${annotationArrow(annotation).map(point).join(' L')} Z" fill="${color}" stroke="none"/>`;
  }
  const selection = selected
    ? `<rect class="annotation-selection" x="${n(bounds.minX - 1)}" y="${n(bounds.minY - 1)}" width="${n(bounds.maxX - bounds.minX + 2)}" height="${n(bounds.maxY - bounds.minY + 2)}" fill="none" stroke="${color}" stroke-width=".2" stroke-dasharray="1 .7"/>`
    : '';
  return applyDrawingAppearance(
    `<g data-annotation-id="${xml(annotation.id)}" data-annotation-kind="${annotation.kind}" fill="none" stroke="${color}" stroke-width="${annotation.strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${content}${selection}</g>`,
    appearance,
  );
}

export function renderAnnotations(
  annotations: readonly DrawingAnnotation[],
  appearance: DrawingAppearance = 'paper',
): string {
  return `<g data-review-annotations="">${annotations.map((annotation) => renderAnnotation(annotation, false, appearance)).join('')}</g>`;
}
