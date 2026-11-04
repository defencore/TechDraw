import type { Bounds2, Dimension, DrawingLayout, Point2, ViewId } from '../model';
import {
  DIMENSION_LABEL_GAP,
  dimensionLabelBoundsAt,
  dimensionLeaderMetrics,
  formatDimensionLabel,
  type DimensionLabel,
} from './dimension-label';

export type ViewTransform = DrawingLayout['viewTransforms'][ViewId];
export interface AnnotationLine {
  a: Point2;
  b: Point2;
  grip: boolean;
  kind: 'extension' | 'dimension' | 'leader' | 'ray';
}
export interface AnnotationArc {
  center: Point2;
  radius: number;
  start: number;
  delta: number;
  a: Point2;
  b: Point2;
}
export interface DimensionGeometry {
  lines: AnnotationLine[];
  arcs: AnnotationArc[];
  arrows: [Point2, Point2, Point2][];
  label: { origin: Point2; angle: number; data: DimensionLabel };
  labelBounds: Bounds2;
  bounds: Bounds2;
}

export function toPaper(point: Point2, transform: ViewTransform): Point2 {
  return [transform.x + point[0] * transform.scale, transform.y - point[1] * transform.scale];
}
function arrow(tip: Point2, towardBase: Point2): [Point2, Point2, Point2] {
  const length = Math.hypot(...towardBase) || 1,
    ux = towardBase[0] / length,
    uy = towardBase[1] / length;
  const base: Point2 = [tip[0] + ux * 2.7, tip[1] + uy * 2.7];
  return [
    tip,
    [base[0] - uy * 0.85, base[1] + ux * 0.85],
    [base[0] + uy * 0.85, base[1] - ux * 0.85],
  ];
}
function onArc(angle: number, start: number, delta: number): boolean {
  const turn = Math.PI * 2;
  const distance = (((delta >= 0 ? angle - start : start - angle) % turn) + turn) % turn;
  return distance <= Math.abs(delta) + 1e-10;
}

/** One physical annotation description supplies both SVG primitives and exact layout bounds. */
export function dimensionGeometry(
  dimension: Dimension,
  transform: ViewTransform,
  precision: number,
): DimensionGeometry {
  const a = toPaper(dimension.a, transform),
    b = toPaper(dimension.b, transform);
  const data = formatDimensionLabel(dimension, precision),
    half = data.width / 2;
  const baseline = -DIMENSION_LABEL_GAP - data.bounds.maxY;
  const movement: Point2 = dimension.textOffset ?? [0, 0];
  const lines: AnnotationLine[] = [],
    arcs: AnnotationArc[] = [],
    arrows: [Point2, Point2, Point2][] = [];
  let origin: Point2 = [0, 0],
    angle = 0;
  const addLine = (start: Point2, end: Point2, kind: AnnotationLine['kind']) =>
    lines.push({ a: start, b: end, grip: kind === 'dimension' || kind === 'leader', kind });
  const extension = (anchor: Point2, target: Point2) => {
    const dx = target[0] - anchor[0],
      dy = target[1] - anchor[1],
      distance = Math.hypot(dx, dy);
    if (distance < 1) return;
    const ux = dx / distance,
      uy = dy / distance;
    addLine(
      [anchor[0] + ux, anchor[1] + uy],
      [target[0] + ux * 2, target[1] + uy * 2],
      'extension',
    );
  };
  const dimensionLine = (start: Point2, end: Point2) => {
    addLine(start, end, 'dimension');
    arrows.push(
      arrow(start, [end[0] - start[0], end[1] - start[1]]),
      arrow(end, [start[0] - end[0], start[1] - end[1]]),
    );
  };
  if (dimension.kind === 'horizontal') {
    const y = Math.max(a[1], b[1]) + dimension.offset,
      left = Math.min(a[0], b[0]),
      right = Math.max(a[0], b[0]);
    const short = right - left < data.width + 5;
    extension(a, [a[0], y]);
    extension(b, [b[0], y]);
    if (short) {
      addLine([left, y], [right, y], 'dimension');
      addLine([left - 4, y], [left, y], 'dimension');
      addLine([right + 4, y], [right, y], 'dimension');
      arrows.push(arrow([left, y], [-1, 0]), arrow([right, y], [1, 0]));
    } else dimensionLine([a[0], y], [b[0], y]);
    origin = [short ? right + 5 + half : (a[0] + b[0]) / 2, y + baseline];
  } else if (dimension.kind === 'vertical') {
    const x = Math.min(a[0], b[0]) - dimension.offset,
      top = Math.min(a[1], b[1]),
      bottom = Math.max(a[1], b[1]);
    const short = bottom - top < data.width + 5;
    extension(a, [x, a[1]]);
    extension(b, [x, b[1]]);
    if (short) {
      addLine([x, top], [x, bottom], 'dimension');
      addLine([x, top - 4], [x, top], 'dimension');
      addLine([x, bottom + 4], [x, bottom], 'dimension');
      arrows.push(arrow([x, top], [0, -1]), arrow([x, bottom], [0, 1]));
    } else dimensionLine([x, a[1]], [x, b[1]]);
    origin = [x + baseline, short ? top - 5 - half : (a[1] + b[1]) / 2];
    angle = -90;
  } else if (dimension.kind === 'aligned') {
    const dx = b[0] - a[0],
      dy = b[1] - a[1],
      length = Math.hypot(dx, dy) || 1;
    const normal: Point2 = [-dy / length, dx / length];
    const p: Point2 = [a[0] + normal[0] * dimension.offset, a[1] + normal[1] * dimension.offset],
      q: Point2 = [b[0] + normal[0] * dimension.offset, b[1] + normal[1] * dimension.offset];
    extension(a, p);
    extension(b, q);
    dimensionLine(p, q);
    angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    if (angle > 90 || angle < -90) angle += 180;
    const radians = (angle * Math.PI) / 180;
    origin = [
      (p[0] + q[0]) / 2 - Math.sin(radians) * baseline,
      (p[1] + q[1]) / 2 + Math.cos(radians) * baseline,
    ];
  } else if (dimension.kind === 'diameter' || dimension.kind === 'radius') {
    const radius = Math.hypot(b[0] - a[0], b[1] - a[1]),
      side = dimension.offset < 0 ? -1 : 1;
    const tip: Point2 =
      dimension.kind === 'radius' ? b : [a[0] + side * radius * 0.7071, a[1] - radius * 0.7071];
    const elbow: Point2 = [
      tip[0] + dimension.offset + movement[0],
      tip[1] - Math.abs(dimension.offset) * 0.6 + movement[1],
    ];
    const metrics = dimensionLeaderMetrics(dimension, precision),
      end: Point2 = [elbow[0] + side * metrics.halfLength * 2, elbow[1]];
    addLine(tip, elbow, 'leader');
    addLine(elbow, end, 'leader');
    arrows.push(arrow(tip, [elbow[0] - tip[0], elbow[1] - tip[1]]));
    origin = [(elbow[0] + end[0]) / 2, elbow[1] + metrics.baselineOffset];
  } else {
    const vertex = toPaper(dimension.vertex ?? dimension.a, transform),
      start = Math.atan2(a[1] - vertex[1], a[0] - vertex[0]);
    let delta = Math.atan2(b[1] - vertex[1], b[0] - vertex[0]) - start;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    const radius = Math.max(6, Math.abs(dimension.offset));
    const p: Point2 = [vertex[0] + Math.cos(start) * radius, vertex[1] + Math.sin(start) * radius],
      q: Point2 = [
        vertex[0] + Math.cos(start + delta) * radius,
        vertex[1] + Math.sin(start + delta) * radius,
      ];
    addLine(vertex, p, 'ray');
    addLine(vertex, q, 'ray');
    arcs.push({ center: vertex, radius, start, delta, a: p, b: q });
    arrows.push(
      arrow(p, [-Math.sin(start) * Math.sign(delta), Math.cos(start) * Math.sign(delta)]),
      arrow(q, [
        Math.sin(start + delta) * Math.sign(delta),
        -Math.cos(start + delta) * Math.sign(delta),
      ]),
    );
    const mid = start + delta / 2,
      ux = Math.cos(mid),
      uy = Math.sin(mid),
      bounds = data.bounds;
    const nearest = Math.min(
      ...[
        [bounds.minX, bounds.minY],
        [bounds.maxX, bounds.minY],
        [bounds.maxX, bounds.maxY],
        [bounds.minX, bounds.maxY],
      ].map(([x, y]) => x * ux + y * uy),
    );
    const distance = radius + DIMENSION_LABEL_GAP - nearest;
    origin = [vertex[0] + ux * distance, vertex[1] + uy * distance];
  }
  if (dimension.kind !== 'diameter' && dimension.kind !== 'radius')
    origin = [origin[0] + movement[0], origin[1] + movement[1]];
  const labelBounds = dimensionLabelBoundsAt(data, origin, angle),
    bounds = { ...labelBounds };
  const include = (point: Point2) => {
    bounds.minX = Math.min(bounds.minX, point[0] - 0.2);
    bounds.maxX = Math.max(bounds.maxX, point[0] + 0.2);
    bounds.minY = Math.min(bounds.minY, point[1] - 0.2);
    bounds.maxY = Math.max(bounds.maxY, point[1] + 0.2);
  };
  for (const segment of lines) {
    include(segment.a);
    include(segment.b);
  }
  for (const triangle of arrows) triangle.forEach(include);
  for (const arc of arcs)
    for (const theta of [0, Math.PI / 2, Math.PI, Math.PI * 1.5])
      if (onArc(theta, arc.start, arc.delta))
        include([
          arc.center[0] + Math.cos(theta) * arc.radius,
          arc.center[1] + Math.sin(theta) * arc.radius,
        ]);
  return { lines, arcs, arrows, label: { origin, angle, data }, labelBounds, bounds };
}
