import type { GearGeometry, GearSpecification, Part, Point3 } from '../model';

const fields = [
  'type',
  'teeth',
  'normalModule',
  'normalPressureAngle',
  'profileShift',
  'helixAngle',
  'helixHand',
  'profileReference',
  'accuracy',
  'inspection',
  'toothSurfaceFinish',
  'heatTreatment',
  'toothEdge',
] as const;
const textFields = [
  'profileReference',
  'accuracy',
  'inspection',
  'toothSurfaceFinish',
  'heatTreatment',
  'toothEdge',
] as const;
const fail = (label: string): never => {
  throw new Error(`Invalid gear data: ${label}`);
};
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return fail('expected an object.');
  return value as Record<string, unknown>;
}
function number(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    return fail(`${label} is outside the supported range.`);
  return value;
}
function teeth(value: unknown): number {
  const result = number(value, 'tooth count', 2, 2000);
  if (!Number.isInteger(result)) return fail('tooth count must be an integer.');
  return result;
}

/** JSON, UI and history use the same bounded, explicit normal-system specification. */
export function parseGearSpecification(value: unknown): GearSpecification {
  const raw = object(value);
  if (Object.keys(raw).some((key) => !fields.includes(key as (typeof fields)[number])))
    return fail('unknown specification field.');
  if (raw.type !== 'external-spur' && raw.type !== 'external-helical')
    return fail('choose an external spur or helical gear.');
  const result: GearSpecification = { type: raw.type };
  if (raw.teeth !== undefined) result.teeth = teeth(raw.teeth);
  if (raw.normalModule !== undefined)
    result.normalModule = number(raw.normalModule, 'normal module', 0.000001, 1000);
  if (raw.normalPressureAngle !== undefined)
    result.normalPressureAngle = number(
      raw.normalPressureAngle,
      'normal pressure angle',
      0.001,
      89.9,
    );
  if (raw.profileShift !== undefined)
    result.profileShift = number(raw.profileShift, 'profile shift', -20, 20);
  if (raw.helixAngle !== undefined)
    result.helixAngle = number(raw.helixAngle, 'helix angle', 0.001, 89.9);
  if (raw.helixHand !== undefined) {
    if (raw.helixHand !== 'left' && raw.helixHand !== 'right') return fail('invalid helix hand.');
    result.helixHand = raw.helixHand;
  }
  if (result.type === 'external-spur' && (result.helixAngle !== undefined || result.helixHand))
    return fail('spur gears do not have helical parameters.');
  for (const key of textFields) {
    const text = raw[key];
    if (text === undefined) continue;
    if (
      typeof text !== 'string' ||
      text.length > (key === 'inspection' ? 1000 : 400) ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\uD800-\uDFFF\uFFFE\uFFFF]/u.test(text)
    )
      return fail(`${key} must be bounded plain text.`);
    if (text.trim()) result[key] = text.trim();
  }
  return result;
}

export function gearReferenceDiameter(
  spec?: GearSpecification,
  measuredTeeth?: number,
): number | undefined {
  const count = spec?.teeth ?? measuredTeeth;
  if (spec?.teeth !== undefined && measuredTeeth !== undefined && spec.teeth !== measuredTeeth)
    return;
  if (!spec?.normalModule || !count) return;
  if (spec.type === 'external-spur') return spec.normalModule * count;
  if (spec.helixAngle === undefined) return;
  return (spec.normalModule * count) / Math.cos((spec.helixAngle * Math.PI) / 180);
}

/** Names are hints only and never populate approved manufacturing values implicitly. */
export function gearSourceHints(part: Pick<Part, 'name'>): {
  teeth?: number;
  normalModule?: number;
} {
  const count = /\b(\d{1,4})[ -]tooth\b/i.exec(part.name);
  const module = /\bmodule\s*(\d+(?:[.,]\d+)?)\b/i.exec(part.name);
  const output: { teeth?: number; normalModule?: number } = {};
  if (count && +count[1] >= 2 && +count[1] <= 2000) output.teeth = +count[1];
  if (module) {
    const value = Number(module[1].replace(',', '.'));
    if (value > 0 && value <= 1000) output.normalModule = value;
  }
  return output;
}

export function missingGearFields(part: Part, spec = part.gearSpecification): string[] {
  const missing: string[] = [];
  if (!spec) missing.push('Gear type');
  if (!(spec?.teeth ?? part.features?.gear?.toothCount)) missing.push('Tooth count');
  if (!spec?.normalModule) missing.push('Normal module');
  if (!spec?.normalPressureAngle) missing.push('Normal pressure angle');
  if (spec?.profileShift === undefined) missing.push('Profile shift');
  if (spec?.type === 'external-helical') {
    if (spec.helixAngle === undefined) missing.push('Helix angle');
    if (!spec.helixHand) missing.push('Helix hand');
  }
  for (const [key, label] of [
    ['profileReference', 'Basic rack / tooth profile'],
    ['accuracy', 'Accuracy and backlash'],
    ['inspection', 'Inspection dimensions'],
    ['toothSurfaceFinish', 'Tooth flank finish'],
    ['toothEdge', 'Tooth edge treatment'],
  ] as const)
    if (!spec?.[key]?.trim()) missing.push(label);
  return missing;
}

/** Measured STEP evidence is validated separately from editable engineering data. */
export function parseGearGeometry(value: unknown): GearGeometry {
  const raw = object(value);
  const vector = (value: unknown, direction: boolean): Point3 => {
    if (!Array.isArray(value) || value.length !== 3) return fail('invalid gear axis.');
    const p = value.map((v) => number(v, 'axis coordinate', -1e9, 1e9)) as Point3;
    if (direction && Math.abs(Math.hypot(...p) - 1) > 1e-6)
      return fail('gear axis must be unit length.');
    return p;
  };
  const axis = (value: unknown) => {
    const a = object(value);
    return { origin: vector(a.origin, false), direction: vector(a.direction, true) };
  };
  const positive = (value: unknown, label: string) => number(value, label, 1e-9, 1e9);
  if (raw.profile !== 'unverified' || raw.evidence !== 'repeated-tip-root-arcs')
    return fail('unsupported geometry evidence.');
  const result: GearGeometry = {
    axis: axis(raw.axis),
    toothCount: teeth(raw.toothCount),
    outsideDiameter: positive(raw.outsideDiameter, 'outside diameter'),
    rootDiameter: positive(raw.rootDiameter, 'root diameter'),
    faceWidth: positive(raw.faceWidth, 'face width'),
    overallLength: positive(raw.overallLength, 'overall length'),
    profile: 'unverified',
    evidence: 'repeated-tip-root-arcs',
  };
  if (raw.toothDatumDirection !== undefined) {
    result.toothDatumDirection = vector(raw.toothDatumDirection, true);
    const dot = result.toothDatumDirection.reduce(
      (sum, value, index) => sum + value * result.axis.direction[index],
      0,
    );
    if (Math.abs(dot) > 1e-6) return fail('tooth datum must be radial to the gear axis.');
  }
  if (
    result.rootDiameter >= result.outsideDiameter ||
    result.faceWidth > result.overallLength + 1e-6
  )
    return fail('inconsistent measured dimensions.');
  for (const key of ['boreDiameter', 'hubDiameter'] as const) {
    if (raw[key] !== undefined) result[key] = positive(raw[key], key);
    if (result[key] !== undefined && result[key]! >= result.outsideDiameter)
      return fail('bore or hub exceeds outside diameter.');
  }
  if (raw.pinHoles !== undefined) {
    if (!Array.isArray(raw.pinHoles) || raw.pinHoles.length > 100)
      return fail('too many pin holes.');
    result.pinHoles = raw.pinHoles.map((p) => {
      const hole = object(p);
      return { diameter: positive(hole.diameter, 'pin hole diameter'), axis: axis(hole.axis) };
    });
  }
  return result;
}
