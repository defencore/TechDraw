import type { RenderedDrawing, ViewTransform } from '../drawing/render';
import type { Part, Point2, Point3, ProjectedEdge, ViewId } from '../model';

export type GeometryPickMode = 'point' | 'edge' | 'circle' | 'line';
export interface GeometryPickOptions {
  includeHidden?: boolean;
  pointRadiusPx?: number;
  edgeRadiusPx?: number;
}
export interface GeometryPick {
  viewId: ViewId;
  edge?: ProjectedEdge;
  anchor?: { id: string; point: Point2; source?: Point3; ambiguousSource?: boolean };
  distancePx: number;
}

interface ScreenEdge {
  edge: ProjectedEdge;
  points: Point2[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}
interface PointCandidate {
  id: string;
  point: Point2;
  source?: Point3;
  hidden: boolean;
  priority: number;
}

const COINCIDENCE_MM = 1e-6;
const viewOrder: ViewId[] = ['front', 'top', 'right'];
const distance = (a: Point2, b: Point2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const validPoint = (point: Point2 | Point3 | undefined) => !!point && point.every(Number.isFinite);
const toSheet = (point: Point2, transform: ViewTransform): Point2 => [
  transform.x + point[0] * transform.scale,
  transform.y - point[1] * transform.scale,
];

function segmentDistance(point: Point2, a: Point2, b: Point2): number {
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  const denominator = dx * dx + dy * dy;
  const t = denominator
    ? Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / denominator))
    : 0;
  return Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dy);
}

/** Choose an arrow attachment in model space without approximating its radius. */
export function nearestPointOnEdge(edge: ProjectedEdge, point: Point2): Point2 {
  if (point.length !== 2 || !validPoint(point))
    throw new RangeError('The pointer must contain two finite model coordinates.');
  const circular =
    edge.kind === 'circle' &&
    validPoint(edge.center) &&
    Number.isFinite(edge.radius) &&
    edge.radius! > 0;
  const onCircle = (candidate: Point2): Point2 | undefined => {
    const center = edge.center!;
    const dx = candidate[0] - center[0],
      dy = candidate[1] - center[1];
    const length = Math.hypot(dx, dy);
    return length > 1e-12
      ? [center[0] + (dx / length) * edge.radius!, center[1] + (dy / length) * edge.radius!]
      : undefined;
  };
  if (circular && edge.closed !== false) {
    const radial = onCircle(point);
    if (radial) return radial;
    // A click at the center has no direction. Reuse an actual sampled rim point.
    for (const candidate of edge.points) {
      if (!validPoint(candidate)) continue;
      const fallback = onCircle(candidate);
      if (fallback) return fallback;
    }
    return [edge.center![0] + edge.radius!, edge.center![1]];
  }
  if (!edge.points.length || !edge.points.every(validPoint))
    throw new RangeError('The selected edge contains no usable geometry.');
  let nearest: Point2 = [...edge.points[0]];
  let closest = distance(point, nearest);
  for (let index = 1; index < edge.points.length; index++) {
    const a = edge.points[index - 1],
      b = edge.points[index];
    const dx = b[0] - a[0],
      dy = b[1] - a[1];
    const squared = dx * dx + dy * dy;
    const fraction = squared
      ? Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / squared))
      : 0;
    const candidate: Point2 = [a[0] + fraction * dx, a[1] + fraction * dy];
    const separation = distance(point, candidate);
    if (separation < closest) {
      closest = separation;
      nearest = candidate;
    }
  }
  if (!circular) return nearest;
  // Clamping to the sampled arc first prevents an attachment on its missing sector.
  const projected = onCircle(nearest);
  if (projected) return projected;
  const fallback = [...edge.points]
    .sort((a, b) => distance(a, point) - distance(b, point))
    .map(onCircle)
    .find((candidate) => candidate !== undefined);
  if (fallback) return fallback;
  throw new RangeError('The selected circular arc has no usable rim points.');
}

function makeScreenEdge(edge: ProjectedEdge, transform: ViewTransform): ScreenEdge | undefined {
  if (edge.points.length < 2 || !edge.points.every(validPoint)) return undefined;
  const points = edge.points.map((point) => toSheet(point, transform));
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point[0]);
    minY = Math.min(minY, point[1]);
    maxX = Math.max(maxX, point[0]);
    maxY = Math.max(maxY, point[1]);
  }
  if (
    edge.kind === 'circle' &&
    edge.closed !== false &&
    validPoint(edge.center) &&
    Number.isFinite(edge.radius) &&
    edge.radius! > 0
  ) {
    const center = toSheet(edge.center!, transform),
      radius = edge.radius! * transform.scale;
    minX = center[0] - radius;
    minY = center[1] - radius;
    maxX = center[0] + radius;
    maxY = center[1] + radius;
  }
  return { edge, points, bounds: { minX, minY, maxX, maxY } };
}

function edgeDistance(point: Point2, screen: ScreenEdge, transform: ViewTransform): number {
  const edge = screen.edge;
  if (
    edge.kind === 'circle' &&
    edge.closed !== false &&
    validPoint(edge.center) &&
    Number.isFinite(edge.radius) &&
    edge.radius! > 0
  ) {
    return Math.abs(
      distance(point, toSheet(edge.center!, transform)) - edge.radius! * transform.scale,
    );
  }
  let nearest = Infinity;
  for (let index = 1; index < screen.points.length; index++)
    nearest = Math.min(
      nearest,
      segmentDistance(point, screen.points[index - 1], screen.points[index]),
    );
  return nearest;
}

function boundsNear(point: Point2, screen: ScreenEdge, radius: number): boolean {
  return (
    point[0] >= screen.bounds.minX - radius &&
    point[0] <= screen.bounds.maxX + radius &&
    point[1] >= screen.bounds.minY - radius &&
    point[1] <= screen.bounds.maxY + radius
  );
}

function projectSource(point: Point3, viewId: ViewId): Point2 {
  return viewId === 'front'
    ? [point[0], point[2]]
    : viewId === 'top'
      ? [point[0], -point[1]]
      : [-point[1], point[2]];
}

/** All radii are CSS pixels, independent of sheet scale, browser size and zoom. */
export function pickGeometry(
  part: Part,
  rendered: Pick<RenderedDrawing, 'viewTransforms'>,
  sheetPoint: Point2,
  pxPerMm: number,
  mode: GeometryPickMode,
  viewId?: ViewId,
  options: GeometryPickOptions = {},
): GeometryPick | undefined {
  if (!validPoint(sheetPoint) || !Number.isFinite(pxPerMm) || pxPerMm <= 0 || viewId === 'iso')
    return undefined;
  const pointRadius = Math.max(1, options.pointRadiusPx ?? 10);
  const edgeRadius = Math.max(1, options.edgeRadiusPx ?? 7);
  const pointPicks: (GeometryPick & { hidden: boolean; priority: number })[] = [];
  const edgePicks: (GeometryPick & { hidden: boolean })[] = [];

  for (const id of viewOrder) {
    if (viewId && id !== viewId) continue;
    const view = part.views.find((projection) => projection.id === id);
    const transform = rendered.viewTransforms[id];
    if (
      !view ||
      !transform ||
      !Number.isFinite(transform.x) ||
      !Number.isFinite(transform.y) ||
      !Number.isFinite(transform.scale) ||
      transform.scale <= 0
    )
      continue;
    const screens = view.edges
      .filter((edge) => options.includeHidden || !edge.hidden)
      .map((edge) => makeScreenEdge(edge, transform))
      .filter((edge): edge is ScreenEdge => !!edge);

    for (const screen of screens) {
      if (
        (mode === 'circle' && screen.edge.kind !== 'circle') ||
        (mode === 'line' && screen.edge.kind !== 'line')
      )
        continue;
      if (!boundsNear(sheetPoint, screen, edgeRadius / pxPerMm)) continue;
      const distancePx = edgeDistance(sheetPoint, screen, transform) * pxPerMm;
      if (distancePx <= edgeRadius)
        edgePicks.push({ viewId: id, edge: screen.edge, distancePx, hidden: screen.edge.hidden });
    }
    if (mode !== 'point') continue;

    const candidates: PointCandidate[] = [];
    const addPoint = (candidate: PointCandidate) => {
      if (
        validPoint(candidate.point) &&
        distance(toSheet(candidate.point, transform), sheetPoint) * pxPerMm <= pointRadius
      )
        candidates.push(candidate);
    };
    for (const screen of screens) {
      const edge = screen.edge;
      if (edge.kind === 'circle' ? edge.closed === false : !edge.closed) {
        addPoint({
          id: `${edge.id}:start`,
          point: edge.points[0],
          source: edge.sourcePoints?.[0],
          hidden: edge.hidden,
          priority: 1,
        });
        addPoint({
          id: `${edge.id}:end`,
          point: edge.points.at(-1)!,
          source: edge.sourcePoints?.at(-1),
          hidden: edge.hidden,
          priority: 1,
        });
      }
      if (edge.kind === 'circle' && validPoint(edge.center)) {
        const normalAxis = id === 'front' ? 1 : id === 'top' ? 2 : 0;
        const sourceCircles = (part.features?.circles || []).filter(
          (circle) =>
            Math.abs(Math.abs(circle.normal[normalAxis]) - 1) < 1e-7 &&
            Math.abs(circle.radius - (edge.radius ?? NaN)) <= COINCIDENCE_MM &&
            distance(projectSource(circle.center, id), edge.center!) <= COINCIDENCE_MM,
        );
        if (sourceCircles.length) {
          for (const circle of sourceCircles)
            addPoint({
              id: `${edge.id}:center:${circle.id}`,
              point: edge.center!,
              source: circle.center,
              hidden: edge.hidden,
              priority: 0,
            });
        } else
          addPoint({
            id: `${edge.id}:center`,
            point: edge.center!,
            hidden: edge.hidden,
            priority: 0,
          });
      }
    }
    for (const anchor of view.anchors || []) {
      if (
        !validPoint(anchor.point) ||
        distance(toSheet(anchor.point, transform), sheetPoint) * pxPerMm > pointRadius
      )
        continue;
      const position = toSheet(anchor.point, transform);
      // Ignore vertices that belong only to hidden geometry or a circle's arbitrary seam.
      const supports = screens.filter(
        (screen) =>
          !(screen.edge.kind === 'circle' && screen.edge.closed !== false) &&
          boundsNear(position, screen, 2 / pxPerMm) &&
          edgeDistance(position, screen, transform) * pxPerMm <= 2,
      );
      if (!supports.length) continue;
      addPoint({ ...anchor, hidden: supports.every((screen) => screen.edge.hidden), priority: 0 });
    }

    const groups: PointCandidate[][] = [];
    for (const candidate of candidates) {
      const group = groups.find(
        (items) => distance(items[0].point, candidate.point) <= COINCIDENCE_MM,
      );
      if (group) group.push(candidate);
      else groups.push([candidate]);
    }
    for (const group of groups) {
      group.sort(
        (a, b) =>
          Number(a.hidden) - Number(b.hidden) ||
          a.priority - b.priority ||
          a.id.localeCompare(b.id),
      );
      const first = group[0];
      const sources = group
        .map((candidate) => candidate.source)
        .filter((source): source is Point3 => !!source && validPoint(source));
      const ambiguousSource =
        !!sources.length &&
        sources.some(
          (source) =>
            Math.hypot(
              source[0] - sources[0][0],
              source[1] - sources[0][1],
              source[2] - sources[0][2],
            ) > COINCIDENCE_MM,
        );
      pointPicks.push({
        viewId: id,
        anchor: {
          id: first.id,
          point: [...first.point],
          source: !ambiguousSource && sources.length ? [...sources[0]] : undefined,
          ...(ambiguousSource ? { ambiguousSource: true } : {}),
        },
        distancePx: distance(toSheet(first.point, transform), sheetPoint) * pxPerMm,
        hidden: first.hidden,
        priority: first.priority,
      });
    }
  }

  pointPicks.sort(
    (a, b) =>
      Number(a.hidden) - Number(b.hidden) ||
      a.distancePx - b.distancePx ||
      a.priority - b.priority ||
      viewOrder.indexOf(a.viewId) - viewOrder.indexOf(b.viewId) ||
      a.anchor!.id.localeCompare(b.anchor!.id),
  );
  edgePicks.sort(
    (a, b) =>
      Number(a.hidden) - Number(b.hidden) ||
      a.distancePx - b.distancePx ||
      viewOrder.indexOf(a.viewId) - viewOrder.indexOf(b.viewId) ||
      a.edge!.id.localeCompare(b.edge!.id),
  );
  const visiblePoint = pointPicks.find((pick) => !pick.hidden);
  const visibleEdge = edgePicks.find((pick) => !pick.hidden);
  const winner =
    mode === 'point'
      ? (visiblePoint ?? visibleEdge ?? pointPicks[0] ?? edgePicks[0])
      : edgePicks[0];
  if (!winner) return undefined;
  return {
    viewId: winner.viewId,
    ...(winner.anchor ? { anchor: winner.anchor } : {}),
    ...(winner.edge ? { edge: winner.edge } : {}),
    distancePx: winner.distancePx,
  };
}
