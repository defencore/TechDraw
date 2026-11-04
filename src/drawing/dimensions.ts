import type { Bounds2, Dimension, Part, Point2, Point3, ProjectedEdge, Projection } from '../model';
import {
  dimensionLabelBoundsAt,
  dimensionLeaderMetrics,
  formatDimensionLabel,
} from './dimension-label';
import { dimensionGeometry } from './dimension-geometry';
import { effectivePartType } from '../manufacturing/catalog';
import {
  gearDatumPaperGeometry,
  gearDrawingOrientation,
  measuredGearDimensions,
} from './gear-dimensions';

const near = (a: number, b: number) => Math.abs(a - b) < 1e-5;
const unique = (values: number[]) =>
  values
    .filter(Number.isFinite)
    .sort((a, b) => a - b)
    .filter((value, index, sorted) => index === 0 || !near(value, sorted[index - 1]));

export interface ArrangeOptions {
  scale?: number;
  precision?: number;
  part?: Part;
}

const boxesOverlap = (a: Bounds2, b: Bounds2, gap = 0) =>
  a.minX <= b.maxX + gap &&
  a.maxX >= b.minX - gap &&
  a.minY <= b.maxY + gap &&
  a.maxY >= b.minY - gap;

function pointSegmentDistance(point: Point2, a: Point2, b: Point2): number {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared
    ? Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSquared))
    : 0;
  return Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dy);
}

function segmentHitsBox(a: Point2, b: Point2, bounds: Bounds2, gap = 0): boolean {
  let low = 0,
    high = 1;
  for (const [axis, min, max] of [
    [0, bounds.minX - gap, bounds.maxX + gap],
    [1, bounds.minY - gap, bounds.maxY + gap],
  ]) {
    const delta = b[axis] - a[axis];
    if (Math.abs(delta) < 1e-12) {
      if (a[axis] < min || a[axis] > max) return false;
    } else {
      const first = (min - a[axis]) / delta,
        last = (max - a[axis]) / delta;
      low = Math.max(low, Math.min(first, last));
      high = Math.min(high, Math.max(first, last));
      if (low > high) return false;
    }
  }
  return true;
}

/** Keep complete circle callouts outside the view, with leaders clear of neighboring holes. */
function arrangeCircleCallouts(result: Dimension[], scale: number, precision: number, part?: Part) {
  const views = new Set(result.map((dimension) => dimension.viewId));
  for (const viewId of views) {
    const projection = part?.views.find((view) => view.id === viewId);
    const circles = result.filter(
      (dimension) =>
        dimension.viewId === viewId &&
        !dimension.locked &&
        ['diameter', 'radius'].includes(dimension.kind),
    );
    if (!circles.length) continue;
    const occupied = result
      .filter(
        (dimension) =>
          dimension.viewId === viewId &&
          (dimension.locked || !['diameter', 'radius'].includes(dimension.kind)),
      )
      .map(
        (dimension) => dimensionGeometry(dimension, { x: 0, y: 0, scale }, precision).labelBounds,
      );
    const datum = part ? gearDatumPaperGeometry(part, viewId, { x: 0, y: 0, scale }) : undefined;
    if (datum) occupied.push(datum.labelBounds);
    const obstacles = (projection?.edges ?? []).filter(
      (edge) =>
        !edge.hidden &&
        edge.kind === 'circle' &&
        edge.closed !== false &&
        edge.center &&
        edge.radius,
    );
    const order = [...circles].sort(
      (a, b) => b.a[1] - a.a[1] || b.value - a.value || a.a[0] - b.a[0] || a.id.localeCompare(b.id),
    );
    for (const d of order) {
      delete d.textOffset;
      const originalSide = d.offset < 0 ? -1 : 1;
      const sides = projection && d.automatic ? [originalSide, -originalSide] : [originalSide];
      const radius = Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1]) * scale;
      const label = formatDimensionLabel(d, precision);
      const metrics = dimensionLeaderMetrics(d, precision);
      let best:
        | { score: number; side: number; travel: number; yOffset: number; bounds: Bounds2 }
        | undefined;
      for (const side of sides) {
        const rim: Point2 =
          d.kind === 'radius'
            ? [d.b[0] * scale, -d.b[1] * scale]
            : [d.a[0] * scale + side * radius * 0.7071, -d.a[1] * scale - radius * 0.7071];
        const boundary = projection
          ? (side > 0 ? projection.bounds.maxX : projection.bounds.minX) * scale
          : rim[0];
        const travel = Math.max(10, side * (boundary - rim[0]) + 4);
        const elbowX = rim[0] + side * travel;
        const baseY = rim[1] - travel * 0.6;
        const candidates = [baseY];
        if (projection)
          candidates.push(
            rim[1] - 6,
            rim[1],
            -projection.bounds.maxY * scale - 6,
            -projection.bounds.minY * scale + 6,
          );
        for (let lane = 1; lane <= occupied.length + circles.length + 4; lane++)
          candidates.push(baseY - lane * 6, baseY + lane * 6);
        for (const y of unique(candidates)) {
          const origin: Point2 = [elbowX + side * metrics.halfLength, y + metrics.baselineOffset];
          const bounds = dimensionLabelBoundsAt(label, origin);
          const labelCollisions = occupied.filter((box) => boxesOverlap(bounds, box, 1.5)).length;
          const leader: Point2 = [elbowX, y];
          const holeCrossings = obstacles.filter((edge) => {
            if (near(edge.center![0], d.a[0]) && near(edge.center![1], d.a[1])) return false;
            const center: Point2 = [edge.center![0] * scale, -edge.center![1] * scale];
            return pointSegmentDistance(center, rim, leader) < edge.radius! * scale + 0.6;
          }).length;
          const labelCrossings = occupied.filter((box) =>
            segmentHitsBox(rim, leader, box, 0.7),
          ).length;
          const score =
            labelCollisions * 1e8 +
            holeCrossings * 1e6 +
            labelCrossings * 1e4 +
            Math.abs(y - baseY) +
            travel +
            (side === originalSide ? 0 : 0.5) +
            (y > baseY ? 0.01 : 0);
          if (!best || score < best.score)
            best = { score, side, travel, yOffset: y - baseY, bounds };
        }
      }
      d.offset = best!.side * best!.travel;
      if (Math.abs(best!.yOffset) > 1e-9) d.textOffset = [0, best!.yOffset];
      occupied.push(best!.bounds);
    }
  }
}

/** Place nested spans in ascending lanes; only separated spans may share a lane. */
export function arrangeDimensions(
  dimensions: Dimension[],
  options: ArrangeOptions = {},
): Dimension[] {
  const scale = options.scale && options.scale > 0 ? options.scale : 1;
  const precision = options.precision ?? 2;
  const result = dimensions.map((d) => ({
    ...d,
    a: [...d.a] as Point2,
    b: [...d.b] as Point2,
    ...(d.vertex ? { vertex: [...d.vertex] as Point2 } : {}),
  }));
  if (options.part?.features?.gear && effectivePartType(options.part) === 'gear') {
    let lane = 0;
    for (const dimension of result)
      if (!dimension.locked && dimension.automatic && dimension.kind === 'angle')
        dimension.offset =
          (options.part.features.gear.outsideDiameter * scale) / 2 + 8 + lane++ * 6;
  }
  interface Span {
    dimension: Dimension;
    min: number;
    max: number;
    length: number;
    labelMin: number;
    labelMax: number;
    lane: number;
    side: number;
    normal?: Point2;
    normalSign: number;
    labelHeight: number;
  }
  const groups = new Map<string, Span[]>();
  for (const d of result) {
    if (d.locked) continue;
    if (!['horizontal', 'vertical', 'aligned'].includes(d.kind)) continue;
    delete d.textOffset;
    let axis: Point2 = d.kind === 'horizontal' ? [1, 0] : [0, 1];
    let orientation: string = d.kind;
    if (d.kind === 'aligned') {
      const dx = d.b[0] - d.a[0],
        dy = d.b[1] - d.a[1],
        length = Math.hypot(dx, dy) || 1;
      axis = [dx / length, dy / length];
      if (axis[0] < -1e-9 || (Math.abs(axis[0]) < 1e-9 && axis[1] < 0)) axis = [-axis[0], -axis[1]];
      orientation = `aligned:${Math.atan2(axis[1], axis[0]).toFixed(6)}`;
    }
    const a = (d.a[0] * axis[0] + d.a[1] * axis[1]) * scale,
      b = (d.b[0] * axis[0] + d.b[1] * axis[1]) * scale;
    const min = Math.min(a, b),
      max = Math.max(a, b),
      midpoint = (min + max) / 2;
    const label = formatDimensionLabel(d, precision);
    const short = d.kind !== 'aligned' && max - min < label.width + 5;
    const labelCenter = short ? max + 5 + label.width / 2 : midpoint;
    const normalSign =
      d.kind === 'aligned' && (d.b[0] - d.a[0]) * axis[0] + (d.b[1] - d.a[1]) * axis[1] < 0
        ? -1
        : 1;
    const side = d.offset * normalSign < 0 ? -1 : 1;
    const key = `${d.viewId}:${orientation}:${side}`;
    const span: Span = {
      dimension: d,
      min,
      max,
      length: max - min,
      labelMin: Math.min(min - (short ? 4 : 0), labelCenter + label.bounds.minX),
      labelMax: Math.max(max + (short ? 4 : 0), labelCenter + label.bounds.maxX),
      lane: -1,
      side,
      normalSign,
      labelHeight: label.height,
      ...(d.kind === 'aligned' ? { normal: [axis[1], axis[0]] as Point2 } : {}),
    };
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(span);
  }
  const overlaps = (a: Span, b: Span) =>
    a.labelMin <= b.labelMax + 2 && b.labelMin <= a.labelMax + 2;
  for (const spans of groups.values()) {
    const lanePitch = Math.max(6, ...spans.map((span) => span.labelHeight + 1.5));
    const projection = options.part?.views.find((view) => view.id === spans[0].dimension.viewId);
    const referencePoints: Point2[] = projection
      ? [
          [projection.bounds.minX, projection.bounds.minY],
          [projection.bounds.maxX, projection.bounds.minY],
          [projection.bounds.maxX, projection.bounds.maxY],
          [projection.bounds.minX, projection.bounds.maxY],
        ]
      : spans.flatMap((span) => [span.dimension.a, span.dimension.b]);
    const placed: Span[] = [];
    for (const span of spans.sort(
      (a, b) =>
        a.length - b.length || a.min - b.min || a.dimension.id.localeCompare(b.dimension.id),
    )) {
      // Every intersecting smaller span must stay closer to the geometry.
      span.lane = placed
        .filter((other) => overlaps(span, other))
        .reduce((lane, other) => Math.max(lane, other.lane + 1), 0);
      const distance = 9 + span.lane * lanePitch,
        d = span.dimension;
      if (d.kind === 'horizontal') {
        const target =
          span.side > 0
            ? -Math.min(...referencePoints.map((p) => p[1])) * scale + distance
            : -Math.max(...referencePoints.map((p) => p[1])) * scale - distance;
        d.offset = target + Math.min(d.a[1], d.b[1]) * scale;
      } else if (d.kind === 'vertical') {
        const target =
          span.side > 0
            ? Math.min(...referencePoints.map((p) => p[0])) * scale - distance
            : Math.max(...referencePoints.map((p) => p[0])) * scale + distance;
        d.offset = Math.min(d.a[0], d.b[0]) * scale - target;
      } else {
        const normal = span.normal!;
        const at = (p: Point2) => (p[0] * normal[0] - p[1] * normal[1]) * scale;
        const values = referencePoints.map(at);
        const target =
          span.side > 0 ? Math.max(...values) + distance : Math.min(...values) - distance;
        d.offset = (target - at(d.a)) * span.normalSign;
      }
      placed.push(span);
    }
  }
  arrangeCircleCallouts(result, scale, precision, options.part);
  return result;
}

function circularEnvelope(view: Projection): ProjectedEdge | undefined {
  const width = view.bounds.maxX - view.bounds.minX,
    height = view.bounds.maxY - view.bounds.minY;
  return view.edges.find(
    (edge) =>
      !edge.hidden &&
      edge.kind === 'circle' &&
      edge.closed !== false &&
      edge.center &&
      edge.radius &&
      Math.abs(width - 2 * edge.radius) < 1e-4 &&
      Math.abs(height - 2 * edge.radius) < 1e-4 &&
      Math.abs(edge.center[0] - (view.bounds.minX + view.bounds.maxX) / 2) < 1e-4 &&
      Math.abs(edge.center[1] - (view.bounds.minY + view.bounds.maxY) / 2) < 1e-4,
  );
}

/** Broad analytic arcs describe profile curvature without promoting every small fillet. */
function dominantProfileArcs(view: Projection): ProjectedEdge[] {
  const span = Math.max(view.bounds.maxX - view.bounds.minX, view.bounds.maxY - view.bounds.minY);
  const turn = Math.PI * 2;
  const groups: { edge: ProjectedEdge; intervals: [number, number][]; longest: number }[] = [];
  for (const edge of view.edges) {
    if (
      edge.hidden ||
      edge.kind !== 'circle' ||
      edge.closed !== false ||
      !edge.center ||
      !edge.radius ||
      edge.radius < span * 0.4 ||
      edge.points.length < 2
    )
      continue;
    if (
      view.edges.some(
        (other) =>
          !other.hidden &&
          other.kind === 'circle' &&
          other.closed !== false &&
          other.center &&
          other.radius &&
          near(other.radius, edge.radius!) &&
          near(other.center[0], edge.center![0]) &&
          near(other.center[1], edge.center![1]),
      )
    )
      continue;
    let sweep = 0;
    const intervals: [number, number][] = [];
    for (let index = 1; index < edge.points.length; index++) {
      const previous = edge.points[index - 1],
        current = edge.points[index];
      const first = Math.atan2(previous[1] - edge.center[1], previous[0] - edge.center[0]);
      const last = Math.atan2(current[1] - edge.center[1], current[0] - edge.center[0]);
      let angle = last - first;
      while (angle > Math.PI) angle -= Math.PI * 2;
      while (angle < -Math.PI) angle += Math.PI * 2;
      sweep += Math.abs(angle);
      const start = (((angle >= 0 ? first : last) % turn) + turn) % turn;
      const end = start + Math.abs(angle);
      intervals.push([start, Math.min(end, turn)]);
      if (end > turn) intervals.push([0, end - turn]);
    }
    const group = groups.find(
      (group) =>
        near(group.edge.radius!, edge.radius!) &&
        near(group.edge.center![0], edge.center![0]) &&
        near(group.edge.center![1], edge.center![1]),
    );
    if (group) {
      group.intervals.push(...intervals);
      if (sweep > group.longest) {
        group.edge = edge;
        group.longest = sweep;
      }
    } else groups.push({ edge, intervals, longest: sweep });
  }
  const sweep = (intervals: [number, number][]) => {
    let total = 0,
      end = -Infinity;
    for (const [low, high] of intervals.sort((a, b) => a[0] - b[0])) {
      total += Math.max(0, high - Math.max(low, end));
      end = Math.max(end, high);
    }
    return total;
  };
  return groups
    .map((group) => ({ ...group, sweep: sweep(group.intervals) }))
    .filter((group) => group.sweep >= Math.PI / 4 - 1e-6)
    .sort((a, b) => b.sweep - a.sweep || b.edge.radius! - a.edge.radius!)
    .filter(
      (group, index, sorted) =>
        sorted.findIndex((other) => near(other.edge.radius!, group.edge.radius!)) === index,
    )
    .slice(0, 3)
    .map((group) => group.edge);
}

function baselineCandidates(
  part: Part,
  view: Projection,
): { xs: number[]; ys: number[]; circles: ProjectedEdge[] } {
  const hasSourceEvidence = part.views.some((v) =>
    v.edges.some((edge) => edge.kind === 'line' && edge.sourcePoints !== undefined),
  );
  const points = view.edges
    .filter((edge) => {
      if (edge.hidden || edge.kind !== 'line' || edge.points.length < 2) return false;
      if (hasSourceEvidence && (edge.sourcePoints?.length ?? 0) < 2) return false;
      const a = edge.points[0],
        b = edge.points.at(-1)!;
      return near(a[0], b[0]) || near(a[1], b[1]);
    })
    .flatMap((edge) => [edge.points[0], edge.points.at(-1)!]);
  const circles = view.edges
    .filter(
      (edge) =>
        !edge.hidden &&
        edge.kind === 'circle' &&
        edge.closed !== false &&
        edge.center &&
        edge.radius &&
        edge.radius > 1e-7,
    )
    .filter(
      (edge, index, values) =>
        values.findIndex(
          (other) =>
            near(edge.radius!, other.radius!) &&
            near(edge.center![0], other.center![0]) &&
            near(edge.center![1], other.center![1]),
        ) === index,
    );
  const envelope = circularEnvelope(view);
  const centers = circles
    .filter(
      (edge) =>
        !envelope ||
        !near(edge.center![0], envelope.center![0]) ||
        !near(edge.center![1], envelope.center![1]),
    )
    .map((edge) => edge.center!);
  const all = [...points, ...centers];
  return {
    xs: unique(all.map((p) => p[0])).filter(
      (x) => x > view.bounds.minX + 1e-5 && x < view.bounds.maxX - 1e-5,
    ),
    ys: unique(all.map((p) => p[1])).filter(
      (y) => y > view.bounds.minY + 1e-5 && y < view.bounds.maxY - 1e-5,
    ),
    circles,
  };
}

function physicalSpan(d: Dimension): { axis: number; min: number; max: number } | undefined {
  if (d.viewId === 'iso' || !['horizontal', 'vertical'].includes(d.kind)) return;
  const horizontal = d.kind === 'horizontal';
  const axis =
    d.viewId === 'front'
      ? horizontal
        ? 0
        : 2
      : d.viewId === 'top'
        ? horizontal
          ? 0
          : 1
        : horizontal
          ? 1
          : 2;
  const sign = (d.viewId === 'top' && !horizontal) || (d.viewId === 'right' && horizontal) ? -1 : 1;
  const index = horizontal ? 0 : 1;
  const a = d.a[index] * sign,
    b = d.b[index] * sign;
  return { axis, min: Math.min(a, b), max: Math.max(a, b) };
}

function samePhysicalSpan(a: Dimension, b: Dimension): boolean {
  const first = physicalSpan(a),
    second = physicalSpan(b);
  return (
    !!first &&
    !!second &&
    first.axis === second.axis &&
    near(first.min, second.min) &&
    near(first.max, second.max)
  );
}

/** One physical baseline interval needs one annotation, preferably beside its visible feature. */
function deduplicateLinearDimensions(dimensions: Dimension[], part: Part): Dimension[] {
  const score = (dimension: Dimension) => {
    const view = part.views.find((view) => view.id === dimension.viewId)!;
    const coordinate = dimension.kind === 'horizontal' ? 0 : 1;
    return view.edges.some(
      (edge) =>
        !edge.hidden &&
        edge.kind === 'circle' &&
        edge.center &&
        (near(edge.center[coordinate], dimension.a[coordinate]) ||
          near(edge.center[coordinate], dimension.b[coordinate])),
    )
      ? 1
      : 0;
  };
  return dimensions.filter((dimension, index) => {
    if (!physicalSpan(dimension)) return true;
    return !dimensions.some(
      (other, otherIndex) =>
        samePhysicalSpan(dimension, other) &&
        (score(other) > score(dimension) ||
          (score(other) === score(dimension) && otherIndex < index)),
    );
  });
}

type SourceCircle = NonNullable<Part['features']>['circles'][number];
function viewPoint(point: Point3, id: Projection['id']): Point2 {
  return id === 'front'
    ? [point[0], point[2]]
    : id === 'top'
      ? [point[0], -point[1]]
      : [-point[1], point[2]];
}
function shaftFeatures(part: Part):
  | {
      axis: number;
      circles: SourceCircle[];
      side: Projection;
      end: Projection;
      horizontal: boolean;
      stations: number[];
    }
  | undefined {
  const source = part.features?.circles;
  if (!source || source.filter((circle) => circle.closed).length < 2) return;
  for (const axis of [0, 1, 2]) {
    const circles = source.filter(
      (circle) =>
        Math.abs(circle.normal[axis]) > 0.999999 &&
        circle.normal.every((component, index) => index === axis || Math.abs(component) < 1e-5),
    );
    const closed = circles.filter((circle) => circle.closed);
    if (closed.length < 2 || closed.length !== source.filter((circle) => circle.closed).length)
      continue;
    if (
      !circles.every((circle) =>
        circle.center.every(
          (value, index) => index === axis || near(value, circles[0].center[index]),
        ),
      )
    )
      continue;
    const extents = part.bounds.max.map((value, index) => value - part.bounds.min[index]);
    if (extents[axis] < Math.max(...extents.filter((_, index) => index !== axis)) * 1.5) continue;
    const side = part.views.find((view) => view.id === (axis === 1 ? 'top' : 'front'));
    const end = part.views.find(
      (view) => view.id === (axis === 0 ? 'right' : axis === 1 ? 'front' : 'top'),
    );
    if (!side || !end) continue;
    const horizontal = axis === 0;
    const stations = unique(
      closed.map((circle) => viewPoint(circle.center, side.id)[horizontal ? 0 : 1]),
    );
    if (stations.length < 2) continue;
    return { axis, circles, side, end, horizontal, stations };
  }
}

export function autoDimensionWarnings(part: Part, dimensions?: Dimension[]): string[] {
  if (part.features?.gear && effectivePartType(part) === 'gear')
    return gearDrawingOrientation(part)
      ? []
      : [
          'The measured gear axis is not aligned with an orthographic view. Orient the model before adding gear dimensions.',
        ];
  const shaft = shaftFeatures(part);
  if (shaft) {
    const axis = shaft.horizontal ? 0 : 1;
    const bounds = shaft.side.bounds,
      low = axis === 0 ? bounds.minX : bounds.minY,
      high = axis === 0 ? bounds.maxX : bounds.maxY;
    const interior = shaft.stations.filter((value) => value > low + 1e-5 && value < high - 1e-5);
    const missing = dimensions
      ? interior.filter(
          (station) =>
            !dimensions.some(
              (d) =>
                d.viewId === shaft.side.id &&
                d.kind === (shaft.horizontal ? 'horizontal' : 'vertical') &&
                (near(d.a[axis], station) || near(d.b[axis], station)),
            ),
        ).length
      : Math.max(0, interior.length - 12);
    return missing
      ? [
          `${missing} additional source-circle stations need dimensions. Use the full dimension set or add them manually.`,
        ]
      : [];
  }
  const omitted: Dimension[] = [];
  const present = dimensions ?? autoDimensions(part);
  for (const view of part.views.filter((v) => v.id !== 'iso')) {
    const { xs, ys, circles } = baselineCandidates(part, view);
    const missing = (coordinates: number[], kind: 'horizontal' | 'vertical') => {
      for (const coordinate of coordinates) {
        const datum: Point2 = [view.bounds.minX, view.bounds.minY];
        const endpoint: Point2 =
          kind === 'horizontal' ? [coordinate, datum[1]] : [datum[0], coordinate];
        const proposal: Dimension = {
          id: '',
          viewId: view.id,
          kind,
          a: datum,
          b: endpoint,
          value: 1,
          offset: 9,
          automatic: true,
        };
        if (
          !present.some((dimension) => samePhysicalSpan(dimension, proposal)) &&
          !omitted.some((dimension) => samePhysicalSpan(dimension, proposal))
        )
          omitted.push(proposal);
      }
    };
    if (view.id === 'front' || circles.length) {
      missing(xs, 'horizontal');
      missing(ys, 'vertical');
    } else if (view.id === 'top') missing(ys, 'vertical');
  }
  return omitted.length
    ? [
        `${omitted.length} profile coordinates are not included in the current dimensions. Choose All baseline coordinates to inspect them, then keep the dimensions needed for manufacture.`,
      ]
    : [];
}

/** Suggest geometric dimensions only. STEP geometry cannot supply manufacturing intent. */
export function autoDimensions(part: Part, detail: 'balanced' | 'full' = 'balanced'): Dimension[] {
  if (part.features?.gear && effectivePartType(part) === 'gear')
    return arrangeDimensions(measuredGearDimensions(part), { part });
  const dimensions: Dimension[] = [];
  let serial = 0;
  const push = (
    view: Projection,
    kind: Dimension['kind'],
    a: Point2,
    b: Point2,
    value: number,
    offset: number,
    suffix?: string,
  ) => {
    if (!Number.isFinite(value) || value < 1e-7) return;
    dimensions.push({
      id: `${part.id}-auto-${serial++}`,
      viewId: view.id,
      kind,
      a,
      b,
      value,
      offset,
      automatic: true,
      suffix,
    });
  };

  const shaft = shaftFeatures(part);
  if (shaft) {
    const { side, end, horizontal, circles, stations } = shaft;
    const { minX, minY, maxX, maxY } = side.bounds;
    const low = horizontal ? minX : minY,
      high = horizontal ? maxX : maxY;
    const axial = (a: number, b: number) =>
      push(
        side,
        horizontal ? 'horizontal' : 'vertical',
        horizontal ? [a, minY] : [minX, a],
        horizontal ? [b, minY] : [minX, b],
        Math.abs(b - a),
        9,
      );
    axial(low, high);
    const interior = stations.filter((station) => station > low + 1e-5 && station < high - 1e-5);
    for (const station of interior.slice(0, detail === 'full' ? Infinity : 12))
      axial(Math.abs(station - low) <= Math.abs(high - station) ? low : high, station);
    const sizes = unique(circles.filter((circle) => circle.closed).map((circle) => circle.radius));
    const maxRadius = Math.max(...circles.map((circle) => circle.radius));
    const largestClosed = Math.max(...sizes);
    // A partial circular edge gives an exact radius, but is not proof of a full diameter.
    const outerArc = end.edges.find(
      (edge) =>
        !edge.hidden &&
        edge.kind === 'circle' &&
        edge.closed === false &&
        edge.center &&
        edge.radius &&
        near(edge.radius, maxRadius),
    );
    if (maxRadius > largestClosed + 1e-5 && outerArc?.center && outerArc.points.length) {
      const rim = outerArc.points[Math.floor(outerArc.points.length / 2)];
      push(end, 'radius', [...outerArc.center], [...rim], maxRadius, 10);
    }
    const transverseExtent = horizontal ? maxY - minY : maxX - minX;
    if (
      transverseExtent > largestClosed * 2 + 1e-5 &&
      !(outerArc && near(transverseExtent, maxRadius * 2))
    )
      push(
        side,
        horizontal ? 'vertical' : 'horizontal',
        [minX, minY],
        horizontal ? [minX, maxY] : [maxX, minY],
        transverseExtent,
        9,
      );
    for (const radius of sizes) {
      const feature = circles.find((circle) => circle.closed && near(circle.radius, radius))!;
      const center = viewPoint(feature.center, end.id);
      push(end, 'diameter', center, [center[0] + radius, center[1]], radius * 2, 10);
    }
    return arrangeDimensions(dimensions, { part });
  }

  const envelopes = part.views
    .filter((view) => view.id !== 'iso')
    .filter((view) => circularEnvelope(view));
  const coveredX = envelopes.some((view) => view.id === 'front' || view.id === 'top');
  const coveredY = envelopes.some((view) => view.id === 'top' || view.id === 'right');
  const coveredZ = envelopes.some((view) => view.id === 'front' || view.id === 'right');

  for (const view of part.views.filter((v) => v.id !== 'iso')) {
    const { minX, minY, maxX, maxY } = view.bounds;
    const width = maxX - minX,
      height = maxY - minY;
    if (view.id === 'front') {
      if (!coveredX) push(view, 'horizontal', [minX, minY], [maxX, minY], width, 9);
      if (!coveredZ) push(view, 'vertical', [minX, minY], [minX, maxY], height, 9);
    } else if (view.id === 'top' && !coveredY) {
      push(view, 'vertical', [minX, minY], [minX, maxY], height, 9);
    }
    const { xs, ys, circles: distinctCircles } = baselineCandidates(part, view);
    const diameters = new Set<string>();
    for (const circle of distinctCircles) {
      const key = circle.radius!.toFixed(5);
      if (diameters.has(key)) continue;
      diameters.add(key);
      const count = distinctCircles.filter((c) => near(c.radius!, circle.radius!)).length;
      const c = distinctCircles
        .filter((candidate) => near(candidate.radius!, circle.radius!))
        .sort((a, b) => {
          const distance = (edge: ProjectedEdge) =>
            Math.min(edge.center![0] - minX, maxX - edge.center![0]);
          return (
            distance(a) - distance(b) || b.center![1] - a.center![1] || b.center![0] - a.center![0]
          );
        })[0].center!;
      push(
        view,
        'diameter',
        c,
        [c[0] + circle.radius!, c[1]],
        circle.radius! * 2,
        8 + diameters.size * 4,
        count > 1 ? ` (${count}x)` : undefined,
      );
    }
    for (const arc of dominantProfileArcs(view)) {
      const rim = arc.points[Math.floor(arc.points.length / 2)];
      push(
        view,
        'radius',
        [...arc.center!],
        [...rim],
        arc.radius!,
        rim[0] < arc.center![0] ? -10 : 10,
      );
    }

    const budget = detail === 'full' ? Infinity : 5;
    const coordinates = (values: number[], axis: number) => {
      const isCenter = (coordinate: number) =>
        distinctCircles.some((circle) => near(circle.center![axis], coordinate));
      return [...values.filter(isCenter), ...values.filter((coordinate) => !isCenter(coordinate))]
        .slice(0, budget)
        .sort((a, b) => a - b);
    };
    if (view.id === 'front' || distinctCircles.length) {
      for (const [index, x] of coordinates(xs, 0).entries())
        push(view, 'horizontal', [minX, minY], [x, minY], x - minX, 15 + index * 6);
      for (const [index, y] of coordinates(ys, 1).entries())
        push(view, 'vertical', [minX, minY], [minX, y], y - minY, 15 + index * 6);
    } else if (view.id === 'top') {
      for (const [index, y] of coordinates(ys, 1).entries())
        push(view, 'vertical', [minX, minY], [minX, y], y - minY, 15 + index * 6);
    }
  }
  return arrangeDimensions(deduplicateLinearDimensions(dimensions, part), { part });
}

export function formatDimension(dimension: Dimension, precision: number): string {
  return formatDimensionLabel(dimension, precision).plainText;
}
