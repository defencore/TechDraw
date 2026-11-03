import type { Point2 } from '../model';

export interface PickRectangle {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function containsPaddedRectangle(
  point: Point2,
  rectangle: PickRectangle,
  padding = 0,
): boolean {
  return (
    point[0] >= rectangle.left - padding &&
    point[0] <= rectangle.right + padding &&
    point[1] >= rectangle.top - padding &&
    point[1] <= rectangle.bottom + padding
  );
}

export function distanceToSegment(point: Point2, a: Point2, b: Point2): number {
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  const squared = dx * dx + dy * dy;
  const fraction =
    squared > 0
      ? Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / squared))
      : 0;
  return Math.hypot(point[0] - a[0] - fraction * dx, point[1] - a[1] - fraction * dy);
}

function screenPoint(point: { x: number; y: number }, matrix: DOMMatrix): Point2 {
  return [
    matrix.a * point.x + matrix.c * point.y + matrix.e,
    matrix.b * point.x + matrix.d * point.y + matrix.f,
  ];
}

function gripDistance(element: SVGGraphicsElement, client: Point2): number {
  const matrix = element.getScreenCTM();
  if (
    !matrix ||
    ![matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f].every(Number.isFinite)
  )
    return Infinity;
  const screenScale = Math.max(Math.hypot(matrix.a, matrix.b), Math.hypot(matrix.c, matrix.d));
  if (screenScale < 1e-12) return Infinity;
  if (element.tagName.toLowerCase() === 'line') {
    const line = element as SVGLineElement;
    const a = screenPoint({ x: line.x1.baseVal.value, y: line.y1.baseVal.value }, matrix);
    const b = screenPoint({ x: line.x2.baseVal.value, y: line.y2.baseVal.value }, matrix);
    return distanceToSegment(client, a, b);
  }
  if (element.tagName.toLowerCase() === 'path') {
    const path = element as SVGPathElement;
    const length = path.getTotalLength();
    if (!Number.isFinite(length) || length <= 0) return Infinity;
    // At most 64 screen-transformed points; the usual short arc needs far fewer.
    const segments = Math.max(4, Math.min(63, Math.ceil((length * screenScale) / 4)));
    let previous = screenPoint(path.getPointAtLength(0), matrix),
      closest = Infinity;
    for (let index = 1; index <= segments; index++) {
      const next = screenPoint(path.getPointAtLength((length * index) / segments), matrix);
      closest = Math.min(closest, distanceToSegment(client, previous, next));
      previous = next;
    }
    return closest;
  }
  return Infinity;
}

/** Pick labels first, then dimension strokes within a stable screen-pixel radius. */
export function pickDimension(
  svg: SVGSVGElement,
  client: Point2,
  radiusPx = 8,
): string | undefined {
  if (!client.every(Number.isFinite) || !Number.isFinite(radiusPx) || radiusPx < 0) return;
  const groups = [...svg.querySelectorAll<SVGGElement>('[data-dimension-id]')].reverse();
  let labelId: string | undefined,
    labelDistance = Infinity;
  for (const group of groups) {
    const id = group.getAttribute('data-dimension-id');
    if (!id) continue;
    for (const label of group.querySelectorAll<SVGGraphicsElement>(
      '[data-dimension-grip="label"]',
    )) {
      const bounds = label.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0 || !containsPaddedRectangle(client, bounds, 4))
        continue;
      const distance = Math.hypot(
        client[0] - (bounds.left + bounds.right) / 2,
        client[1] - (bounds.top + bounds.bottom) / 2,
      );
      if (distance < labelDistance) {
        labelDistance = distance;
        labelId = id;
      }
    }
  }
  if (labelId) return labelId;
  let lineId: string | undefined,
    closest = radiusPx;
  for (const group of groups) {
    const id = group.getAttribute('data-dimension-id');
    if (!id) continue;
    for (const grip of group.querySelectorAll<SVGGraphicsElement>('[data-dimension-grip="line"]')) {
      try {
        const distance = gripDistance(grip, client);
        if (distance <= closest && (lineId === undefined || distance < closest - 1e-9)) {
          closest = distance;
          lineId = id;
        }
      } catch {
        // Detached or hidden SVG geometry can lose its browser measurement state mid-frame.
      }
    }
  }
  return lineId;
}
