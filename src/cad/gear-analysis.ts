import { getOC, type AnyShape, type Face } from 'replicad';
import type { GearGeometry, Point3 } from '../model';

const LINEAR_TOLERANCE = 1e-5;
const ANGULAR_TOLERANCE = 1e-5;
const TAU = 2 * Math.PI;
type Axis = GearGeometry['axis'];
interface CylinderPatch {
  axis: Axis;
  radius: number;
  start: number;
  end: number;
  angle: number;
  angularSpan: number;
  internal: boolean;
  straight: boolean;
}
interface RadiusBand {
  radius: number;
  start: number;
  end: number;
  patches: CylinderPatch[];
}

const dot = (a: Point3, b: Point3) => a.reduce((sum, v, i) => sum + v * b[i], 0);
const subtract = (a: Point3, b: Point3): Point3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Point3, b: Point3): Point3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const multiply = (a: Point3, n: number): Point3 => [a[0] * n, a[1] * n, a[2] * n];
const cross = (a: Point3, b: Point3): Point3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const magnitude = (p: Point3) => Math.hypot(...p);
const near = (a: number, b: number) => Math.abs(a - b) <= LINEAR_TOLERANCE;
const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;

function tuple(point: { X(): number; Y(): number; Z(): number; delete(): void }): Point3 {
  try {
    return [point.X(), point.Y(), point.Z()];
  } finally {
    point.delete();
  }
}

function canonicalDirection(direction: Point3): Point3 {
  const length = magnitude(direction);
  const largest = direction.reduce(
    (best, v, i) => (Math.abs(v) > Math.abs(direction[best]) ? i : best),
    0,
  );
  return multiply(direction, (direction[largest] < 0 ? -1 : 1) / length);
}

function basis(direction: Point3): [Point3, Point3] {
  const seed: Point3 = Math.abs(direction[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0];
  const raw = cross(direction, seed);
  const u = multiply(raw, 1 / magnitude(raw));
  return [u, cross(direction, u)];
}

function sameAxis(a: Axis, b: Axis): boolean {
  return (
    Math.abs(dot(a.direction, b.direction)) >= 1 - 1e-9 &&
    magnitude(cross(subtract(a.origin, b.origin), a.direction)) <= LINEAR_TOLERANCE
  );
}

/** Rectangular cylindrical tips/roots support straight teeth, not a helical inference. */
function straightBoundary(face: Face, direction: Point3): boolean {
  const oc = getOC();
  const edges = face.edges;
  let lines = 0,
    circles = 0;
  try {
    for (const edge of edges) {
      const adaptor = new oc.BRepAdaptor_Curve(edge.wrapped);
      try {
        if (
          adaptor.GetType() === oc.GeomAbs_CurveType.GeomAbs_Line ||
          adaptor.GetType() === oc.GeomAbs_CurveType.GeomAbs_BSplineCurve
        ) {
          const a = tuple(adaptor.Value(adaptor.FirstParameter()));
          const b = tuple(adaptor.Value(adaptor.LastParameter()));
          const delta = subtract(b, a),
            length = magnitude(delta);
          if (length <= LINEAR_TOLERANCE || magnitude(cross(delta, direction)) > length * 1e-8)
            return false;
          if (adaptor.GetType() === oc.GeomAbs_CurveType.GeomAbs_BSplineCurve) {
            const spline = adaptor.BSpline();
            try {
              // Collinear control poles prove a straight geometric curve even when
              // an exporter encodes an extrusion boundary as a B-spline.
              for (let i = 1; i <= spline.NbPoles(); i++)
                if (
                  magnitude(cross(subtract(tuple(spline.Pole(i)), a), direction)) > LINEAR_TOLERANCE
                )
                  return false;
            } finally {
              spline.delete();
            }
          }
          lines++;
        } else if (adaptor.GetType() === oc.GeomAbs_CurveType.GeomAbs_Circle) {
          const circle = adaptor.Circle(),
            axis = circle.Axis();
          try {
            if (Math.abs(dot(tuple(axis.Direction()), direction)) < 1 - 1e-9) return false;
          } finally {
            axis.delete();
            circle.delete();
          }
          circles++;
        } else return false;
      } finally {
        adaptor.delete();
      }
    }
    return lines === 2 && circles === 2;
  } finally {
    edges.forEach((edge) => edge.delete());
  }
}

function cylinderPatch(face: Face): CylinderPatch | undefined {
  const oc = getOC();
  const surface = new oc.BRepAdaptor_Surface(face.wrapped, true);
  try {
    if (surface.GetType() !== oc.GeomAbs_SurfaceType.GeomAbs_Cylinder) return;
    const cylinder = surface.Cylinder(),
      rawAxis = cylinder.Axis();
    try {
      const direction = canonicalDirection(tuple(rawAxis.Direction()));
      const rawOrigin = tuple(rawAxis.Location());
      const origin = subtract(rawOrigin, multiply(direction, dot(rawOrigin, direction)));
      const u0 = surface.FirstUParameter(),
        u1 = surface.LastUParameter();
      const v0 = surface.FirstVParameter(),
        v1 = surface.LastVParameter();
      if (![u0, u1, v0, v1].every(Number.isFinite)) return;
      const a = tuple(surface.Value((u0 + u1) / 2, v0));
      const b = tuple(surface.Value((u0 + u1) / 2, v1));
      const [u, v] = basis(direction);
      const radial = subtract(a, origin);
      const start = Math.min(dot(a, direction), dot(b, direction));
      const end = Math.max(dot(a, direction), dot(b, direction));
      return {
        axis: { origin, direction },
        radius: cylinder.Radius(),
        start,
        end,
        angle: (Math.atan2(dot(radial, v), dot(radial, u)) + TAU) % TAU,
        angularSpan: Math.abs(u1 - u0),
        internal:
          (face.wrapped.Orientation() === oc.TopAbs_Orientation.TopAbs_REVERSED) !==
          !cylinder.Direct(),
        straight: straightBoundary(face, direction),
      };
    } finally {
      rawAxis.delete();
      cylinder.delete();
    }
  } finally {
    surface.delete();
  }
}

function repeatedBand(band: RadiusBand): boolean {
  const count = band.patches.length;
  if (count < 6 || count > 400 || band.end - band.start <= LINEAR_TOLERANCE) return false;
  const expected = TAU / count;
  const angles = band.patches.map((patch) => patch.angle).sort((a, b) => a - b);
  return (
    band.patches.every((patch) => patch.angularSpan < expected - ANGULAR_TOLERANCE) &&
    angles.every(
      (angle, i) =>
        Math.abs(((angles[(i + 1) % count] - angle + TAU) % TAU) - expected) < ANGULAR_TOLERANCE,
    )
  );
}

function radialBands(patches: CylinderPatch[]): RadiusBand[] {
  const bands: RadiusBand[] = [];
  for (const patch of patches.filter((item) => !item.internal && item.straight)) {
    let band = bands.find(
      (item) =>
        near(item.radius, patch.radius) &&
        near(item.start, patch.start) &&
        near(item.end, patch.end),
    );
    if (!band) {
      band = { radius: patch.radius, start: patch.start, end: patch.end, patches: [] };
      bands.push(band);
    }
    band.patches.push(patch);
  }
  return bands.filter(repeatedBand);
}

/** Pick an actual tip-arc midpoint as an explicit, reproducible tooth datum. */
function toothDatum(tip: RadiusBand, direction: Point3): Point3 {
  const least = direction.reduce(
    (best, value, i) => (Math.abs(value) < Math.abs(direction[best]) ? i : best),
    0,
  );
  const seed: Point3 = [0, 0, 0];
  seed[least] = 1;
  const radial = subtract(seed, multiply(direction, dot(seed, direction)));
  const target = multiply(radial, 1 / magnitude(radial));
  const tangent = cross(direction, target);
  const [u, v] = basis(direction);
  const candidates = tip.patches.map((patch) => {
    const point = add(multiply(u, Math.cos(patch.angle)), multiply(v, Math.sin(patch.angle)));
    return { point, angle: Math.atan2(dot(point, tangent), dot(point, target)) };
  });
  candidates.sort((a, b) =>
    Math.abs(Math.abs(a.angle) - Math.abs(b.angle)) > 1e-7
      ? Math.abs(a.angle) - Math.abs(b.angle)
      : b.angle - a.angle,
  );
  return candidates[0].point;
}

/** Rotation of a clone obtains a kernel bounding box along an arbitrary gear axis. */
function axialBounds(shape: AnyShape, direction: Point3): [number, number] {
  let copy = shape.clone();
  try {
    const target: Point3 = [0, 0, 1];
    const rotationAxis = cross(direction, target);
    if (magnitude(rotationAxis) > 1e-12)
      copy = copy.rotate(
        (Math.acos(Math.max(-1, Math.min(1, direction[2]))) * 180) / Math.PI,
        [0, 0, 0],
        rotationAxis,
      );
    else if (direction[2] < 0) copy = copy.rotate(180, [0, 0, 0], [1, 0, 0]);
    const box = copy.boundingBox;
    try {
      return [box.bounds[0][2], box.bounds[1][2]];
    } finally {
      box.delete();
    }
  } finally {
    copy.delete();
  }
}

function pinHoles(patches: CylinderPatch[], gearAxis: Axis): NonNullable<GearGeometry['pinHoles']> {
  const result: NonNullable<GearGeometry['pinHoles']> = [];
  for (const patch of patches.filter(
    (item) => item.internal && Math.abs(dot(item.axis.direction, gearAxis.direction)) < 1e-8,
  )) {
    if (
      result.some(
        (item) => near(item.diameter, patch.radius * 2) && sameAxis(item.axis, patch.axis),
      )
    )
      continue;
    const delta = subtract(gearAxis.origin, patch.axis.origin);
    const point = add(
      patch.axis.origin,
      multiply(patch.axis.direction, dot(delta, patch.axis.direction)),
    );
    if (magnitude(cross(subtract(point, gearAxis.origin), gearAxis.direction)) > LINEAR_TOLERANCE)
      continue;
    const coaxial = patches.filter(
      (item) => item.internal && near(item.radius, patch.radius) && sameAxis(item.axis, patch.axis),
    );
    const station = dot(point, patch.axis.direction);
    if (
      Math.min(...coaxial.map((item) => item.start)) >= station - LINEAR_TOLERANCE ||
      Math.max(...coaxial.map((item) => item.end)) <= station + LINEAR_TOLERANCE
    )
      continue;
    result.push({
      diameter: patch.radius * 2,
      axis: { origin: point, direction: patch.axis.direction },
    });
  }
  return result;
}

/** A blind pilot or counterbore must not be reported as a complete shaft bore. */
function throughBore(
  patches: CylinderPatch[],
  maximumRadius: number,
  range: [number, number],
): number | undefined {
  const candidates = patches
    .filter((patch) => patch.internal && patch.radius < maximumRadius)
    .sort((a, b) => a.radius - b.radius);
  for (const candidate of candidates) {
    const intervals = candidates
      .filter((patch) => near(patch.radius, candidate.radius))
      .sort((a, b) => a.start - b.start);
    let covered = range[0];
    for (const interval of intervals) {
      if (interval.start > covered + LINEAR_TOLERANCE) break;
      covered = Math.max(covered, interval.end);
    }
    if (covered >= range[1] - LINEAR_TOLERANCE) return candidate.radius * 2;
  }
  return;
}

/** Detect a bounded geometric candidate; no module, pressure angle or fit is invented. */
export function analyzeGearShape(shape: AnyShape): GearGeometry | undefined {
  const faces = shape.faces;
  try {
    const patches = faces
      .map(cylinderPatch)
      .filter((patch): patch is CylinderPatch => Boolean(patch));
    const families: CylinderPatch[][] = [];
    for (const patch of patches) {
      const family = families.find((items) => sameAxis(items[0].axis, patch.axis));
      if (family) family.push(patch);
      else families.push([patch]);
    }
    for (const family of families.sort((a, b) => b.length - a.length)) {
      const bands = radialBands(family).sort((a, b) => b.radius - a.radius);
      for (const tip of bands) {
        const root = bands.find(
          (band) =>
            band.radius < tip.radius - LINEAR_TOLERANCE &&
            band.radius > tip.radius * 0.25 &&
            band.patches.length === tip.patches.length &&
            near(band.start, tip.start) &&
            near(band.end, tip.end),
        );
        if (!root) continue;
        const count = tip.patches.length,
          step = TAU / count;
        const phase = (tip.patches[0].angle - root.patches[0].angle + TAU) % step;
        if (Math.abs(phase - step / 2) > ANGULAR_TOLERANCE) continue;
        const direction = family[0].axis.direction;
        const origin = add(
          family[0].axis.origin,
          multiply(direction, mean(tip.patches.map((p) => (p.start + p.end) / 2))),
        );
        const axis = { origin, direction };
        const range = axialBounds(shape, direction);
        const geometry: GearGeometry = {
          axis,
          toothCount: count,
          outsideDiameter: mean(tip.patches.map((p) => p.radius)) * 2,
          rootDiameter: mean(root.patches.map((p) => p.radius)) * 2,
          faceWidth: mean(tip.patches.map((p) => p.end - p.start)),
          overallLength: range[1] - range[0],
          profile: 'unverified',
          evidence: 'repeated-tip-root-arcs',
          toothDatumDirection: toothDatum(tip, direction),
        };
        const bore = throughBore(family, root.radius, range);
        if (bore !== undefined) geometry.boreDiameter = bore;
        const hub = family
          .filter(
            (p) =>
              !p.internal &&
              p.radius < root.radius &&
              p.angularSpan > TAU - 1e-6 &&
              (p.start < tip.start - LINEAR_TOLERANCE || p.end > tip.end + LINEAR_TOLERANCE),
          )
          .sort((a, b) => b.radius - a.radius)[0];
        if (hub) geometry.hubDiameter = hub.radius * 2;
        const pins = pinHoles(patches, axis);
        if (pins.length) geometry.pinHoles = pins;
        return geometry;
      }
    }
    return;
  } finally {
    faces.forEach((face) => face.delete());
  }
}
