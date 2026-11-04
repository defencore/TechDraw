import type { Bounds2, Dimension, DrawingLayout, Part, Point2, ViewId } from '../model';
import { isGridSpacing, snapCoordinate } from './grid-coordinates';
import {
  dimensionGeometry,
  toPaper,
  type AnnotationLine,
  type ViewTransform,
} from './dimension-geometry';

export type PlacementSide = 'left' | 'right' | 'top' | 'bottom';
export interface DimensionPlacementOptions {
  side: PlacementSide;
  mode: 'cascade' | 'align';
  gap: number;
  gridSpacing?: number;
  precision: number;
}
export interface DimensionPlacementResult {
  dimensions: Dimension[];
  placedIds: string[];
  unsupportedIds: string[];
}

interface PlacementItem {
  dimension: Dimension;
  transform: ViewTransform;
  normal: Point2;
  tangent: Point2;
  minimum: number;
  thickness: number;
  min: number;
  max: number;
  length: number;
  radial: boolean;
  lane: number;
}
const dot = (a: Point2, b: Point2) => a[0] * b[0] + a[1] * b[1];
const corners = (bounds: Bounds2): Point2[] => [
  [bounds.minX, bounds.minY],
  [bounds.maxX, bounds.minY],
  [bounds.maxX, bounds.maxY],
  [bounds.minX, bounds.maxY],
];
const projected = (points: Point2[], axis: Point2) => {
  const values = points.map((point) => dot(point, axis));
  return { min: Math.min(...values), max: Math.max(...values) };
};
const overlap = (a: Bounds2, b: Bounds2, gap: number) =>
  a.minX < b.maxX + gap && a.maxX > b.minX - gap && a.minY < b.maxY + gap && a.maxY > b.minY - gap;

function paperBounds(part: Part, viewId: ViewId, transform: ViewTransform): Bounds2 | undefined {
  const view = part.views.find((view) => view.id === viewId);
  if (!view) return;
  return {
    minX: transform.x + view.bounds.minX * transform.scale,
    maxX: transform.x + view.bounds.maxX * transform.scale,
    minY: transform.y - view.bounds.maxY * transform.scale,
    maxY: transform.y - view.bounds.minY * transform.scale,
  };
}

function placementItem(
  dimension: Dimension,
  transform: ViewTransform,
  model: Bounds2,
  options: DimensionPlacementOptions,
): PlacementItem | undefined {
  const directions: Record<PlacementSide, Point2> = {
    left: [-1, 0],
    right: [1, 0],
    top: [0, -1],
    bottom: [0, 1],
  };
  const requested = directions[options.side];
  const radial = dimension.kind === 'diameter' || dimension.kind === 'radius';
  let normal: Point2 = requested;
  if (dimension.kind === 'horizontal') {
    if (options.side !== 'top' && options.side !== 'bottom') return;
  } else if (dimension.kind === 'vertical') {
    if (options.side !== 'left' && options.side !== 'right') return;
  } else if (dimension.kind === 'aligned') {
    const a = toPaper(dimension.a, transform),
      b = toPaper(dimension.b, transform);
    const dx = b[0] - a[0],
      dy = b[1] - a[1],
      length = Math.hypot(dx, dy);
    if (length < 1e-9) return;
    normal = [-dy / length, dx / length];
    const direction = dot(normal, requested);
    if (Math.abs(direction) < 1e-9) return;
    if (direction < 0) normal = [-normal[0], -normal[1]];
  } else if (!radial) return;
  const tangent: Point2 = [normal[1], -normal[0]];
  delete dimension.textOffset;
  if (radial) {
    dimension.offset =
      (options.side === 'left'
        ? -1
        : options.side === 'right'
          ? 1
          : dimension.offset < 0
            ? -1
            : 1) * 10;
    const geometry = dimensionGeometry(dimension, transform, options.precision);
    const anchor = toPaper(dimension.a, transform);
    const origin: Point2 = [...geometry.label.origin];
    if (options.side === 'left' || options.side === 'right') origin[1] = anchor[1];
    else origin[0] = anchor[0];
    if (options.gridSpacing) {
      origin[0] = snapCoordinate(origin[0], options.gridSpacing);
      origin[1] = snapCoordinate(origin[1], options.gridSpacing);
    }
    dimension.textOffset = [
      origin[0] - geometry.label.origin[0],
      origin[1] - geometry.label.origin[1],
    ];
  } else dimension.offset = 0;
  const geometry = dimensionGeometry(dimension, transform, options.precision);
  const line = geometry.lines.find((line) => line.kind === 'dimension');
  if (!radial && !line) return;
  const reference = radial ? geometry.label.origin : line!.a;
  const labelNormal = projected(corners(geometry.labelBounds), normal);
  const spanPoints = radial
    ? []
    : geometry.lines
        .filter((line) => line.kind === 'dimension')
        .flatMap((line) => [line.a, line.b]);
  const span = projected([...corners(geometry.labelBounds), ...spanPoints], tangent);
  const body = projected(corners(model), normal).max;
  const relativeMin = labelNormal.min - dot(reference, normal);
  return {
    dimension,
    transform,
    normal,
    tangent,
    radial,
    lane: 0,
    minimum: Math.max(body + Math.max(2, options.gap), body + 2 - relativeMin),
    thickness: labelNormal.max - labelNormal.min,
    min: span.min,
    max: span.max,
    length: radial
      ? dimension.value * transform.scale
      : Math.abs(
          dot(toPaper(dimension.b, transform), tangent) -
            dot(toPaper(dimension.a, transform), tangent),
        ),
  };
}

function placeAt(item: PlacementItem, coordinate: number, precision: number): Bounds2 {
  const { dimension, transform, normal } = item;
  if (item.radial) {
    const geometry = dimensionGeometry(dimension, transform, precision);
    const movement = coordinate - dot(geometry.label.origin, normal);
    dimension.textOffset = [
      (dimension.textOffset?.[0] ?? 0) + normal[0] * movement,
      (dimension.textOffset?.[1] ?? 0) + normal[1] * movement,
    ];
  } else {
    const a = toPaper(dimension.a, transform),
      b = toPaper(dimension.b, transform);
    if (dimension.kind === 'horizontal')
      dimension.offset = coordinate / normal[1] - Math.max(a[1], b[1]);
    else if (dimension.kind === 'vertical')
      dimension.offset = Math.min(a[0], b[0]) - coordinate / normal[0];
    else {
      const dx = b[0] - a[0],
        dy = b[1] - a[1],
        length = Math.hypot(dx, dy);
      const native: Point2 = [-dy / length, dx / length];
      dimension.offset = (coordinate - dot(a, normal)) / dot(native, normal);
    }
  }
  return dimensionGeometry(dimension, transform, precision).labelBounds;
}

/** Distance along a fixed outward normal needed to clear one occupied rectangle. */
function clearDistance(label: Bounds2, obstacle: Bounds2, normal: Point2): number {
  const choices: number[] = [];
  if (normal[0] > 1e-12) choices.push((obstacle.maxX + 2 - label.minX) / normal[0]);
  if (normal[0] < -1e-12) choices.push((obstacle.minX - 2 - label.maxX) / normal[0]);
  if (normal[1] > 1e-12) choices.push((obstacle.maxY + 2 - label.minY) / normal[1]);
  if (normal[1] < -1e-12) choices.push((obstacle.minY - 2 - label.maxY) / normal[1]);
  return Math.min(...choices.filter((distance) => distance >= 0)) + 1e-7;
}

/**
 * Move annotations against frozen sheet geometry. Align shares a baseline only
 * for disjoint spans; nested or colliding spans retain separate exterior lanes.
 * Oblique groups snap their absolute normal coordinate from the sheet origin.
 */
export function applyDimensionPlacement(
  dimensions: readonly Dimension[],
  ids: ReadonlySet<string>,
  part: Part,
  layout: DrawingLayout,
  options: DimensionPlacementOptions,
): DimensionPlacementResult {
  if (
    !['left', 'right', 'top', 'bottom'].includes(options.side) ||
    !['cascade', 'align'].includes(options.mode)
  )
    throw new RangeError('Choose a supported placement side and mode.');
  if (!Number.isFinite(options.gap) || options.gap < 0)
    throw new RangeError('Placement gap must be a nonnegative sheet distance.');
  if (!Number.isInteger(options.precision) || options.precision < 0 || options.precision > 6)
    throw new RangeError('Placement precision must be between zero and six.');
  if (options.gridSpacing !== undefined && !isGridSpacing(options.gridSpacing))
    throw new RangeError('Grid spacing must be between 0.1 and 100 mm.');
  const result = structuredClone(dimensions) as Dimension[];
  const groups = new Map<string, PlacementItem[]>();
  const placed = new Set<string>();
  const unsupported = new Set<string>();
  const models: Bounds2[] = [];
  for (const view of part.views) {
    const transform = layout.viewTransforms[view.id];
    if (
      transform &&
      [transform.x, transform.y, transform.scale].every(Number.isFinite) &&
      transform.scale > 0
    ) {
      const bounds = paperBounds(part, view.id, transform);
      if (bounds) models.push(bounds);
    }
  }
  const unselected = dimensions
    .filter((dimension) => !ids.has(dimension.id))
    .flatMap((dimension) => {
      const transform = layout.viewTransforms[dimension.viewId];
      return transform ? [dimensionGeometry(dimension, transform, options.precision)] : [];
    });
  const occupied = unselected.map((geometry) => geometry.labelBounds);
  const dimensionLines: AnnotationLine[] = unselected.flatMap((geometry) =>
    geometry.lines.filter((line) => line.kind === 'dimension'),
  );
  for (const dimension of result) {
    if (!ids.has(dimension.id)) continue;
    const transform = layout.viewTransforms[dimension.viewId];
    const model = transform && paperBounds(part, dimension.viewId, transform);
    const item =
      model &&
      transform &&
      [transform.x, transform.y, transform.scale].every(Number.isFinite) &&
      transform.scale > 0
        ? placementItem(dimension, transform, model, options)
        : undefined;
    if (!item) {
      unsupported.add(dimension.id);
      if (
        transform &&
        [transform.x, transform.y, transform.scale].every(Number.isFinite) &&
        transform.scale > 0
      ) {
        const geometry = dimensionGeometry(dimension, transform, options.precision);
        occupied.push(geometry.labelBounds);
        dimensionLines.push(...geometry.lines.filter((line) => line.kind === 'dimension'));
      }
      continue;
    }
    const key = `${dimension.viewId}:${item.radial ? 'radial' : 'linear'}:${item.normal.map((value) => value.toFixed(10)).join(',')}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }
  const snap = (value: number) =>
    options.gridSpacing ? snapCoordinate(value, options.gridSpacing, 'max') : value;
  for (const items of groups.values()) {
    const base = snap(Math.max(...items.map((item) => item.minimum)));
    const pitch = snap(Math.max(7, options.gap, ...items.map((item) => item.thickness + 2)));
    const laneCoordinate = (value: number) =>
      snap(base + Math.ceil((value - base) / pitch - 1e-9) * pitch);
    const prior: PlacementItem[] = [];
    for (const item of items.sort(
      (a, b) =>
        a.length - b.length || a.min - b.min || a.dimension.id.localeCompare(b.dimension.id),
    )) {
      const blocking =
        options.mode === 'cascade'
          ? prior
          : prior.filter((other) => item.min <= other.max + 2 && item.max >= other.min - 2);
      item.lane = blocking.reduce((lane, other) => Math.max(lane, other.lane + 1), 0);
      let coordinate = laneCoordinate(base + item.lane * pitch);
      let bounds = placeAt(item, coordinate, options.precision);
      const obstacles = [...models, ...occupied];
      const baselines = item.radial
        ? []
        : dimensionLines
            .filter((line) => {
              const delta: Point2 = [line.b[0] - line.a[0], line.b[1] - line.a[1]];
              return Math.abs(dot(delta, item.normal)) <= Math.hypot(...delta) * 1e-9 + 1e-9;
            })
            .map((line) => ({
              coordinate: dot(line.a, item.normal),
              ...projected([line.a, line.b], item.tangent),
            }));
      for (let attempt = 0; attempt <= obstacles.length + baselines.length; attempt++) {
        const collisions = obstacles.filter((obstacle) => overlap(bounds, obstacle, 1.5));
        const lineCollisions = baselines.filter(
          (baseline) =>
            item.min <= baseline.max + 2 &&
            item.max >= baseline.min - 2 &&
            Math.abs(coordinate - baseline.coordinate) < pitch - 1e-8,
        );
        if (!collisions.length && !lineCollisions.length) break;
        coordinate = laneCoordinate(
          Math.max(
            coordinate,
            ...lineCollisions.map((baseline) => baseline.coordinate + pitch),
            ...collisions.map(
              (obstacle) => coordinate + clearDistance(bounds, obstacle, item.normal),
            ),
          ),
        );
        bounds = placeAt(item, coordinate, options.precision);
      }
      item.lane = Math.max(item.lane, Math.ceil((coordinate - base) / pitch - 1e-9));
      occupied.push(bounds);
      dimensionLines.push(
        ...dimensionGeometry(item.dimension, item.transform, options.precision).lines.filter(
          (line) => line.kind === 'dimension',
        ),
      );
      prior.push(item);
      placed.add(item.dimension.id);
    }
  }
  for (const id of ids)
    if (!dimensions.some((dimension) => dimension.id === id)) unsupported.add(id);
  return {
    dimensions: result,
    placedIds: result
      .filter((dimension) => placed.has(dimension.id))
      .map((dimension) => dimension.id),
    unsupportedIds: [...unsupported],
  };
}
