import { cast, getOC, ProjectionCamera, lookFromPlane, type AnyShape, type Edge } from 'replicad';
import type {
  ImportResult,
  Part,
  Point2,
  Point3,
  ProjectedEdge,
  Projection,
  ViewId,
} from '../model';
import { readStepProducts, stepPartDisplayName, type StepProduct } from './step-metadata';
import type { BRepAdaptor_Curve, TopAbs_ShapeEnum, TopoDS_Shape } from 'replicad-opencascadejs';

export type CadProgress = (message: string) => void;

const MAX_SOLIDS = 500;
const MAX_EDGES_PER_PART = 12000;
const DISPLAY_DEFLECTION_MM = 0.005;
type SourceLine = [Point3, Point3];
type SourceCircle = { id: string; center: Point3; normal: Point3; radius: number; closed: boolean };
type ClassifiedEdge = { edge: Edge; role: 'hard' | 'outline' };
const VIEWS: { id: ViewId; name: string }[] = [
  { id: 'front', name: 'Front' },
  { id: 'top', name: 'Top' },
  { id: 'right', name: 'Right' },
  { id: 'iso', name: 'Isometric' },
];

function ownedShape(raw: TopoDS_Shape): AnyShape {
  try {
    return cast(raw);
  } finally {
    raw.delete();
  }
}

/** Dispose every explorer handle, including duplicate topological occurrences. */
function subShapes(shape: AnyShape, kind: TopAbs_ShapeEnum): AnyShape[] {
  const oc = getOC();
  const explorer = new oc.TopExp_Explorer(shape.wrapped, kind, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  const output: AnyShape[] = [];
  try {
    while (explorer.More()) {
      const raw = explorer.Current();
      if (output.some((item) => item.wrapped.IsSame(raw))) raw.delete();
      else output.push(ownedShape(raw));
      explorer.Next();
    }
    return output;
  } catch (error) {
    output.forEach((item) => item.delete());
    throw error;
  } finally {
    explorer.delete();
  }
}

function edgesOf(shape: AnyShape): Edge[] {
  return subShapes(shape, getOC().TopAbs_ShapeEnum.TopAbs_EDGE) as Edge[];
}

function solidsOf(shape: AnyShape): AnyShape[] {
  return subShapes(shape, getOC().TopAbs_ShapeEnum.TopAbs_SOLID);
}

function point(vector: { toTuple(): Point3; delete(): void }): Point3 {
  try {
    return vector.toTuple();
  } finally {
    vector.delete();
  }
}

function distanceToSegment(p: Point2, a: Point2, b: Point2): number {
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  const denominator = dx * dx + dy * dy;
  const t = denominator
    ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / denominator))
    : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

/** Curves are sampled only for display. Dimensions use kernel geometry. */
function sampleEdge(adaptor: BRepAdaptor_Curve, linear: boolean): Point2[] {
  const first = adaptor.FirstParameter(),
    span = adaptor.LastParameter() - first;
  const at = (t: number): Point2 => {
    const p = adaptor.Value(first + t * span);
    try {
      return [p.X(), p.Y()];
    } finally {
      p.delete();
    }
  };
  if (linear) return [at(0), at(1)];
  const output: Point2[] = [];
  const subdivide = (a: number, b: number, p: Point2, q: Point2, depth: number) => {
    const mid = (a + b) / 2,
      m = at(mid);
    const quarter = at((a + mid) / 2),
      threeQuarter = at((mid + b) / 2);
    const error = Math.max(
      distanceToSegment(m, p, q),
      distanceToSegment(quarter, p, q),
      distanceToSegment(threeQuarter, p, q),
    );
    if (error > DISPLAY_DEFLECTION_MM && depth < 10) {
      subdivide(a, mid, p, m, depth + 1);
      subdivide(mid, b, m, q, depth + 1);
    } else output.push(q);
  };
  // Multiple seed intervals also resolve closed, periodic and inflected curves.
  output.push(at(0));
  for (let i = 0; i < 8; i++) subdivide(i / 8, (i + 1) / 8, at(i / 8), at((i + 1) / 8), 0);
  return output;
}

function serializeEdge(edge: Edge, hidden: boolean, id: string): ProjectedEdge {
  const oc = getOC();
  const adaptor = new oc.BRepAdaptor_Curve(edge.wrapped);
  try {
    const type = adaptor.GetType();
    const linear = type === oc.GeomAbs_CurveType.GeomAbs_Line;
    const circular = type === oc.GeomAbs_CurveType.GeomAbs_Circle;
    const result: ProjectedEdge = {
      id,
      hidden,
      kind: linear ? 'line' : circular ? 'circle' : 'curve',
      points: sampleEdge(adaptor, linear),
      closed: circular
        ? Math.abs(adaptor.LastParameter() - adaptor.FirstParameter()) >= 2 * Math.PI - 1e-7
        : adaptor.IsClosed(),
    };
    // OCCT can return an edge-on conic as a degenerate spline rather than a line.
    // Its exact kernel extrema preserve the complete straight projected stroke.
    if (!linear && !circular) {
      const box = edge.boundingBox;
      try {
        const [min, max] = box.bounds;
        if (max[1] - min[1] <= 3e-7 && max[0] - min[0] > 3e-7) {
          result.kind = 'line';
          result.closed = false;
          result.points = [
            [min[0], (min[1] + max[1]) / 2],
            [max[0], (min[1] + max[1]) / 2],
          ];
        } else if (max[0] - min[0] <= 3e-7 && max[1] - min[1] > 3e-7) {
          result.kind = 'line';
          result.closed = false;
          result.points = [
            [(min[0] + max[0]) / 2, min[1]],
            [(min[0] + max[0]) / 2, max[1]],
          ];
        }
      } finally {
        box.delete();
      }
    }
    if (circular) {
      const circle = adaptor.Circle();
      const center = circle.Location();
      try {
        result.center = [center.X(), center.Y()];
        result.radius = circle.Radius();
      } finally {
        center.delete();
        circle.delete();
      }
    }
    return result;
  } finally {
    adaptor.delete();
  }
}

/** Keep exact HLR shapes alive only until their independent edge handles exist. */
function projectedEdges(
  shape: AnyShape,
  camera: ProjectionCamera,
): { visible: ClassifiedEdge[]; hidden: ClassifiedEdge[] } {
  const oc = getOC();
  const algorithm = new oc.HLRBRep_Algo();
  const projector = new oc.HLRAlgo_Projector(camera.wrapped);
  let converter: InstanceType<typeof oc.HLRBRep_HLRToShape> | undefined;
  try {
    algorithm.Add(shape.wrapped, 0);
    algorithm.Projector(projector);
    algorithm.Update();
    algorithm.Hide();
    converter = new oc.HLRBRep_HLRToShape(algorithm);
    const collect = (
      items: ReturnType<InstanceType<typeof oc.HLRBRep_HLRToShape>['VCompound']>[],
    ): Edge[] =>
      items.flatMap((raw) => {
        if (raw.IsNull()) {
          raw.delete();
          return [];
        }
        const wrapped = ownedShape(raw);
        try {
          const edges = edgesOf(wrapped);
          edges.forEach((edge) => oc.BRepLib.BuildCurves3d(edge.wrapped));
          return edges;
        } finally {
          wrapped.delete();
        }
      });
    return {
      // G1 tangent boundaries are not physical sharp edges. Keep hard edges and
      // apparent contours; surface seams and tangent joins are intentionally omitted.
      visible: [
        ...collect([converter.VCompound()]).map((edge) => ({ edge, role: 'hard' as const })),
        ...collect([converter.OutLineVCompound()]).map((edge) => ({
          edge,
          role: 'outline' as const,
        })),
      ],
      hidden: [
        ...collect([converter.HCompound()]).map((edge) => ({ edge, role: 'hard' as const })),
        ...collect([converter.OutLineHCompound()]).map((edge) => ({
          edge,
          role: 'outline' as const,
        })),
      ],
    };
  } finally {
    converter?.delete();
    projector.delete();
    algorithm.delete();
  }
}

const GEOMETRY_TOLERANCE_MM = 1e-7;

/** Remove coincident strokes without removing modeled grooves or nearby detail. */
export function cleanProjectedEdges(input: ProjectedEdge[]): ProjectedEdge[] {
  const quantize = (value: number) => Math.round(value / GEOMETRY_TOLERANCE_MM);
  const coordinate = (point: Point2) => `${quantize(point[0])},${quantize(point[1])}`;
  const curveKey = (edge: ProjectedEdge): string => {
    if (edge.kind === 'circle' && edge.closed && edge.center && edge.radius) {
      return `circle:${coordinate(edge.center)}:${quantize(edge.radius)}`;
    }
    const points = edge.points.map(coordinate);
    const forward = points.join(';'),
      backward = points.reverse().join(';');
    return `${edge.kind}:${forward < backward ? forward : backward}`;
  };
  const output: ProjectedEdge[] = [];
  const curves = new Set<string>();
  const coveredLines = new Map<
    string,
    { start: number; end: number; normal: number; ux: number; uy: number }[]
  >();
  // A visible solid stroke wins wherever an identical hidden stroke projects onto it.
  const ordered = [...input].sort(
    (a, b) =>
      Number(a.hidden) - Number(b.hidden) ||
      (b.kind === 'line'
        ? Math.hypot(b.points.at(-1)![0] - b.points[0][0], b.points.at(-1)![1] - b.points[0][1])
        : 0) -
        (a.kind === 'line'
          ? Math.hypot(a.points.at(-1)![0] - a.points[0][0], a.points.at(-1)![1] - a.points[0][1])
          : 0),
  );
  for (const edge of ordered) {
    if (edge.points.length < 2) continue;
    if (edge.kind !== 'line') {
      const key = curveKey(edge);
      if (!curves.has(key)) {
        curves.add(key);
        output.push(edge);
      }
      continue;
    }
    const a = edge.points[0],
      b = edge.points.at(-1)!;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length <= GEOMETRY_TOLERANCE_MM) continue;
    const sign =
      b[0] < a[0] - GEOMETRY_TOLERANCE_MM ||
      (Math.abs(b[0] - a[0]) <= GEOMETRY_TOLERANCE_MM && b[1] < a[1])
        ? -1
        : 1;
    const ux = ((b[0] - a[0]) / length) * sign,
      uy = ((b[1] - a[1]) / length) * sign;
    const normal = -uy * a[0] + ux * a[1];
    const key = `${Math.round(ux * 1e10)},${Math.round(uy * 1e10)},${quantize(normal)}`;
    const first = ux * a[0] + uy * a[1],
      last = ux * b[0] + uy * b[1];
    let intervals: [number, number][] = [[Math.min(first, last), Math.max(first, last)]];
    for (const previous of coveredLines.get(key) || []) {
      if (
        Math.abs(-previous.uy * a[0] + previous.ux * a[1] - previous.normal) >
          GEOMETRY_TOLERANCE_MM ||
        Math.abs(-previous.uy * b[0] + previous.ux * b[1] - previous.normal) > GEOMETRY_TOLERANCE_MM
      )
        continue;
      const direction = ux * previous.ux + uy * previous.uy;
      const offset = previous.normal * (-ux * previous.uy + uy * previous.ux);
      const previousStart = previous.start * direction + offset;
      const previousEnd = previous.end * direction + offset;
      intervals = intervals.flatMap(([start, end]) => {
        if (
          previousEnd <= start + GEOMETRY_TOLERANCE_MM ||
          previousStart >= end - GEOMETRY_TOLERANCE_MM
        )
          return [[start, end]];
        const remaining: [number, number][] = [];
        if (previousStart > start + GEOMETRY_TOLERANCE_MM)
          remaining.push([start, Math.min(end, previousStart)]);
        if (previousEnd < end - GEOMETRY_TOLERANCE_MM)
          remaining.push([Math.max(start, previousEnd), end]);
        return remaining;
      });
      if (!intervals.length) break;
    }
    for (const [index, [start, end]] of intervals.entries()) {
      const toPoint = (distance: number): Point2 => [
        ux * distance - uy * normal,
        uy * distance + ux * normal,
      ];
      const complete =
        Math.abs(start - Math.min(first, last)) < GEOMETRY_TOLERANCE_MM &&
        Math.abs(end - Math.max(first, last)) < GEOMETRY_TOLERANCE_MM;
      output.push(
        complete
          ? edge
          : {
              ...edge,
              id: `${edge.id}-clip-${index}`,
              points: [toPoint(start), toPoint(end)],
              sourcePoints: [],
              length: undefined,
            },
      );
      coveredLines.set(key, [...(coveredLines.get(key) || []), { start, end, normal, ux, uy }]);
    }
  }
  return output;
}

function project(
  shape: AnyShape,
  id: ViewId,
  name: string,
  sourceVertices: Point3[],
  sourceLines: SourceLine[],
): Projection {
  const camera =
    id === 'iso' ? new ProjectionCamera([0, 0, 0], [1, -1, 1], [1, 1, 0]) : lookFromPlane(id);
  const x = point(camera.xAxis),
    y = point(camera.yAxis);
  const dot = (p: Point3, axis: Point3) => p[0] * axis[0] + p[1] * axis[1] + p[2] * axis[2];
  const to2d = (source: Point3): Point2 => [dot(source, x), dot(source, y)];
  const lineKey = (a: Point2, b: Point2): string => {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length < 1e-9) return '';
    const sign = b[0] < a[0] - 1e-9 || (Math.abs(b[0] - a[0]) < 1e-9 && b[1] < a[1]) ? -1 : 1;
    const ux = ((b[0] - a[0]) / length) * sign,
      uy = ((b[1] - a[1]) / length) * sign;
    return `${Math.round(ux * 1e5)},${Math.round(uy * 1e5)},${Math.round((-uy * a[0] + ux * a[1]) * 1e4)}`;
  };
  const lineGroups = new Map<string, { source: SourceLine; a: Point2; b: Point2 }[]>();
  for (const source of sourceLines) {
    const a = to2d(source[0]),
      b = to2d(source[1]),
      key = lineKey(a, b);
    if (key) lineGroups.set(key, [...(lineGroups.get(key) || []), { source, a, b }]);
  }
  const attachSource = (edge: ProjectedEdge) => {
    if (edge.kind !== 'line') return;
    // Empty evidence distinguishes new projection-only strokes from older saved projects.
    edge.sourcePoints = [];
    const p = edge.points[0],
      q = edge.points.at(-1)!;
    const candidates: { source: SourceLine; length: number }[] = [];
    for (const line of lineGroups.get(lineKey(p, q)) || []) {
      const dx = line.b[0] - line.a[0],
        dy = line.b[1] - line.a[1],
        squared = dx * dx + dy * dy;
      const parameter = (at: Point2) =>
        ((at[0] - line.a[0]) * dx + (at[1] - line.a[1]) * dy) / squared;
      const t = parameter(p),
        u = parameter(q);
      if (Math.min(t, u) < -1e-7 || Math.max(t, u) > 1 + 1e-7) continue;
      if (
        distanceToSegment(p, line.a, line.b) > 1e-5 ||
        distanceToSegment(q, line.a, line.b) > 1e-5
      )
        continue;
      const interpolate = (v: number): Point3 =>
        [0, 1, 2].map(
          (axis) => line.source[0][axis] + v * (line.source[1][axis] - line.source[0][axis]),
        ) as Point3;
      const a = interpolate(t),
        b = interpolate(u);
      candidates.push({
        source: [a, b],
        length: Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]),
      });
    }
    if (
      candidates.length &&
      candidates.every((candidate) => Math.abs(candidate.length - candidates[0].length) < 1e-5)
    ) {
      edge.sourcePoints = candidates[0].source;
      edge.length = candidates[0].length;
    }
  };
  const projected = projectedEdges(shape, camera);
  const edges: ProjectedEdge[] = [];
  try {
    for (const [hidden, items] of [
      [false, projected.visible],
      [true, projected.hidden],
    ] as const) {
      for (const item of items) {
        const serialized = Object.assign(
          serializeEdge(item.edge, hidden, `${id}-${hidden ? 'h' : 'v'}-${edges.length}`),
          { role: item.role },
        );
        edges.push(serialized);
      }
    }
    if (!edges.length) throw new Error(`${name} projection contains no drawable geometry.`);
    // Kernel bounds include exact extrema even when a curve's sampled points miss an extremum.
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const item of [...projected.visible, ...projected.hidden]) {
      const box = item.edge.boundingBox;
      try {
        const [lo, hi] = box.bounds;
        minX = Math.min(minX, lo[0]);
        minY = Math.min(minY, lo[1]);
        maxX = Math.max(maxX, hi[0]);
        maxY = Math.max(maxY, hi[1]);
      } finally {
        box.delete();
      }
    }
    const cleanEdges = cleanProjectedEdges(edges);
    cleanEdges.forEach(attachSource);
    return {
      id,
      name,
      edges: cleanEdges,
      bounds: { minX, minY, maxX, maxY },
      anchors: sourceVertices.map((source, i) => ({
        id: `${id}-vertex-${i}`,
        source,
        point: to2d(source),
      })),
    };
  } finally {
    for (const item of [...projected.visible, ...projected.hidden]) item.edge.delete();
    camera.delete();
  }
}

function sourcePoints(shape: AnyShape): Point3[] {
  const result: Point3[] = [];
  const vertices = subShapes(shape, getOC().TopAbs_ShapeEnum.TopAbs_VERTEX);
  try {
    for (const vertex of vertices) {
      const raw = getOC().TopoDS.Vertex(vertex.wrapped);
      try {
        const ocPoint = getOC().BRep_Tool.Pnt(raw);
        try {
          result.push([ocPoint.X(), ocPoint.Y(), ocPoint.Z()]);
        } finally {
          ocPoint.delete();
        }
      } finally {
        raw.delete();
      }
    }
  } finally {
    vertices.forEach((vertex) => vertex.delete());
  }
  return result;
}

function toPart(
  shape: AnyShape,
  index: number,
  sourceName: string,
  name: string,
  progress: CadProgress,
  path: string[] = [sourceName, name],
): Part {
  const oc = getOC();
  const edgeCount = edgesOf(shape);
  const count = edgeCount.length;
  const sourceLines: SourceLine[] = [];
  const sourceCircles: SourceCircle[] = [];
  for (const edge of edgeCount) {
    const adaptor = new oc.BRepAdaptor_Curve(edge.wrapped);
    try {
      if (adaptor.GetType() === oc.GeomAbs_CurveType.GeomAbs_Circle) {
        const circle = adaptor.Circle(),
          center = circle.Location(),
          axis = circle.Axis(),
          normal = axis.Direction();
        try {
          const feature: SourceCircle = {
            id: `source-circle-${sourceCircles.length}`,
            center: [center.X(), center.Y(), center.Z()],
            normal: [normal.X(), normal.Y(), normal.Z()],
            radius: circle.Radius(),
            closed:
              Math.abs(adaptor.LastParameter() - adaptor.FirstParameter()) >= 2 * Math.PI - 1e-7,
          };
          // A circle axis is unoriented: +N and -N describe the same feature plane.
          if (
            !sourceCircles.some(
              (other) =>
                other.closed === feature.closed &&
                Math.abs(other.radius - feature.radius) < 1e-7 &&
                Math.hypot(...other.center.map((value, axis) => value - feature.center[axis])) <
                  1e-7 &&
                Math.abs(
                  Math.abs(
                    other.normal.reduce(
                      (sum, value, axis) => sum + value * feature.normal[axis],
                      0,
                    ),
                  ) - 1,
                ) < 1e-9,
            )
          )
            sourceCircles.push(feature);
        } finally {
          normal.delete();
          axis.delete();
          center.delete();
          circle.delete();
        }
      }
      if (adaptor.GetType() !== oc.GeomAbs_CurveType.GeomAbs_Line) continue;
      const a = adaptor.Value(adaptor.FirstParameter()),
        b = adaptor.Value(adaptor.LastParameter());
      try {
        sourceLines.push([
          [a.X(), a.Y(), a.Z()],
          [b.X(), b.Y(), b.Z()],
        ]);
      } finally {
        a.delete();
        b.delete();
      }
    } finally {
      adaptor.delete();
    }
  }
  edgeCount.forEach((edge) => edge.delete());
  if (count > MAX_EDGES_PER_PART)
    throw new Error(
      `Part ${index + 1} contains ${count} edges. Split this model into smaller STEP files (limit: ${MAX_EDGES_PER_PART} edges per part).`,
    );
  const warnings: string[] = [];
  const analyzer = new oc.BRepCheck_Analyzer(shape.wrapped, true, false, false);
  try {
    if (!analyzer.IsValid())
      warnings.push(
        'The CAD kernel found invalid topology. Repair the source model before manufacturing.',
      );
  } finally {
    analyzer.delete();
  }
  const bbox = shape.boundingBox;
  let bounds: Part['bounds'];
  try {
    const [min, max] = bbox.bounds;
    bounds = { min, max };
  } finally {
    bbox.delete();
  }
  const vertices = sourcePoints(shape);
  const views = VIEWS.map((view) => {
    progress(`Projecting ${name} · ${view.name.toLowerCase()} view`);
    return project(shape, view.id, view.name, vertices, sourceLines);
  });
  if (views.some((v) => v.edges.some((e) => e.kind === 'curve'))) {
    warnings.push(
      'Curved or freeform surfaces may need section views, profile tolerances or additional manufacturing dimensions.',
    );
  }
  if (
    views
      .filter((view) => view.id !== 'iso')
      .reduce((sum, view) => sum + view.edges.filter((edge) => edge.kind === 'curve').length, 0) >
    120
  ) {
    warnings.push(
      'Dense modeled curves are retained. Thread or profile specifications need a verified callout; individual projected fragments do not define manufacturing intent.',
    );
  }
  return {
    id: `${sourceName}-${index}-${crypto.randomUUID()}`,
    name,
    sourceName,
    path,
    unit: 'mm',
    bounds,
    views,
    features: { circles: sourceCircles },
    warnings,
  };
}

/** STEP transfer normalizes all source length units to millimetres. */
export async function importStep(
  buffer: ArrayBuffer,
  sourceName: string,
  progress: CadProgress = () => {},
): Promise<ImportResult> {
  const oc = getOC();
  const file = `/techdraw-${crypto.randomUUID()}.step`;
  const reader = new oc.STEPControl_Reader();
  const warnings = ['STEP PMI, material, tolerances and manufacturing intent are not imported.'];
  let imported: AnyShape | undefined;
  let parts: AnyShape[] = [];
  try {
    progress(`Reading ${sourceName}`);
    oc.FS.writeFile(file, new Uint8Array(buffer));
    const status = reader.ReadFile(file);
    if (status !== oc.IFSelect_ReturnStatus.IFSelect_RetDone)
      throw new Error(
        'The file is not a readable STEP model. Export a valid AP203, AP214 or AP242 STEP file and try again.',
      );
    reader.SetSystemLengthUnit(1);
    const transferred = reader.TransferRoots();
    if (!transferred || !reader.NbShapes())
      throw new Error('The STEP file does not contain transferable geometric shapes.');
    imported = ownedShape(reader.OneShape());
    if (imported.isNull) throw new Error('The STEP file contains an empty shape.');
    parts = solidsOf(imported);
    if (!parts.length) {
      parts = [imported.clone()];
      warnings.push(
        'No closed solid was found. The imported shell or surface model is available for reference only.',
      );
    }
    if (parts.length > MAX_SOLIDS)
      throw new Error(
        `This file contains ${parts.length} solids. Export a selection with at most ${MAX_SOLIDS} solids.`,
      );
    progress('Resolving assembly products');
    const products = readStepProducts(new TextDecoder().decode(buffer));
    const productSolids: { product: StepProduct; solids: AnyShape[] }[] = [];
    const stepModel = reader.StepModel();
    try {
      const wanted = new Map(products.map((product) => [product.definitionId, product]));
      for (let rank = 1; rank <= stepModel.NbEntities() && wanted.size; rank++) {
        const entity = stepModel.Entity(rank);
        try {
          const product = wanted.get(stepModel.IdentLabel(entity));
          if (!product) continue;
          wanted.delete(product.definitionId);
          const countBefore = reader.NbShapes();
          if (!reader.TransferEntity(entity) || reader.NbShapes() <= countBefore) continue;
          const transferred = ownedShape(reader.Shape(reader.NbShapes()));
          try {
            productSolids.push({ product, solids: solidsOf(transferred) });
          } finally {
            transferred.delete();
          }
        } finally {
          entity.delete();
        }
      }
    } finally {
      stepModel.delete();
    }
    const results: Part[] = [];
    try {
      let unmatched = 0,
        ambiguous = false;
      const matches = parts.map((part) =>
        productSolids.find((entry) =>
          entry.solids.some((solid) => solid.wrapped.IsPartner(part.wrapped)),
        ),
      );
      const occurrence = new Map<number, number>();
      for (let i = 0; i < parts.length; i++) {
        const match = matches[i];
        let name = stepPartDisplayName(match?.product.name, sourceName, parts.length, i);
        let productPath = match?.product.paths[0] || [name];
        if (match && match.product.paths.length > 1) {
          const shared: string[] = [];
          for (let index = 0; index < productPath.length; index++) {
            if (!match.product.paths.every((path) => path[index] === productPath[index])) break;
            shared.push(productPath[index]);
          }
          productPath = [...shared, match.product.name];
        }
        if (match && name !== match.product.name) productPath = [...productPath.slice(0, -1), name];
        if (
          match &&
          matches.filter((other) => other?.product.definitionId === match.product.definitionId)
            .length > 1
        ) {
          const instance = (occurrence.get(match.product.definitionId) || 0) + 1;
          occurrence.set(match.product.definitionId, instance);
          name = `${name} · Instance ${instance}`;
          productPath = [...productPath, `Instance ${instance}`];
        }
        const path = [sourceName, ...productPath];
        if (!match) unmatched++;
        if (match && match.product.paths.length > 1) ambiguous = true;
        results.push(toPart(parts[i], i, sourceName, name, progress, path));
      }
      if (unmatched)
        warnings.push(
          `${unmatched} placed solid(s) could not be matched to product names; geometric solid labels are shown.`,
        );
      if (ambiguous)
        warnings.push(
          'A reused product appears in multiple assembly branches. Shared ancestry is shown; every placed solid remains independently selectable.',
        );
    } finally {
      productSolids.forEach((entry) => entry.solids.forEach((solid) => solid.delete()));
    }
    return { sourceName, parts: results, warnings };
  } finally {
    parts.forEach((shape) => shape.delete());
    imported?.delete();
    reader.delete();
    try {
      oc.FS.unlink(file);
    } catch {
      /* A failed reader may already have removed the file. */
    }
  }
}
