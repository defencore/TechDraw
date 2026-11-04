import type { Dimension, Part, Point2, Point3, ProjectedEdge, Projection } from '../model';
import { dimensionLeaderMetrics, formatDimensionLabel } from './dimension-label';

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
  const circles = new Map<string, Dimension[]>();
  for (const d of result.filter((d) => d.kind === 'diameter' || d.kind === 'radius')) {
    delete d.textOffset;
    d.offset = d.offset < 0 ? -10 : 10;
    const key = `${d.viewId}:${d.offset < 0 ? '-' : '+'}`;
    if (!circles.has(key)) circles.set(key, []);
    circles.get(key)!.push(d);
  }
  for (const items of circles.values()) {
    const boxes = items
      .map((d) => {
        const side = d.offset < 0 ? -1 : 1,
          radius = Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1]) * scale;
        const rimX = d.kind === 'radius' ? d.b[0] * scale : d.a[0] * scale + side * radius * 0.7071;
        const rimY = d.kind === 'radius' ? -d.b[1] * scale : -d.a[1] * scale - radius * 0.7071;
        const metrics = dimensionLeaderMetrics(d, precision);
        const label = formatDimensionLabel(d, precision);
        const x = rimX + side * (Math.abs(d.offset) + metrics.halfLength);
        const y = rimY - Math.abs(d.offset) * 0.6 + metrics.baselineOffset;
        return { d, x, y, bounds: label.bounds };
      })
      .sort((a, b) => b.y + b.bounds.maxY - a.y - a.bounds.maxY || a.x - b.x);
    const placed: typeof boxes = [];
    for (const box of boxes) {
      const initial = box.y;
      for (const prior of placed)
        if (
          box.x + box.bounds.minX <= prior.x + prior.bounds.maxX + 2 &&
          box.x + box.bounds.maxX >= prior.x + prior.bounds.minX - 2 &&
          box.y + box.bounds.maxY > prior.y + prior.bounds.minY - 1.5
        )
          box.y = prior.y + prior.bounds.minY - 1.5 - box.bounds.maxY;
      if (box.y !== initial) box.d.textOffset = [0, box.y - initial];
      placed.push(box);
    }
  }
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
  let omitted = 0;
  for (const view of part.views.filter((v) => v.id !== 'iso')) {
    const { xs, ys, circles } = baselineCandidates(part, view);
    const missing = (coordinates: number[], kind: 'horizontal' | 'vertical') =>
      coordinates.filter(
        (coordinate) =>
          !dimensions?.some((d) => {
            const axis = kind === 'horizontal' ? 0 : 1;
            const datum = axis === 0 ? view.bounds.minX : view.bounds.minY;
            return (
              d.viewId === view.id &&
              d.kind === kind &&
              near(Math.min(d.a[axis], d.b[axis]), datum) &&
              near(Math.max(d.a[axis], d.b[axis]), coordinate)
            );
          }),
      ).length;
    if (view.id === 'front' || circles.length)
      omitted += dimensions
        ? missing(xs, 'horizontal') + missing(ys, 'vertical')
        : Math.max(0, xs.length - 5) + Math.max(0, ys.length - 5);
    else if (view.id === 'top')
      omitted += dimensions ? missing(ys, 'vertical') : Math.max(0, ys.length - 5);
  }
  return omitted
    ? [
        `${omitted} additional baseline coordinates are available. The initial dimension set is limited for readability; use manual dimensions to complete the drawing.`,
      ]
    : [];
}

/** Suggest geometric dimensions only. STEP geometry cannot supply manufacturing intent. */
export function autoDimensions(part: Part, detail: 'balanced' | 'full' = 'balanced'): Dimension[] {
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
    if (transverseExtent > largestClosed * 2 + 1e-5)
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
      const c = circle.center!;
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

    const budget = detail === 'full' ? Infinity : 5;
    if (view.id === 'front' || distinctCircles.length) {
      for (const [index, x] of xs.slice(0, budget).entries())
        push(view, 'horizontal', [minX, minY], [x, minY], x - minX, 15 + index * 6);
      for (const [index, y] of ys.slice(0, budget).entries())
        push(view, 'vertical', [minX, minY], [minX, y], y - minY, 15 + index * 6);
    } else if (view.id === 'top') {
      for (const [index, y] of ys.slice(0, budget).entries())
        push(view, 'vertical', [minX, minY], [minX, y], y - minY, 15 + index * 6);
    }
  }
  return arrangeDimensions(dimensions, { part });
}

export function formatDimension(dimension: Dimension, precision: number): string {
  return formatDimensionLabel(dimension, precision).plainText;
}
