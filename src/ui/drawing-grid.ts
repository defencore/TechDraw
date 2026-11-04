import { isGridSpacing, snapCoordinate } from '../drawing/grid-coordinates';
import type { Bounds2, Dimension, Point2 } from '../model';
import { dimensionGeometry, toPaper, type ViewTransform } from '../drawing/dimension-geometry';
import { dragDimension } from './dimension-drag';

export interface GridSettings {
  visible: boolean;
  snap: boolean;
  spacing: number;
}
export const defaultGridSettings: GridSettings = { visible: false, snap: false, spacing: 5 };
/** Coarsening is visual only: snapping retains the requested spacing at every zoom. */
export function visibleGridSpacing(spacing: number, pixelsPerMillimetre: number): number {
  if (!isGridSpacing(spacing) || !Number.isFinite(pixelsPerMillimetre) || pixelsPerMillimetre <= 0)
    throw new RangeError('The grid needs valid spacing and a positive screen scale.');
  let decade = 1;
  while (true) {
    for (const factor of [1, 2, 5]) {
      const visible = spacing * decade * factor;
      if (visible * pixelsPerMillimetre >= 7) return visible;
    }
    decade *= 10;
  }
}

/** Workspace markup is inserted after rendering; it is never part of an exported sheet. */
export function renderWorkspaceGrid(
  content: Bounds2,
  settings: GridSettings,
  pixelsPerMillimetre: number,
): string {
  if (!settings.visible || content.maxX <= content.minX || content.maxY <= content.minY) return '';
  const step = visibleGridSpacing(settings.spacing, pixelsPerMillimetre);
  const stroke = 0.65 / pixelsPerMillimetre;
  const major = step * 5;
  return `<defs><clipPath id="workspace-grid-clip"><rect x="${content.minX}" y="${content.minY}" width="${content.maxX - content.minX}" height="${content.maxY - content.minY}"/></clipPath><pattern id="workspace-grid-minor" patternUnits="userSpaceOnUse" x="0" y="0" width="${step}" height="${step}"><path d="M${step},0 H0 V${step}" fill="none" stroke="#a0b2ad" stroke-opacity=".3" stroke-width="${stroke}"/></pattern><pattern id="workspace-grid-major" patternUnits="userSpaceOnUse" x="0" y="0" width="${major}" height="${major}"><rect width="${major}" height="${major}" fill="url(#workspace-grid-minor)"/><path d="M${major},0 H0 V${major}" fill="none" stroke="#879e96" stroke-opacity=".4" stroke-width="${stroke}"/></pattern></defs><rect x="${content.minX}" y="${content.minY}" width="${content.maxX - content.minX}" height="${content.maxY - content.minY}" fill="url(#workspace-grid-major)" clip-path="url(#workspace-grid-clip)"/>`;
}

/** Snap the annotation, never its source points or measured value. */
export function snapDimensionToGrid(
  dimension: Dimension,
  transform: ViewTransform,
  precision: number,
  grid: GridSettings,
): Dimension {
  if (!grid.snap) return dimension;
  const next = structuredClone(dimension);
  const snap = (value: number) => snapCoordinate(value, grid.spacing);
  const a = toPaper(dimension.a, transform),
    b = toPaper(dimension.b, transform);
  if (dimension.kind === 'horizontal') {
    const line = Math.max(a[1], b[1]) + dimension.offset;
    next.offset += snap(line) - line;
  } else if (dimension.kind === 'vertical') {
    const line = Math.min(a[0], b[0]) - dimension.offset;
    next.offset -= snap(line) - line;
  } else if (dimension.kind === 'aligned') {
    const dx = b[0] - a[0],
      dy = b[1] - a[1],
      length = Math.hypot(dx, dy);
    if (length > 1e-12) {
      const normal: Point2 = [-dy / length, dx / length];
      const midpoint: Point2 = [
        (a[0] + b[0]) / 2 + normal[0] * dimension.offset,
        (a[1] + b[1]) / 2 + normal[1] * dimension.offset,
      ];
      // Its line has one degree of freedom. Snap the dominant normal axis exactly.
      const axis = Math.abs(normal[0]) >= Math.abs(normal[1]) ? 0 : 1;
      next.offset += (snap(midpoint[axis]) - midpoint[axis]) / normal[axis];
    }
  } else if (dimension.kind === 'angle') {
    const radius = Math.max(6, Math.abs(dimension.offset));
    const snapped = Math.max(6, snap(radius));
    next.offset = dimension.offset < 0 ? -snapped : snapped;
  } else {
    const origin = dimensionGeometry(dimension, transform, precision).label.origin;
    next.textOffset = [
      (dimension.textOffset?.[0] ?? 0) + snap(origin[0]) - origin[0],
      (dimension.textOffset?.[1] ?? 0) + snap(origin[1]) - origin[1],
    ];
  }
  return next;
}

/** One corrected cursor delta moves a selected group rigidly, preserving its lane spacing. */
export function snappedDragPoint(
  dimension: Dimension,
  start: Point2,
  current: Point2,
  transform: ViewTransform,
  precision: number,
  grid: GridSettings,
): Point2 {
  if (!grid.snap) return current;
  const raw = dragDimension(dimension, start, current, transform);
  const snapped = snapDimensionToGrid(raw, transform, precision, grid);
  const change = snapped.offset - raw.offset;
  if (dimension.kind === 'horizontal') return [current[0], current[1] + change];
  if (dimension.kind === 'vertical') return [current[0] - change, current[1]];
  if (dimension.kind === 'aligned') {
    const dx = dimension.b[0] - dimension.a[0],
      dy = -(dimension.b[1] - dimension.a[1]),
      length = Math.hypot(dx, dy);
    return length > 1e-12
      ? [current[0] - (dy / length) * change, current[1] + (dx / length) * change]
      : current;
  }
  if (dimension.kind === 'angle') {
    const vertex = toPaper(dimension.vertex ?? dimension.a, transform);
    const dx = current[0] - vertex[0],
      dy = current[1] - vertex[1],
      length = Math.hypot(dx, dy);
    const startDx = start[0] - vertex[0],
      startDy = start[1] - vertex[1],
      startLength = Math.hypot(startDx, startDy);
    const distance = Math.max(
      0,
      startLength + Math.abs(snapped.offset) - Math.max(6, Math.abs(dimension.offset)),
    );
    const direction: Point2 =
      length > 1e-12
        ? [dx / length, dy / length]
        : startLength > 1e-12
          ? [startDx / startLength, startDy / startLength]
          : [1, 0];
    return [vertex[0] + direction[0] * distance, vertex[1] + direction[1] * distance];
  }
  return [
    current[0] + (snapped.textOffset?.[0] ?? 0) - (raw.textOffset?.[0] ?? 0),
    current[1] + (snapped.textOffset?.[1] ?? 0) - (raw.textOffset?.[1] ?? 0),
  ];
}
