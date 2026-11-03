import type { Dimension, DimensionKind, Point2, Point3, ProjectedEdge, ViewId } from './model';

const norm2 = (a: Point2, b: Point2) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const finitePoint = (p: number[]) => p.length >= 2 && p.every(Number.isFinite);

function requireOrthographic(viewId: ViewId): void {
  if (!['front', 'top', 'right'].includes(viewId))
    throw new Error('Add manufacturing dimensions in the front, top or right view.');
}

function requireTrueLength(
  viewId: ViewId,
  a: Point2,
  b: Point2,
  sourceA?: Point3,
  sourceB?: Point3,
  exactLength?: number,
): void {
  const shown = norm2(a, b);
  if (sourceA && sourceB && finitePoint(sourceA) && finitePoint(sourceB)) {
    const normalAxis = viewId === 'front' ? 1 : viewId === 'top' ? 2 : 0;
    const actual = Math.hypot(...sourceA.map((value, axis) => sourceB[axis] - value));
    const tolerance = Math.max(1e-6, actual * 1e-8);
    if (
      Math.abs(sourceA[normalAxis] - sourceB[normalAxis]) > tolerance ||
      Math.abs(actual - shown) > tolerance
    ) {
      throw new Error(
        'This geometry is foreshortened in this view. Choose a view parallel to the measured geometry, or use horizontal / vertical dimensions.',
      );
    }
    return;
  }
  if (
    exactLength !== undefined &&
    Number.isFinite(exactLength) &&
    Math.abs(exactLength - shown) < Math.max(1e-6, exactLength * 1e-8)
  )
    return;
  throw new Error(
    'The true length of this projected edge cannot be verified. Use exact snap points in a suitable view, or add a horizontal / vertical dimension.',
  );
}

/** Horizontal/vertical dimensions measure model axes; aligned ones require a true-length view. */
export function createLinearDimension(
  viewId: ViewId,
  a: Point2,
  b: Point2,
  kind: DimensionKind,
  sourceA?: Point3,
  sourceB?: Point3,
  exactLength?: number,
): Dimension {
  requireOrthographic(viewId);
  if (!finitePoint(a) || !finitePoint(b)) throw new Error('Choose two valid geometry points.');
  if (!['horizontal', 'vertical', 'aligned'].includes(kind))
    throw new Error('Choose a linear dimension tool.');
  const value =
    kind === 'horizontal'
      ? Math.abs(b[0] - a[0])
      : kind === 'vertical'
        ? Math.abs(b[1] - a[1])
        : norm2(a, b);
  if (value < 1e-7) throw new Error('These points have zero distance in the selected direction.');
  if (kind === 'aligned') requireTrueLength(viewId, a, b, sourceA, sourceB, exactLength);
  return {
    id: crypto.randomUUID(),
    viewId,
    kind,
    a: [...a],
    b: [...b],
    value,
    offset: 10,
    automatic: false,
  };
}

function linePoints(edge: ProjectedEdge): [Point2, Point2] {
  if (edge.kind !== 'line' || edge.points.length < 2) throw new Error('Choose two straight edges.');
  const a = edge.points[0],
    b = edge.points.at(-1)!;
  if (!finitePoint(a) || !finitePoint(b) || norm2(a, b) < 1e-7)
    throw new Error('Choose straight edges with nonzero length.');
  return [a, b];
}

/** Angle values are valid only when both line directions are unforeshortened. */
export function measureAngle(
  viewId: ViewId,
  first: ProjectedEdge,
  second: ProjectedEdge,
): Dimension {
  requireOrthographic(viewId);
  const [p, p2] = linePoints(first),
    [q, q2] = linePoints(second);
  requireTrueLength(
    viewId,
    p,
    p2,
    first.sourcePoints?.[0],
    first.sourcePoints?.at(-1),
    first.length,
  );
  requireTrueLength(
    viewId,
    q,
    q2,
    second.sourcePoints?.[0],
    second.sourcePoints?.at(-1),
    second.length,
  );
  const r: Point2 = [p2[0] - p[0], p2[1] - p[1]],
    s: Point2 = [q2[0] - q[0], q2[1] - q[1]];
  const cross = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(cross) <= Math.hypot(...r) * Math.hypot(...s) * 1e-10)
    throw new Error('These edges are parallel. Choose intersecting directions.');
  const t = ((q[0] - p[0]) * s[1] - (q[1] - p[1]) * s[0]) / cross;
  const vertex: Point2 = [p[0] + t * r[0], p[1] + t * r[1]];
  const far = (a: Point2, b: Point2) => (norm2(vertex, a) > norm2(vertex, b) ? a : b);
  const a = far(p, p2),
    b = far(q, q2);
  const av: Point2 = [a[0] - vertex[0], a[1] - vertex[1]],
    bv: Point2 = [b[0] - vertex[0], b[1] - vertex[1]];
  const cosine = (av[0] * bv[0] + av[1] * bv[1]) / (Math.hypot(...av) * Math.hypot(...bv));
  const value = (Math.acos(Math.min(1, Math.max(-1, cosine))) * 180) / Math.PI;
  return {
    id: crypto.randomUUID(),
    viewId,
    kind: 'angle',
    a: [...a],
    b: [...b],
    vertex,
    value,
    offset: 14,
    automatic: false,
  };
}
