import { titleBlockDefaults, titleBlockKeys } from './drawing/title-block-data';
import { parseDimensionTolerance } from './drawing/tolerances';
import type {
  Bounds2,
  Dimension,
  DrawingLayout,
  DrawingAnnotation,
  DrawingSettings,
  Part,
  Point2,
  Point3,
  ProjectedEdge,
  Projection,
  ViewId,
} from './model';
import type { WorkspaceState } from './state';

export interface ProjectData {
  parts: Part[];
  selected: string[];
  dimensions: Record<string, Dimension[]>;
  layouts: Record<string, DrawingLayout>;
  settings: DrawingSettings;
  annotations: Record<string, DrawingAnnotation[]>;
  description: string;
}

const VIEWS: ViewId[] = ['front', 'top', 'right', 'iso'];
const MAX_TEXT_BYTES = 100 * 1024 * 1024;
const MAX_COORDINATE = 1e9;
const invalid = (message: string): never => {
  throw new Error(`Invalid project: ${message}`);
};

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return invalid(`${label} must be an object.`);
  return value as Record<string, unknown>;
}
function array(value: unknown, max: number, label: string): unknown[] {
  if (!Array.isArray(value) || value.length > max)
    return invalid(`${label} is missing or exceeds the supported limit (${max}).`);
  return value;
}
function string(value: unknown, label: string, max = 1024): string {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value) ||
    /[\uD800-\uDFFF\uFFFE\uFFFF]/u.test(value)
  )
    return invalid(`${label} must be text of at most ${max} characters.`);
  return value;
}
function identifier(value: unknown, label: string): string {
  const result = string(value, label, 512);
  if (!result || ['__proto__', 'constructor', 'prototype'].includes(result))
    return invalid(`${label} is not a supported identifier.`);
  return result;
}
function numeric(value: unknown, label: string, max = MAX_COORDINATE): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > max)
    return invalid(`${label} must be a finite number within the supported range.`);
  return value;
}
function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') return invalid(`${label} must be true or false.`);
  return value;
}
function choice<T extends string>(value: unknown, options: readonly T[], label: string): T {
  if (typeof value !== 'string' || !options.includes(value as T))
    return invalid(`${label} is not supported.`);
  return value as T;
}
function point(value: unknown, size: 2, label: string): Point2;
function point(value: unknown, size: 3, label: string): Point3;
function point(value: unknown, size: 2 | 3, label: string): Point2 | Point3 {
  const values = array(value, size, label);
  if (values.length !== size) return invalid(`${label} must have exactly ${size} coordinates.`);
  return values.map((v, index) => numeric(v, `${label}[${index}]`)) as Point2 | Point3;
}
function bounds2(value: unknown): Bounds2 {
  const b = record(value, 'projection bounds');
  const output = {
    minX: numeric(b.minX, 'minX'),
    minY: numeric(b.minY, 'minY'),
    maxX: numeric(b.maxX, 'maxX'),
    maxY: numeric(b.maxY, 'maxY'),
  };
  if (
    output.minX > output.maxX ||
    output.minY > output.maxY ||
    output.maxX - output.minX + output.maxY - output.minY < 1e-9
  )
    return invalid('projection bounds are inverted or empty.');
  return output;
}
function within(point: Point2, bounds: Bounds2): boolean {
  const tolerance = Math.max(1e-4, ...Object.values(bounds).map((v) => Math.abs(v) * 1e-12));
  return (
    point[0] >= bounds.minX - tolerance &&
    point[0] <= bounds.maxX + tolerance &&
    point[1] >= bounds.minY - tolerance &&
    point[1] <= bounds.maxY + tolerance
  );
}
function uniqueId(id: string, seen: Set<string>, label: string): void {
  if (seen.has(id)) invalid(`duplicate ${label}.`);
  seen.add(id);
}

interface Budget {
  edges: number;
  points: number;
  anchors: number;
  dimensions: number;
}
function edge(value: unknown, bounds: Bounds2, budget: Budget): ProjectedEdge {
  const e = record(value, 'edge');
  if (++budget.edges > 200000) return invalid('the project has more than 200,000 edges.');
  const points = array(e.points, 10000, 'edge points').map((p) => point(p, 2, 'edge point'));
  if (points.length < 2 || (budget.points += points.length) > 2000000)
    return invalid('edge points are empty or exceed the 2,000,000 point project limit.');
  if (points.some((p) => !within(p, bounds)))
    return invalid('edge geometry lies outside its projection bounds.');
  const output: ProjectedEdge = {
    id: identifier(e.id, 'edge ID'),
    kind: choice(e.kind, ['line', 'circle', 'curve'], 'edge kind'),
    hidden: boolean(e.hidden, 'hidden edge flag'),
    points,
  };
  if (e.closed !== undefined) output.closed = boolean(e.closed, 'closed edge flag');
  if (e.role !== undefined) output.role = choice(e.role, ['hard', 'outline'] as const, 'edge role');
  if (e.center !== undefined) output.center = point(e.center, 2, 'circle center');
  if (e.radius !== undefined) {
    output.radius = numeric(e.radius, 'circle radius');
    if (output.radius <= 0) return invalid('circle radius must be positive.');
  }
  if (output.kind === 'circle' && (!output.center || !output.radius))
    return invalid('circular edges require an exact center and radius.');
  if (e.length !== undefined) {
    output.length = numeric(e.length, 'edge length');
    if (output.length < 0) return invalid('edge length cannot be negative.');
  }
  if (e.sourcePoints !== undefined) {
    output.sourcePoints = array(e.sourcePoints, 10000, 'source points').map((p) =>
      point(p, 3, 'source point'),
    );
    if ((budget.points += output.sourcePoints.length) > 2000000)
      return invalid('source points exceed the project limit.');
  }
  return output;
}
function projection(value: unknown, budget: Budget): Projection {
  const v = record(value, 'projection');
  const bounds = bounds2(v.bounds),
    seenEdges = new Set<string>();
  const edges = array(v.edges, 40000, 'projection edges').map((value) => {
    const parsed = edge(value, bounds, budget);
    uniqueId(parsed.id, seenEdges, 'edge ID');
    return parsed;
  });
  if (!edges.length) return invalid('each projection requires drawable geometry.');
  const output: Projection = {
    id: choice(v.id, VIEWS, 'projection ID'),
    name: string(v.name, 'projection name'),
    bounds,
    edges,
  };
  if (v.anchors !== undefined) {
    const seenAnchors = new Set<string>();
    output.anchors = array(v.anchors, 50000, 'snap points').map((value) => {
      if (++budget.anchors > 1000000) return invalid('snap points exceed the project limit.');
      const a = record(value, 'snap point'),
        id = identifier(a.id, 'snap point ID');
      uniqueId(id, seenAnchors, 'snap point ID');
      const p = point(a.point, 2, 'projected snap point');
      if (!within(p, bounds)) return invalid('a snap point lies outside its projection.');
      return { id, point: p, source: point(a.source, 3, 'source snap point') };
    });
  }
  return output;
}
function part(value: unknown, budget: Budget): Part {
  const p = record(value, 'part'),
    b = record(p.bounds, 'part bounds');
  const min = point(b.min, 3, 'part minimum'),
    max = point(b.max, 3, 'part maximum');
  if (min.some((v, i) => v > max[i]) || max.every((v, i) => v === min[i]))
    return invalid('part bounds are inverted or empty.');
  const seenViews = new Set<string>();
  const views = array(p.views, 4, 'projections').map((value) => {
    const parsed = projection(value, budget);
    uniqueId(parsed.id, seenViews, 'projection ID');
    return parsed;
  });
  const sourceKind =
    p.sourceKind === undefined
      ? undefined
      : choice(p.sourceKind, ['step', 'dxf'] as const, 'source format');
  if (sourceKind === 'dxf' ? views.length !== 1 || views[0].id !== 'front' : views.length !== 4)
    return invalid(
      'DXF parts require one front projection; STEP parts require front, top, right and isometric projections.',
    );
  const result: Part = {
    id: identifier(p.id, 'part ID'),
    name: string(p.name, 'part name'),
    sourceName: string(p.sourceName, 'source file name'),
    unit: choice(p.unit, ['mm'], 'model unit'),
    bounds: { min, max },
    views,
    path: array(p.path, 128, 'assembly path').map((v) => string(v, 'assembly path item')),
    warnings: array(p.warnings, 256, 'import notes').map((v) => string(v, 'import note', 4096)),
  };
  if (sourceKind !== undefined) result.sourceKind = sourceKind;
  if (p.sourceId !== undefined) result.sourceId = identifier(p.sourceId, 'source ID');
  if (p.sourceNotes !== undefined)
    result.sourceNotes = array(p.sourceNotes, 1000, 'source notes').map((value) =>
      string(value, 'source note', 10000),
    );
  if (p.features !== undefined) {
    const features = record(p.features, 'analytic features');
    const ids = new Set<string>();
    result.features = {
      circles: array(features.circles, 24000, 'analytic circles').map((value) => {
        budget.points += 2;
        if (budget.points > 2000000) return invalid('analytic features exceed the project limit.');
        const feature = record(value, 'analytic circle');
        const id = identifier(feature.id, 'analytic circle ID');
        uniqueId(id, ids, 'analytic circle ID');
        const normal = point(feature.normal, 3, 'circle axis');
        const radius = numeric(feature.radius, 'analytic circle radius');
        if (radius <= 0 || Math.abs(Math.hypot(...normal) - 1) > 1e-6)
          return invalid('analytic circles require a positive radius and unit axis.');
        return {
          id,
          center: point(feature.center, 3, 'analytic circle center'),
          normal,
          radius,
          closed: boolean(feature.closed, 'analytic circle closed flag'),
        };
      }),
    };
  }
  return result;
}
function dimension(value: unknown, budget: Budget): Dimension {
  const d = record(value, 'dimension');
  if (++budget.dimensions > 50000) return invalid('dimensions exceed the 50,000 project limit.');
  const output: Dimension = {
    id: identifier(d.id, 'dimension ID'),
    viewId: choice(d.viewId, ['front', 'top', 'right'], 'dimension projection'),
    kind: choice(
      d.kind,
      ['horizontal', 'vertical', 'aligned', 'diameter', 'radius', 'angle'],
      'dimension type',
    ),
    a: point(d.a, 2, 'first dimension point'),
    b: point(d.b, 2, 'second dimension point'),
    value: numeric(d.value, 'dimension value', 2 * MAX_COORDINATE),
    offset: numeric(d.offset, 'dimension offset', 10000),
    automatic: boolean(d.automatic, 'automatic dimension flag'),
  };
  if (d.vertex !== undefined) output.vertex = point(d.vertex, 2, 'angle vertex');
  if (d.textOffset !== undefined) output.textOffset = point(d.textOffset, 2, 'label offset');
  if (d.prefix !== undefined) output.prefix = string(d.prefix, 'dimension prefix', 1000);
  if (d.suffix !== undefined) output.suffix = string(d.suffix, 'dimension suffix', 1000);
  if (d.tolerance !== undefined) {
    try {
      output.tolerance = parseDimensionTolerance(d.tolerance);
    } catch (error) {
      return invalid(error instanceof Error ? error.message : 'invalid dimension tolerance.');
    }
    if (output.kind === 'angle' && output.tolerance.kind === 'fit')
      return invalid('fit designations are not valid for angular dimensions.');
  }
  let expected: number;
  const dx = output.b[0] - output.a[0],
    dy = output.b[1] - output.a[1];
  if (output.kind === 'horizontal') expected = Math.abs(dx);
  else if (output.kind === 'vertical') expected = Math.abs(dy);
  else if (output.kind === 'angle') {
    if (!output.vertex) return invalid('angle dimensions require a vertex.');
    const a = [output.a[0] - output.vertex[0], output.a[1] - output.vertex[1]],
      b = [output.b[0] - output.vertex[0], output.b[1] - output.vertex[1]];
    const denominator = Math.hypot(...a) * Math.hypot(...b);
    if (denominator < 1e-14) return invalid('angle rays must have non-zero length.');
    expected =
      (Math.acos(Math.min(1, Math.max(-1, (a[0] * b[0] + a[1] * b[1]) / denominator))) * 180) /
      Math.PI;
  } else expected = Math.hypot(dx, dy) * (output.kind === 'diameter' ? 2 : 1);
  if (output.value <= 0 || Math.abs(output.value - expected) > Math.max(1e-6, expected * 1e-8))
    return invalid('a dimension value disagrees with its measurement geometry.');
  return output;
}
function settings(value: unknown): DrawingSettings {
  const s = record(value, 'sheet settings');
  const scale = s.scale === 'auto' ? 'auto' : numeric(s.scale, 'drawing scale', 1000);
  if (scale !== 'auto' && scale <= 0) return invalid('drawing scale must be positive.');
  const precision = numeric(s.precision, 'decimal places', 6);
  if (!Number.isInteger(precision) || precision < 0)
    return invalid('decimal places must be an integer from 0 to 6.');
  return {
    ...(Object.fromEntries(
      titleBlockKeys.map((key) => [
        key,
        s[key] === undefined
          ? titleBlockDefaults[key]
          : string(s[key], key, key === 'notes' ? 10000 : 1024),
      ]),
    ) as typeof titleBlockDefaults),
    format: choice(s.format, ['A4', 'A3', 'A2', 'A1'], 'paper format'),
    orientation: choice(s.orientation, ['portrait', 'landscape'], 'paper orientation'),
    template: choice(s.template, ['eskd', 'eskd-uk', 'iso', 'minimal'], 'drawing template'),
    scale,
    precision,
    hiddenLines: boolean(s.hiddenLines, 'hidden line setting'),
    centerLines: boolean(s.centerLines, 'center line setting'),
    title: string(s.title, 'drawing title'),
    number: string(s.number, 'drawing number'),
    material: string(s.material, 'material'),
    author: string(s.author, 'author'),
    revision: string(s.revision, 'revision'),
    tolerance: string(s.tolerance, 'general tolerance'),
    notes: string(s.notes, 'technical notes', 10000),
  };
}

function annotation(value: unknown, budget: Budget): DrawingAnnotation {
  const data = record(value, 'annotation');
  const kind = choice(
    data.kind,
    ['text', 'arrow', 'rectangle', 'ellipse', 'freehand'] as const,
    'annotation kind',
  );
  const points = array(data.points, 20000, 'annotation points').map((value) =>
    point(value, 2, 'annotation point'),
  );
  budget.points += points.length;
  if (budget.points > 2000000)
    return invalid('annotation geometry exceeds the project point limit.');
  if (points.some((point) => point.some((coordinate) => Math.abs(coordinate) > 10000)))
    return invalid('annotation points exceed the supported sheet coordinates.');
  if (
    kind === 'text'
      ? points.length !== 1
      : kind === 'freehand'
        ? points.length < 2
        : points.length !== 2
  )
    return invalid('annotation point count does not match its kind.');
  const strokeWidth = numeric(data.strokeWidth, 'annotation stroke width', 10);
  if (strokeWidth < 0.1) return invalid('annotation stroke width must be 0.1–10 mm.');
  const output: DrawingAnnotation = {
    id: identifier(data.id, 'annotation ID'),
    kind,
    points,
    strokeWidth,
  };
  if (data.text !== undefined) output.text = string(data.text, 'annotation text', 10000);
  if (kind === 'text' && !output.text?.trim())
    return invalid('text annotations require nonempty text.');
  if (data.fontSize !== undefined) {
    output.fontSize = numeric(data.fontSize, 'annotation font size', 100);
    if (output.fontSize < 1) return invalid('annotation font size must be 1–100 mm.');
  }
  if (
    kind !== 'text' &&
    points.every((point) => point[0] === points[0][0] && point[1] === points[0][1])
  )
    return invalid('annotation geometry must have a nonzero extent.');
  if (
    (kind === 'rectangle' || kind === 'ellipse') &&
    (Math.abs(points[1][0] - points[0][0]) < 0.1 || Math.abs(points[1][1] - points[0][1]) < 0.1)
  )
    return invalid(
      'rectangle and ellipse annotations require width and height of at least 0.1 mm.',
    );
  return output;
}

/** Persist sheet-space geometry so manual annotation edits never trigger an implicit reflow. */
function layout(value: unknown): DrawingLayout {
  const data = record(value, 'drawing layout');
  const scale = numeric(data.scale, 'layout scale', 1e6);
  if (scale <= 0) return invalid('layout scale must be positive.');
  const transforms = record(data.viewTransforms, 'view transforms');
  if (
    Object.keys(transforms).length !== VIEWS.length ||
    Object.keys(transforms).some((id) => !VIEWS.includes(id as ViewId))
  )
    return invalid('drawing layouts require exactly four supported view transforms.');
  const viewTransforms = {} as DrawingLayout['viewTransforms'];
  for (const viewId of VIEWS) {
    const transform = record(transforms[viewId], `${viewId} view transform`);
    const viewScale = numeric(transform.scale, 'view transform scale', 1e6);
    if (viewScale !== scale) return invalid('view transform scales must match the layout scale.');
    viewTransforms[viewId] = {
      x: numeric(transform.x, 'view transform x'),
      y: numeric(transform.y, 'view transform y'),
      scale,
    };
  }
  return { scale, viewTransforms };
}

/** Parse into fresh, whitelisted objects before any project content reaches the UI. */
export function parseProject(text: string): ProjectData {
  if (typeof text !== 'string' || text.length > MAX_TEXT_BYTES)
    return invalid('file exceeds the 100 MB limit.');
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    return invalid('file is not valid JSON.');
  }
  const data = record(input, 'file');
  if (data.version !== 1) return invalid('unsupported project version.');
  const budget: Budget = { edges: 0, points: 0, anchors: 0, dimensions: 0 },
    seenParts = new Set<string>();
  const parts = array(data.parts, 1000, 'parts').map((value) => {
    const parsed = part(value, budget);
    uniqueId(parsed.id, seenParts, 'part ID');
    return parsed;
  });
  if (!parts.length) return invalid('the project contains no parts.');
  const sourceDimensions = record(data.dimensions, 'dimensions');
  if (Object.keys(sourceDimensions).some((id) => !seenParts.has(id)))
    return invalid('dimensions refer to an unknown part.');
  const dimensions = Object.create(null) as Record<string, Dimension[]>;
  for (const p of parts) {
    if (!Object.hasOwn(sourceDimensions, p.id)) return invalid('part dimensions are missing.');
    const ids = new Set<string>();
    dimensions[p.id] = array(sourceDimensions[p.id], 5000, 'part dimensions').map((value) => {
      const parsed = dimension(value, budget);
      if (!p.views.some((view) => view.id === parsed.viewId))
        return invalid('a dimension refers to a missing projection.');
      uniqueId(parsed.id, ids, 'dimension ID');
      return parsed;
    });
  }
  const selected = array(data.selected, 1000, 'selected parts').map((v) =>
    identifier(v, 'selected part ID'),
  );
  if (new Set(selected).size !== selected.length || selected.some((id) => !seenParts.has(id)))
    return invalid('selected parts contain duplicate or unknown IDs.');
  const sourceLayouts = data.layouts === undefined ? {} : record(data.layouts, 'drawing layouts');
  const layouts = Object.create(null) as Record<string, DrawingLayout>;
  for (const [id, value] of Object.entries(sourceLayouts)) {
    if (!seenParts.has(id)) return invalid('drawing layouts refer to an unknown part.');
    layouts[id] = layout(value);
  }
  const sourceAnnotations =
    data.annotations === undefined ? {} : record(data.annotations, 'annotations');
  if (Object.keys(sourceAnnotations).some((id) => !seenParts.has(id)))
    return invalid('annotations refer to an unknown part.');
  const annotations = Object.create(null) as Record<string, DrawingAnnotation[]>;
  let annotationCount = 0;
  for (const p of parts) {
    const ids = new Set<string>();
    annotations[p.id] = array(sourceAnnotations[p.id] ?? [], 10000, 'part annotations').map(
      (value) => {
        if (++annotationCount > 100000) return invalid('annotations exceed the project limit.');
        const parsed = annotation(value, budget);
        uniqueId(parsed.id, ids, 'annotation ID');
        return parsed;
      },
    );
  }
  return {
    parts,
    dimensions,
    layouts,
    annotations,
    description:
      data.description === undefined ? '' : string(data.description, 'project description', 100000),
    selected,
    settings: settings(data.settings),
  };
}

export function serializeProject(
  state: WorkspaceState & {
    annotations?: Record<string, DrawingAnnotation[]>;
    description?: string;
  },
): string {
  const result = {
    version: 1,
    parts: state.parts,
    selected: [...state.selected],
    dimensions: state.dimensions,
    layouts: state.layouts,
    settings: state.settings,
    annotations: state.annotations ?? {},
    description: state.description ?? '',
  };
  // Saving and opening share one contract, so a saved workspace always reopens safely.
  const validated = parseProject(JSON.stringify(result));
  return JSON.stringify({ version: 1, ...validated });
}
