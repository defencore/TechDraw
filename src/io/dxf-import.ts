import type { Bounds2, ImportResult, Part, Point2, ProjectedEdge } from '../model';
import { MAX_SOURCE_BYTES } from './source-repository';

export type DxfUnit = 'mm' | 'cm' | 'm' | 'in' | 'ft';
export interface DxfImportOptions {
  unit?: DxfUnit;
}
interface Pair {
  code: number;
  value: string;
}
interface Entity {
  type: string;
  pairs: Pair[];
}
const units: Record<DxfUnit, number> = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 };
const unitCodes: Record<number, DxfUnit> = { 1: 'in', 2: 'ft', 4: 'mm', 5: 'cm', 6: 'm' };
const fail = (message: string): never => {
  throw new Error(`Cannot import DXF: ${message}`);
};

function readPairs(input: ArrayBuffer | Uint8Array): Pair[] {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (!bytes.length || bytes.length > MAX_SOURCE_BYTES)
    return fail('file is empty or exceeds 64 MB.');
  const prefix = new TextDecoder('ascii').decode(bytes.subarray(0, Math.min(bytes.length, 200000)));
  if (prefix.startsWith('AutoCAD Binary DXF'))
    return fail('binary DXF is unsupported. Export ASCII DXF.');
  const version = /\$ACADVER\s*\r?\n\s*1\s*\r?\n\s*AC(\d+)/.exec(prefix);
  const codepage = /\$DWGCODEPAGE\s*\r?\n\s*3\s*\r?\n\s*ANSI_(\d+)/.exec(prefix)?.[1];
  let text: string;
  try {
    text = new TextDecoder(
      version && Number(version[1]) >= 1021 ? 'utf-8' : codepage ? `windows-${codepage}` : 'utf-8',
      { fatal: true },
    ).decode(bytes);
  } catch {
    return fail('text encoding is unsupported or damaged. Export UTF-8 ASCII DXF.');
  }
  const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/);
  while (lines.at(-1) === '') lines.pop();
  if (lines.length % 2 || lines.length > 2000000)
    return fail('group-code/value pairs are malformed or too numerous.');
  const pairs: Pair[] = [];
  for (let index = 0; index < lines.length; index += 2) {
    if (!/^\s*\d+\s*$/.test(lines[index])) return fail(`invalid group code at line ${index + 1}.`);
    const code = Number(lines[index]);
    if (code > 1071) return fail('group code is outside the DXF range.');
    pairs.push({ code, value: lines[index + 1].trim() });
  }
  if (!pairs.some((pair) => pair.code === 0 && pair.value === 'EOF'))
    return fail('EOF marker is missing.');
  return pairs;
}
function sections(pairs: Pair[]): Map<string, Pair[]> {
  const result = new Map<string, Pair[]>();
  for (let index = 0; index < pairs.length; index++) {
    if (pairs[index].code !== 0 || pairs[index].value !== 'SECTION') continue;
    const name = pairs[++index];
    if (name?.code !== 2 || result.has(name.value))
      return fail('section header is missing or duplicated.');
    const body: Pair[] = [];
    while (++index < pairs.length && !(pairs[index].code === 0 && pairs[index].value === 'ENDSEC'))
      body.push(pairs[index]);
    if (index >= pairs.length) return fail('section is not terminated.');
    result.set(name.value, body);
  }
  if (!result.has('ENTITIES')) return fail('ENTITIES section is missing.');
  return result;
}
function entities(pairs: Pair[]): Entity[] {
  const result: Entity[] = [];
  for (const pair of pairs) {
    if (pair.code === 0) result.push({ type: pair.value, pairs: [] });
    else if (result.length) result[result.length - 1].pairs.push(pair);
    else return fail('entity group appears before an entity type.');
  }
  return result;
}
const value = (entity: Entity, code: number) =>
  entity.pairs.find((pair) => pair.code === code)?.value;
function number(entity: Entity, code: number, fallback?: number): number {
  const raw = value(entity, code);
  if (raw === undefined && fallback !== undefined) return fallback;
  if (
    raw === undefined ||
    !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw) ||
    !Number.isFinite(Number(raw))
  )
    return fail(`${entity.type} requires finite group ${code}.`);
  const result = Number(raw);
  if (Math.abs(result) > 1e12) return fail('geometry coordinate exceeds the supported range.');
  return result;
}
function unitInfo(header: Pair[]): { insunits: number; unit?: DxfUnit; unitless: boolean } {
  const index = header.findIndex((pair) => pair.code === 9 && pair.value === '$INSUNITS');
  if (index >= 0 && header[index + 1]?.code !== 70)
    return fail('$INSUNITS requires an integer group 70.');
  const code = index < 0 ? 0 : Number(header[index + 1]?.value);
  if (!Number.isInteger(code) || code < 0) return fail('$INSUNITS is invalid.');
  return {
    insunits: code,
    ...(unitCodes[code] ? { unit: unitCodes[code] } : {}),
    unitless: code === 0,
  };
}
export function inspectDxfUnits(input: ArrayBuffer | Uint8Array) {
  return unitInfo(sections(readPairs(input)).get('HEADER') ?? []);
}

function arcPoints(center: Point2, radius: number, start: number, delta: number): Point2[] {
  const step = 2 * Math.acos(Math.max(-1, 1 - 0.005 / radius));
  if (!(step > 0)) return fail('an arc exceeds the supported display precision.');
  const segments = Math.max(
    2,
    Math.ceil(Math.abs(delta) / Math.min(Math.PI / 8, step || Math.PI / 8)),
  );
  if (segments > 10000)
    return fail('an arc exceeds the supported 0.005 mm display sampling budget.');
  const angles = Array.from(
    { length: segments + 1 },
    (_, index) => start + (delta * index) / segments,
  );
  for (let index = -8; index <= 8; index++) {
    const angle = (index * Math.PI) / 2;
    const t = (angle - start) / delta;
    if (t > 0 && t < 1) angles.push(angle);
  }
  angles.sort((a, b) => (delta > 0 ? a - b : b - a));
  return angles.map((angle) => [
    center[0] + radius * Math.cos(angle),
    center[1] + radius * Math.sin(angle),
  ]);
}
function plainText(entity: Entity): string {
  return entity.pairs
    .filter((pair) => pair.code === 1 || pair.code === 3)
    .map((pair) => pair.value)
    .join('')
    .replace(/\\U\+([0-9a-f]{4})/gi, (_, code: string) => String.fromCharCode(parseInt(code, 16)))
    .replace(/\\P/g, '\n')
    .replace(/\\S([^;]*);/gi, (_, content: string) => content.replace(/[\^#]/g, '/'))
    .replace(/%%c/gi, 'Ø')
    .replace(/%%d/gi, '°')
    .replace(/%%p/gi, '±')
    .replace(/%%[uo]/gi, '')
    .replace(/\\~/g, ' ')
    .replace(/\\[ACFHQSTW][^;]*;/gi, '')
    .replace(/[{}]/g, '')
    .replace(/\\\\/g, '\\')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .slice(0, 10000);
}

/** Import supported planar model-space entities as one exact 2D drawing, never inferred 3D. */
export function importDxf(
  input: ArrayBuffer | Uint8Array,
  sourceName: string,
  options: DxfImportOptions = {},
): ImportResult {
  const data = sections(readPairs(input));
  const info = unitInfo(data.get('HEADER') ?? []);
  if (options.unit !== undefined && !Object.hasOwn(units, options.unit))
    return fail('requested source unit is unsupported.');
  if (!options.unit && !info.unit && !info.unitless)
    return fail(`$INSUNITS ${info.insunits} is unsupported. Choose a source unit explicitly.`);
  const unit = options.unit ?? info.unit ?? 'mm',
    factor = units[unit];
  const warnings = ['2D DXF: only the source plane is shown. No 3D projections are inferred.'];
  warnings.push(
    'DXF colors, line styles and text placement remain in the original source; imported geometry uses the drawing template.',
  );
  if (info.unitless && !options.unit)
    warnings.push(
      'DXF has no declared units. Millimetres were assumed; choose the source unit when importing if different.',
    );
  if (options.unit && options.unit !== info.unit)
    warnings.push(`DXF source units were explicitly set to ${unit}.`);
  const hiddenLayers = new Set(
    entities(data.get('TABLES') ?? [])
      .filter(
        (entity) =>
          entity.type === 'LAYER' &&
          ((number(entity, 70, 0) & 1) !== 0 || number(entity, 62, 7) < 0),
      )
      .map((entity) => value(entity, 2)),
  );
  const sourceNotes: string[] = [];
  const edges: ProjectedEdge[] = [];
  const circles: NonNullable<Part['features']>['circles'] = [];
  const anchors = new Map<
    string,
    { id: string; point: Point2; source: [number, number, number] }
  >();
  let elevation: number | undefined,
    skipped = 0,
    sampled = 0;
  const z = (coordinate: number) => {
    if (elevation === undefined) elevation = coordinate;
    else if (Math.abs(elevation - coordinate) > 1e-7)
      return fail('nonplanar or mixed-elevation geometry is unsupported. Export a planar 2D DXF.');
  };
  const anchor = (point: Point2) => {
    const key = point.map((coordinate) => coordinate.toPrecision(15)).join(',');
    if (!anchors.has(key))
      anchors.set(key, {
        id: `dxf-anchor-${anchors.size}`,
        point: [...point],
        source: [point[0], 0, point[1]],
      });
  };
  const add = (edge: ProjectedEdge) => {
    sampled += edge.points.length;
    if (edges.length >= 40000 || sampled > 2000000)
      return fail('geometry exceeds the browser drawing budget.');
    edges.push(edge);
    if (edge.closed !== true) {
      anchor(edge.points[0]);
      anchor(edge.points.at(-1)!);
    }
    if (edge.center && edge.radius) {
      anchor(edge.center);
      circles.push({
        id: edge.id,
        center: [edge.center[0], 0, edge.center[1]],
        normal: [0, 1, 0],
        radius: edge.radius,
        closed: edge.closed === true,
      });
    }
  };
  const line = (a: Point2, b: Point2) => {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length <= 1e-12) return fail('zero-length LINE/polyline segment is unsupported.');
    add({
      id: `dxf-edge-${edges.length}`,
      kind: 'line',
      hidden: false,
      points: [a, b],
      length,
      sourcePoints: [
        [a[0], 0, a[1]],
        [b[0], 0, b[1]],
      ],
    });
  };
  const arc = (
    center: Point2,
    radius: number,
    start: number,
    delta: number,
    closed = false,
    endpoints?: [Point2, Point2],
  ) => {
    if (!(radius > 0) || !Number.isFinite(radius) || Math.abs(delta) < 1e-12)
      return fail('circle/arc radius and sweep must be nonzero.');
    if (radius > 1e9 || center.some((coordinate) => Math.abs(coordinate) > 1e9))
      return fail('converted circle geometry exceeds the millimetre coordinate limit.');
    const points = arcPoints(center, radius, start, delta);
    if (endpoints) {
      points[0] = [...endpoints[0]];
      points[points.length - 1] = [...endpoints[1]];
    }
    add({
      id: `dxf-edge-${edges.length}`,
      kind: 'circle',
      hidden: false,
      closed,
      center,
      radius,
      length: radius * Math.abs(delta),
      points,
    });
  };
  const polyline = (vertices: { point: Point2; bulge: number }[], closed: boolean) => {
    if (vertices.length < 2) return fail('a polyline needs at least two vertices.');
    for (let index = 0; index < vertices.length - (closed ? 0 : 1); index++) {
      const a = vertices[index],
        b = vertices[(index + 1) % vertices.length];
      if (!a.bulge) {
        line(a.point, b.point);
        continue;
      }
      const dx = b.point[0] - a.point[0],
        dy = b.point[1] - a.point[1],
        chord = Math.hypot(dx, dy);
      if (chord < 1e-12) return fail('a bulged segment has coincident endpoints.');
      const distance = (chord * (1 - a.bulge * a.bulge)) / (4 * a.bulge);
      const center: Point2 = [
        (a.point[0] + b.point[0]) / 2 - (dy / chord) * distance,
        (a.point[1] + b.point[1]) / 2 + (dx / chord) * distance,
      ];
      arc(
        center,
        (chord * (1 + a.bulge * a.bulge)) / (4 * Math.abs(a.bulge)),
        Math.atan2(a.point[1] - center[1], a.point[0] - center[0]),
        4 * Math.atan(a.bulge),
        false,
        [a.point, b.point],
      );
    }
  };
  const inputEntities = entities(data.get('ENTITIES')!);
  if (inputEntities.length > 100000) return fail('too many DXF entities.');
  for (let index = 0; index < inputEntities.length; index++) {
    const entity = inputEntities[index];
    if (
      number(entity, 67, 0) === 1 ||
      number(entity, 60, 0) === 1 ||
      hiddenLayers.has(value(entity, 8))
    ) {
      skipped++;
      if (entity.type === 'POLYLINE')
        while (index + 1 < inputEntities.length && inputEntities[++index].type !== 'SEQEND') {}
      continue;
    }
    if (!['LINE', 'LWPOLYLINE', 'POLYLINE', 'CIRCLE', 'ARC', 'TEXT', 'MTEXT'].includes(entity.type))
      return fail(
        `${entity.type} entities are unsupported. Explode blocks, splines, hatches and existing dimensions to supported 2D entities before importing.`,
      );
    if (
      number(entity, 210, 0) !== 0 ||
      number(entity, 220, 0) !== 0 ||
      number(entity, 230, 1) !== 1
    )
      return fail(
        'nonstandard extrusion directions are unsupported. Export geometry in the world XY plane.',
      );
    if (number(entity, 39, 0) !== 0)
      return fail('extruded entity thickness is unsupported. Export a flat 2D drawing.');
    if (entity.type === 'TEXT' || entity.type === 'MTEXT') {
      const text = plainText(entity);
      if (/[\uD800-\uDFFF\uFFFE\uFFFF]/u.test(text))
        return fail('source text contains invalid Unicode characters.');
      if (text) {
        if (sourceNotes.length >= 1000) return fail('text entities exceed the source-note budget.');
        sourceNotes.push(text);
      }
      continue;
    }
    if (entity.type === 'LINE') {
      z(number(entity, 30, 0));
      z(number(entity, 31, 0));
      line(
        [number(entity, 10) * factor, number(entity, 20) * factor],
        [number(entity, 11) * factor, number(entity, 21) * factor],
      );
    } else if (entity.type === 'CIRCLE' || entity.type === 'ARC') {
      z(number(entity, 30, 0));
      const rawStart = entity.type === 'CIRCLE' ? 0 : (number(entity, 50) * Math.PI) / 180;
      const start = ((rawStart % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      const end = entity.type === 'CIRCLE' ? Math.PI * 2 : (number(entity, 51) * Math.PI) / 180;
      const delta =
        entity.type === 'CIRCLE'
          ? Math.PI * 2
          : (((end - rawStart) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      arc(
        [number(entity, 10) * factor, number(entity, 20) * factor],
        number(entity, 40) * factor,
        start,
        delta,
        entity.type === 'CIRCLE',
      );
    } else {
      const flags = number(entity, 70, 0);
      if (!Number.isInteger(flags) || flags < 0)
        return fail('polyline flags must be nonnegative integers.');
      if (flags & (2 | 4 | 8 | 16 | 32 | 64))
        return fail('curve-fit, spline-fit and 3D/mesh polylines are unsupported.');
      if (entity.pairs.some((pair) => [40, 41, 43].includes(pair.code) && Number(pair.value) !== 0))
        return fail('wide polylines are unsupported. Convert stroke widths to explicit outlines.');
      const vertices: { point: Point2; bulge: number }[] = [];
      if (entity.type === 'LWPOLYLINE') {
        z(number(entity, 38, 0));
        let current: Pair[] = [];
        const push = () => {
          if (!current.length) return;
          const vertex: Entity = { type: 'LWPOLYLINE vertex', pairs: current };
          vertices.push({
            point: [number(vertex, 10) * factor, number(vertex, 20) * factor],
            bulge: number(vertex, 42, 0),
          });
        };
        for (const pair of entity.pairs) {
          if (pair.code === 10) {
            push();
            current = [pair];
          } else if (current.length) current.push(pair);
        }
        push();
        if (number(entity, 90) !== vertices.length)
          return fail('LWPOLYLINE vertex count is inconsistent.');
      } else {
        z(number(entity, 30, 0));
        while (++index < inputEntities.length && inputEntities[index].type === 'VERTEX') {
          const vertex = inputEntities[index];
          if (number(vertex, 70, 0) || number(vertex, 40, 0) || number(vertex, 41, 0))
            return fail('fitted or wide POLYLINE vertices are unsupported.');
          // A 2D POLYLINE owns its elevation; its VERTEX Z values are not used.
          vertices.push({
            point: [number(vertex, 10) * factor, number(vertex, 20) * factor],
            bulge: number(vertex, 42, 0),
          });
        }
        if (inputEntities[index]?.type !== 'SEQEND') return fail('POLYLINE is missing SEQEND.');
      }
      polyline(vertices, (flags & 1) !== 0);
    }
  }
  if (!edges.length) return fail('no supported visible model-space geometry was found.');
  if (sourceNotes.length)
    warnings.push(
      `${sourceNotes.length} DXF text entities were preserved as source notes; their original formatting and placement remain in the original file.`,
    );
  if (skipped)
    warnings.push(`${skipped} paper-space, invisible or hidden-layer entities were omitted.`);
  if (elevation)
    warnings.push(
      `The planar source elevation ${elevation} was retained in the original file; the 2D drawing uses its XY coordinates.`,
    );
  const bounds: Bounds2 = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const edge of edges)
    for (const point of edge.points) {
      bounds.minX = Math.min(bounds.minX, point[0]);
      bounds.minY = Math.min(bounds.minY, point[1]);
      bounds.maxX = Math.max(bounds.maxX, point[0]);
      bounds.maxY = Math.max(bounds.maxY, point[1]);
    }
  if (Object.values(bounds).some((value) => !Number.isFinite(value) || Math.abs(value) > 1e9))
    return fail('converted geometry exceeds the millimetre coordinate limit.');
  const name = sourceName.replace(/\.dxf$/i, '');
  const part: Part = {
    id: crypto.randomUUID(),
    name,
    sourceName,
    sourceKind: 'dxf',
    sourceNotes,
    unit: 'mm',
    path: [sourceName, name],
    bounds: { min: [bounds.minX, 0, bounds.minY], max: [bounds.maxX, 0, bounds.maxY] },
    views: [
      {
        id: 'front',
        name: 'DXF source plane',
        bounds,
        edges,
        anchors: [...anchors.values()].filter(
          (anchor) =>
            anchor.point[0] >= bounds.minX &&
            anchor.point[0] <= bounds.maxX &&
            anchor.point[1] >= bounds.minY &&
            anchor.point[1] <= bounds.maxY,
        ),
      },
    ],
    warnings,
    features: { circles },
  };
  return { sourceName, parts: [part], warnings };
}
