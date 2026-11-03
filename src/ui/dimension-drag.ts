import type { Dimension, Point2 } from '../model';
import type { ViewTransform } from '../drawing/render';

function checkedPoint(point: Point2, label: string): void {
  if (point.length !== 2 || !point.every(Number.isFinite)) {
    throw new RangeError(`${label} must contain two finite sheet coordinates.`);
  }
}

function checkedTransform(transform: ViewTransform): void {
  if (![transform.x, transform.y, transform.scale].every(Number.isFinite) || transform.scale <= 0) {
    throw new RangeError(
      'The drawing transform must have finite coordinates and a positive scale.',
    );
  }
}

function copy(dimension: Dimension): Dimension {
  return {
    ...dimension,
    a: [...dimension.a],
    b: [...dimension.b],
    ...(dimension.vertex ? { vertex: [...dimension.vertex] as Point2 } : {}),
    ...(dimension.textOffset ? { textOffset: [...dimension.textOffset] as Point2 } : {}),
  };
}

function onSheet(point: Point2, transform: ViewTransform): Point2 {
  return [transform.x + point[0] * transform.scale, transform.y - point[1] * transform.scale];
}

function alignedNormal(dimension: Dimension): Point2 | undefined {
  const dx = dimension.b[0] - dimension.a[0];
  const dy = -(dimension.b[1] - dimension.a[1]);
  const length = Math.hypot(dx, dy);
  return length > 1e-12 ? [-dy / length, dx / length] : undefined;
}

/** Apply a cumulative paper-space drag to the pointerdown annotation snapshot. */
export function dragDimension(
  dimension: Dimension,
  startSheet: Point2,
  currentSheet: Point2,
  viewTransform: ViewTransform,
): Dimension {
  checkedPoint(startSheet, 'Drag start');
  checkedPoint(currentSheet, 'Drag position');
  checkedTransform(viewTransform);
  const next = copy(dimension);
  const dx = currentSheet[0] - startSheet[0];
  const dy = currentSheet[1] - startSheet[1];
  if (dx === 0 && dy === 0) return next;

  if (dimension.kind === 'horizontal') next.offset = dimension.offset + dy;
  else if (dimension.kind === 'vertical') next.offset = dimension.offset - dx;
  else if (dimension.kind === 'aligned') {
    const normal = alignedNormal(dimension);
    if (normal) next.offset = dimension.offset + dx * normal[0] + dy * normal[1];
  } else if (dimension.kind === 'angle') {
    const vertex = onSheet(dimension.vertex ?? dimension.a, viewTransform);
    const radialChange =
      Math.hypot(currentSheet[0] - vertex[0], currentSheet[1] - vertex[1]) -
      Math.hypot(startSheet[0] - vertex[0], startSheet[1] - vertex[1]);
    const radius = Math.max(6, Math.max(6, Math.abs(dimension.offset)) + radialChange);
    next.offset = dimension.offset < 0 ? -radius : radius;
  } else {
    next.textOffset = [
      (dimension.textOffset?.[0] ?? 0) + dx,
      (dimension.textOffset?.[1] ?? 0) + dy,
    ];
  }
  return next;
}

/** Place a draft annotation at a sheet position without changing measured geometry. */
export function positionDimension(
  dimension: Dimension,
  sheetPoint: Point2,
  viewTransform: ViewTransform,
): Dimension {
  checkedPoint(sheetPoint, 'Dimension position');
  checkedTransform(viewTransform);
  const next = copy(dimension);
  const a = onSheet(dimension.a, viewTransform);
  const b = onSheet(dimension.b, viewTransform);

  if (dimension.kind === 'horizontal') {
    next.offset = sheetPoint[1] - Math.max(a[1], b[1]);
    delete next.textOffset;
  } else if (dimension.kind === 'vertical') {
    next.offset = Math.min(a[0], b[0]) - sheetPoint[0];
    delete next.textOffset;
  } else if (dimension.kind === 'aligned') {
    const normal = alignedNormal(dimension);
    if (normal)
      next.offset =
        (sheetPoint[0] - (a[0] + b[0]) / 2) * normal[0] +
        (sheetPoint[1] - (a[1] + b[1]) / 2) * normal[1];
    delete next.textOffset;
  } else if (dimension.kind === 'angle') {
    const vertex = onSheet(dimension.vertex ?? dimension.a, viewTransform);
    next.offset = Math.max(6, Math.hypot(sheetPoint[0] - vertex[0], sheetPoint[1] - vertex[1]));
    delete next.textOffset;
  } else {
    const side = sheetPoint[0] < a[0] ? -1 : 1;
    const radius = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const rim: Point2 =
      dimension.kind === 'radius' ? b : [a[0] + side * radius * 0.7071, a[1] - radius * 0.7071];
    next.offset = side * 10;
    const label: Point2 = [rim[0] + side * 16, rim[1] - 7.4];
    next.textOffset = [sheetPoint[0] - label[0], sheetPoint[1] - label[1]];
  }
  return next;
}
