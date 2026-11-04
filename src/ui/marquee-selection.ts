import type { Bounds2, Point2 } from '../model';
import type { DimensionGeometry } from '../drawing/dimension-geometry';

export interface MarqueeRegion {
  bounds: Bounds2;
  crossing: boolean;
}
export interface MarqueeItem {
  id: string;
  geometry: DimensionGeometry;
}
const EPSILON = 1e-9;
const containsPoint = (bounds: Bounds2, point: Point2): boolean =>
  point[0] >= bounds.minX - EPSILON &&
  point[0] <= bounds.maxX + EPSILON &&
  point[1] >= bounds.minY - EPSILON &&
  point[1] <= bounds.maxY + EPSILON;
const intersectsBounds = (a: Bounds2, b: Bounds2): boolean =>
  a.minX <= b.maxX + EPSILON &&
  a.maxX >= b.minX - EPSILON &&
  a.minY <= b.maxY + EPSILON &&
  a.maxY >= b.minY - EPSILON;

export function marqueeRegion(start: Point2, end: Point2): MarqueeRegion {
  if (![...start, ...end].every(Number.isFinite))
    throw new RangeError('A selection box needs finite sheet coordinates.');
  return {
    crossing: end[0] < start[0],
    bounds: {
      minX: Math.min(start[0], end[0]),
      maxX: Math.max(start[0], end[0]),
      minY: Math.min(start[1], end[1]),
      maxY: Math.max(start[1], end[1]),
    },
  };
}

/** Clip a segment parametrically; bounding-box overlap alone includes empty leader space. */
function segmentIntersects(bounds: Bounds2, a: Point2, b: Point2): boolean {
  let minimum = 0,
    maximum = 1;
  for (const axis of [0, 1] as const) {
    const low = axis === 0 ? bounds.minX : bounds.minY;
    const high = axis === 0 ? bounds.maxX : bounds.maxY;
    const delta = b[axis] - a[axis];
    if (Math.abs(delta) < EPSILON) {
      if (a[axis] < low - EPSILON || a[axis] > high + EPSILON) return false;
    } else {
      const first = (low - a[axis]) / delta,
        last = (high - a[axis]) / delta;
      minimum = Math.max(minimum, Math.min(first, last));
      maximum = Math.min(maximum, Math.max(first, last));
      if (minimum > maximum + EPSILON) return false;
    }
  }
  return true;
}

function arcIntersects(bounds: Bounds2, arc: DimensionGeometry['arcs'][number]): boolean {
  if (containsPoint(bounds, arc.a) || containsPoint(bounds, arc.b)) return true;
  const onArc = (point: Point2): boolean => {
    const angle = Math.atan2(point[1] - arc.center[1], point[0] - arc.center[0]);
    const turn = Math.PI * 2;
    const travel =
      (((arc.delta >= 0 ? angle - arc.start : arc.start - angle) % turn) + turn) % turn;
    return travel <= Math.abs(arc.delta) + EPSILON;
  };
  // Exact intersections with the box's four sides avoid zoom-dependent curve sampling.
  for (const x of [bounds.minX, bounds.maxX]) {
    const squared = arc.radius ** 2 - (x - arc.center[0]) ** 2;
    if (squared < -EPSILON) continue;
    for (const sign of [-1, 1]) {
      const point: Point2 = [x, arc.center[1] + sign * Math.sqrt(Math.max(0, squared))];
      if (containsPoint(bounds, point) && onArc(point)) return true;
    }
  }
  for (const y of [bounds.minY, bounds.maxY]) {
    const squared = arc.radius ** 2 - (y - arc.center[1]) ** 2;
    if (squared < -EPSILON) continue;
    for (const sign of [-1, 1]) {
      const point: Point2 = [arc.center[0] + sign * Math.sqrt(Math.max(0, squared)), y];
      if (containsPoint(bounds, point) && onArc(point)) return true;
    }
  }
  return false;
}

function polygonIntersects(bounds: Bounds2, polygon: Point2[]): boolean {
  if (
    polygon.some((point, index) =>
      segmentIntersects(bounds, point, polygon[(index + 1) % polygon.length]),
    )
  )
    return true;
  // A small box may be entirely inside the filled label or arrowhead.
  const corner: Point2 = [bounds.minX, bounds.minY];
  let positive = false,
    negative = false;
  for (let index = 0; index < polygon.length; index++) {
    const a = polygon[index],
      b = polygon[(index + 1) % polygon.length];
    const cross = (b[0] - a[0]) * (corner[1] - a[1]) - (b[1] - a[1]) * (corner[0] - a[0]);
    if (cross > EPSILON) positive = true;
    if (cross < -EPSILON) negative = true;
  }
  return !(positive && negative);
}

function labelPolygon(geometry: DimensionGeometry): Point2[] {
  const {
    origin,
    angle,
    data: { bounds },
  } = geometry.label;
  const radians = (angle * Math.PI) / 180,
    cos = Math.cos(radians),
    sin = Math.sin(radians);
  return [
    [bounds.minX, bounds.minY],
    [bounds.maxX, bounds.minY],
    [bounds.maxX, bounds.maxY],
    [bounds.minX, bounds.maxY],
  ].map(([x, y]) => [origin[0] + x * cos - y * sin, origin[1] + x * sin + y * cos]);
}

/** LTR contains complete annotations; RTL crosses actual labels, lines, arrowheads or arcs. */
export function selectMarquee(items: readonly MarqueeItem[], start: Point2, end: Point2): string[] {
  const { bounds, crossing } = marqueeRegion(start, end);
  return items
    .filter(({ geometry }) => {
      if (!intersectsBounds(bounds, geometry.bounds)) return false;
      if (!crossing)
        return (
          containsPoint(bounds, [geometry.bounds.minX, geometry.bounds.minY]) &&
          containsPoint(bounds, [geometry.bounds.maxX, geometry.bounds.maxY])
        );
      return (
        (intersectsBounds(bounds, geometry.labelBounds) &&
          polygonIntersects(bounds, labelPolygon(geometry))) ||
        geometry.lines.some((line) => segmentIntersects(bounds, line.a, line.b)) ||
        geometry.arcs.some((arc) => arcIntersects(bounds, arc)) ||
        geometry.arrows.some((triangle) => polygonIntersects(bounds, triangle))
      );
    })
    .map((item) => item.id);
}
