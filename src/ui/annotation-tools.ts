import type { DrawingAnnotation, Point2 } from '../model';
import { annotationBounds } from '../drawing/annotations';
import { annotationColor, DEFAULT_ANNOTATION_COLOR } from '../drawing/annotation-style';
import { distanceToSegment } from './dimension-picking';

export type AnnotationTool = DrawingAnnotation['kind'];
export interface AnnotationOptions {
  text: string;
  fontSize: number;
  strokeWidth: number;
  color: string;
}
export const defaultAnnotationOptions: AnnotationOptions = {
  text: '',
  fontSize: 3.5,
  strokeWidth: 0.35,
  color: DEFAULT_ANNOTATION_COLOR,
};
export function isAnnotationTool(tool: string): tool is AnnotationTool {
  return ['text', 'arrow', 'rectangle', 'ellipse', 'freehand'].includes(tool);
}
export function validateAnnotationOptions(options: AnnotationOptions): AnnotationOptions {
  if (
    typeof options.text !== 'string' ||
    options.text.length > 10000 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\uD800-\uDFFF]/u.test(options.text) ||
    !Number.isFinite(options.fontSize) ||
    options.fontSize < 1 ||
    options.fontSize > 100 ||
    !Number.isFinite(options.strokeWidth) ||
    options.strokeWidth < 0.1 ||
    options.strokeWidth > 10
  )
    throw new RangeError(
      'Use text up to 10000 characters, font size 1–100 mm and line width 0.1–10 mm.',
    );
  return { ...options, color: annotationColor(options.color) };
}
export function createAnnotation(
  tool: AnnotationTool,
  start: Point2,
  options: AnnotationOptions,
): DrawingAnnotation {
  const validated = validateAnnotationOptions(options);
  if (tool === 'text' && !options.text.trim()) throw new Error('Annotation text cannot be empty.');
  return {
    id: crypto.randomUUID(),
    kind: tool,
    points: tool === 'text' ? [[...start]] : [[...start], [...start]],
    strokeWidth: options.strokeWidth,
    color: validated.color,
    ...(tool === 'text' ? { text: options.text, fontSize: options.fontSize } : {}),
  };
}
export function extendAnnotation(
  annotation: DrawingAnnotation,
  point: Point2,
  minimumDistance = 0.2,
): DrawingAnnotation {
  if (annotation.kind === 'freehand') {
    if (!Number.isFinite(minimumDistance) || minimumDistance < 0)
      throw new RangeError('Freehand sample spacing must be a finite nonnegative distance.');
    const last = annotation.points.at(-1)!;
    if (Math.hypot(point[0] - last[0], point[1] - last[1]) < minimumDistance) return annotation;
    // Keep long strokes continuous within the project limit instead of freezing their endpoint.
    const points =
      annotation.points.length >= 4096
        ? annotation.points.filter((_point, index) => index % 2 === 0)
        : annotation.points;
    return { ...annotation, points: [...points, [...point]] };
  }
  return { ...annotation, points: [annotation.points[0], [...point]] };
}

/** Paper geometry is picked with a constant screen radius at every zoom. */
export function pickAnnotation(
  annotations: readonly DrawingAnnotation[],
  point: Point2,
  pixelsPerMm: number,
): string | undefined {
  const radius = 8 / pixelsPerMm;
  for (const annotation of [...annotations].reverse()) {
    const bounds = annotationBounds(annotation);
    if (
      point[0] < bounds.minX - radius ||
      point[0] > bounds.maxX + radius ||
      point[1] < bounds.minY - radius ||
      point[1] > bounds.maxY + radius
    )
      continue;
    if (annotation.kind === 'text') return annotation.id;
    const a = annotation.points[0],
      b = annotation.points.at(-1)!;
    let distance = Infinity;
    if (annotation.kind === 'rectangle') {
      const points: Point2[] = [a, [b[0], a[1]], b, [a[0], b[1]], a];
      distance = Math.min(...points.slice(1).map((p, i) => distanceToSegment(point, points[i], p)));
    } else if (annotation.kind === 'ellipse') {
      const cx = (a[0] + b[0]) / 2,
        cy = (a[1] + b[1]) / 2;
      const rx = Math.abs(b[0] - a[0]) / 2,
        ry = Math.abs(b[1] - a[1]) / 2;
      if (rx < 1e-9 || ry < 1e-9) distance = distanceToSegment(point, a, b);
      else {
        const angle = Math.atan2((point[1] - cy) / ry, (point[0] - cx) / rx);
        distance = Math.hypot(
          point[0] - cx - rx * Math.cos(angle),
          point[1] - cy - ry * Math.sin(angle),
        );
      }
    } else
      distance = Math.min(
        ...annotation.points
          .slice(1)
          .map((p, i) => distanceToSegment(point, annotation.points[i], p)),
      );
    if (distance <= radius + annotation.strokeWidth / 2) return annotation.id;
  }
}
