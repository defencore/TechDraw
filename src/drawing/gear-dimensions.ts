import type { Bounds2, Dimension, Part, Point2, Point3, Projection, ViewId } from '../model';
import { gearReferenceDiameter } from '../gears/specification';
import { effectivePartType } from '../manufacturing/catalog';
import { toPaper, type ViewTransform } from './dimension-geometry';

export function projectGearPoint(point: Point3, view: ViewId): Point2 {
  return view === 'front'
    ? [point[0], point[2]]
    : view === 'top'
      ? [point[0], -point[1]]
      : [-point[1], point[2]];
}

/** Orthographic diameter annotations need a face-on gear axis; tilted axes require reorientation. */
export function gearDrawingOrientation(part: Part):
  | {
      axis: number;
      side: Projection;
      end: Projection;
      horizontal: boolean;
    }
  | undefined {
  if (effectivePartType(part) !== 'gear') return;
  const gear = part.features?.gear;
  if (!gear) return;
  const axis = gear.axis.direction.findIndex((value) => Math.abs(value) > 0.999999);
  if (axis < 0) return;
  const end = part.views.find(
    (view) => view.id === (axis === 0 ? 'right' : axis === 1 ? 'front' : 'top'),
  );
  const side = part.views.find((view) => view.id === (axis === 1 ? 'top' : 'front'));
  if (side && end) return { axis, side, end, horizontal: axis === 0 };
}

export interface GearReferenceCircle {
  kind: 'tip' | 'root' | 'pitch';
  center: Point2;
  radius: number;
}

export function measuredPinHoleAngle(part: Part, index: number): number | undefined {
  const gear = part.features?.gear,
    datum = gear?.toothDatumDirection,
    hole = gear?.pinHoles?.[index];
  if (!gear || !datum || !hole) return;
  if (
    Math.abs(
      hole.axis.direction.reduce((sum, value, i) => sum + value * gear.axis.direction[i], 0),
    ) > 1e-6
  )
    return;
  const cosine = datum.reduce((sum, value, i) => sum + value * hole.axis.direction[i], 0);
  return (Math.acos(Math.max(-1, Math.min(1, cosine))) * 180) / Math.PI;
}

export function gearDatumReference(
  part: Part,
  view: ViewId,
):
  | {
      center: Point2;
      tip: Point2;
      direction: Point2;
      pins: Point2[];
    }
  | undefined {
  const gear = part.features?.gear,
    orientation = gearDrawingOrientation(part);
  if (!gear?.toothDatumDirection || !orientation || orientation.end.id !== view) return;
  const center = projectGearPoint(gear.axis.origin, view);
  const projectDirection = (direction: Point3) => projectGearPoint(direction, view);
  const direction = projectDirection(gear.toothDatumDirection);
  return {
    center,
    direction,
    tip: [
      center[0] + (direction[0] * gear.outsideDiameter) / 2,
      center[1] + (direction[1] * gear.outsideDiameter) / 2,
    ],
    pins: (gear.pinHoles ?? []).map((hole) => projectDirection(hole.axis.direction)),
  };
}

export function gearDatumPaperGeometry(
  part: Part,
  view: ViewId,
  transform: ViewTransform,
):
  | {
      lines: { a: Point2; b: Point2 }[];
      label: Point2;
      labelBounds: Bounds2;
      bounds: Bounds2;
    }
  | undefined {
  const datum = gearDatumReference(part, view);
  if (!datum) return;
  const center = toPaper(datum.center, transform),
    tip = toPaper(datum.tip, transform);
  const direction: Point2 = [datum.direction[0], -datum.direction[1]];
  const label: Point2 = [tip[0] + direction[0] * 6, tip[1] + direction[1] * 6 + 1];
  const lines: { a: Point2; b: Point2 }[] = [
    { a: center, b: [tip[0] + direction[0] * 3, tip[1] + direction[1] * 3] },
  ];
  const length = (part.features!.gear!.outsideDiameter * transform.scale) / 2 + 3;
  for (const pin of datum.pins)
    lines.push({
      a: [center[0] - pin[0] * length, center[1] + pin[1] * length],
      b: [center[0] + pin[0] * length, center[1] - pin[1] * length],
    });
  const points = lines.flatMap((line) => [line.a, line.b]);
  const labelBounds = {
    minX: label[0] - 2.5,
    minY: label[1] - 3.1,
    maxX: label[0] + 2.5,
    maxY: label[1] + 1,
  };
  return {
    lines,
    label,
    labelBounds,
    bounds: {
      minX: Math.min(labelBounds.minX, ...points.map((point) => point[0] - 0.1)),
      minY: Math.min(labelBounds.minY, ...points.map((point) => point[1] - 0.1)),
      maxX: Math.max(labelBounds.maxX, ...points.map((point) => point[0] + 0.1)),
      maxY: Math.max(labelBounds.maxY, ...points.map((point) => point[1] + 0.1)),
    },
  };
}

/** Thin construction circles explain measured envelopes without replacing the source tooth contour. */
export function gearReferenceCircles(part: Part, view: ViewId): GearReferenceCircle[] {
  const orientation = gearDrawingOrientation(part),
    gear = part.features?.gear;
  if (!orientation || !gear || orientation.end.id !== view) return [];
  const center = projectGearPoint(gear.axis.origin, view);
  const circles: GearReferenceCircle[] = [
    { kind: 'tip', center, radius: gear.outsideDiameter / 2 },
    { kind: 'root', center, radius: gear.rootDiameter / 2 },
  ];
  const reference = gearReferenceDiameter(part.gearSpecification, gear.toothCount);
  if (reference !== undefined) circles.push({ kind: 'pitch', center, radius: reference / 2 });
  return circles;
}

/** Gear-specific suggestions describe observed stock, bore and pin geometry, never individual teeth. */
export function measuredGearDimensions(part: Part): Dimension[] {
  const gear = part.features?.gear,
    orientation = gearDrawingOrientation(part);
  if (!gear || !orientation) return [];
  const { side, end, axis, horizontal } = orientation;
  const dimensions: Dimension[] = [];
  const sourcePrecision = (value: number): number => {
    for (let places = 0; places <= 6; places++) {
      const rounded = Number(value.toFixed(places));
      if (rounded !== 0 && Math.abs(value - rounded) <= 1e-6) return places;
    }
    return 6;
  };
  const add = (
    key: string,
    view: Projection,
    kind: Dimension['kind'],
    a: Point2,
    b: Point2,
    value: number,
    prefix?: string,
  ) => {
    if (!(value > 1e-7)) return;
    dimensions.push({
      id: `${part.id}-auto-gear-${key}`,
      viewId: view.id,
      kind,
      a,
      b,
      value,
      offset: kind === 'diameter' ? 10 : 9,
      automatic: true,
      minimumPrecision: sourcePrecision(value),
      ...(prefix ? { prefix } : {}),
    });
  };
  const center = projectGearPoint(gear.axis.origin, end.id);
  for (const [key, diameter] of [
    ['outside', gear.outsideDiameter],
    ['root', gear.rootDiameter],
    ['bore', gear.boreDiameter],
    ['hub', gear.hubDiameter],
  ] as const)
    if (diameter !== undefined)
      add(key, end, 'diameter', [...center], [center[0] + diameter / 2, center[1]], diameter);

  const axialKind = horizontal ? 'horizontal' : 'vertical';
  const sourceStations = part
    .features!.circles.filter((circle) => Math.abs(circle.normal[axis]) > 0.999999)
    .map((circle) => circle.center[axis]);
  const low = sourceStations.length ? Math.min(...sourceStations) : part.bounds.min[axis];
  const high = sourceStations.length ? Math.max(...sourceStations) : part.bounds.max[axis];
  const faceLow = gear.axis.origin[axis] - gear.faceWidth / 2;
  const faceHigh = gear.axis.origin[axis] + gear.faceWidth / 2;
  const axialPoint = (value: number): Point2 => {
    const point = [...gear.axis.origin] as Point3;
    point[axis] = value;
    const projected = projectGearPoint(point, side.id);
    if (horizontal) projected[1] = side.bounds.minY;
    else projected[0] = side.bounds.minX;
    return projected;
  };
  const axial = (key: string, first: number, last: number, value = Math.abs(last - first)) =>
    add(key, side, axialKind, axialPoint(first), axialPoint(last), value);
  axial('overall', low, high, gear.overallLength);
  axial('face', faceLow, faceHigh, gear.faceWidth);
  if (gear.hubDiameter) {
    if (faceLow - low > 1e-5) axial('hub-before', low, faceLow);
    if (high - faceHigh > 1e-5) axial('hub-after', faceHigh, high);
  }
  const normals: Record<Exclude<ViewId, 'iso'>, Point3> = {
    front: [0, -1, 0],
    top: [0, 0, 1],
    right: [1, 0, 0],
  };
  const dot = (a: Point3, b: Point3) => a.reduce((sum, value, i) => sum + value * b[i], 0);
  for (const [index, hole] of (gear.pinHoles ?? []).entries()) {
    const location = hole.axis.origin[axis];
    const datum = Math.abs(location - low) <= Math.abs(high - location) ? low : high;
    axial(`pin-${index}-location`, datum, location);
    // A radial hole's diameter parallel to the gear axis remains true length in a side view,
    // even when the mouth is an ellipse because the hole is rotated between orthographic views.
    if (Math.abs(dot(hole.axis.direction, gear.axis.direction)) > 1e-6) continue;
    const view = part.views
      .filter((view) => view.id !== 'iso' && view.id !== end.id)
      .sort(
        (a, b) =>
          Math.abs(dot(hole.axis.direction, normals[b.id as Exclude<ViewId, 'iso'>])) -
          Math.abs(dot(hole.axis.direction, normals[a.id as Exclude<ViewId, 'iso'>])),
      )[0];
    if (!view) continue;
    const towardViewer =
      dot(hole.axis.direction, normals[view.id as Exclude<ViewId, 'iso'>]) < 0 ? -1 : 1;
    const mouth = hole.axis.origin.map(
      (value, i) =>
        value +
        (hole.axis.direction[i] * towardViewer * (gear.hubDiameter ?? gear.outsideDiameter)) / 2,
    ) as Point3;
    const first = mouth.map(
      (value, i) => value - (gear.axis.direction[i] * hole.diameter) / 2,
    ) as Point3;
    const last = mouth.map(
      (value, i) => value + (gear.axis.direction[i] * hole.diameter) / 2,
    ) as Point3;
    const a = projectGearPoint(first, view.id),
      b = projectGearPoint(last, view.id);
    add(
      `pin-${index}-diameter`,
      view,
      Math.abs(a[1] - b[1]) < 1e-6 ? 'horizontal' : 'vertical',
      a,
      b,
      hole.diameter,
      'Ø',
    );
    const angle = measuredPinHoleAngle(part, index);
    if (angle !== undefined && angle > 1e-4 && angle < 180 - 1e-4) {
      const datum = gear.toothDatumDirection!;
      const radius = gear.outsideDiameter / 2;
      const first = gear.axis.origin.map((value, i) => value + datum[i] * radius) as Point3;
      const last = gear.axis.origin.map(
        (value, i) => value + hole.axis.direction[i] * radius,
      ) as Point3;
      add(
        `pin-${index}-angle`,
        end,
        'angle',
        projectGearPoint(first, end.id),
        projectGearPoint(last, end.id),
        angle,
      );
      const dimension = dimensions.at(-1)!;
      dimension.vertex = [...center];
      dimension.offset = radius + 8;
    }
  }
  return dimensions;
}
