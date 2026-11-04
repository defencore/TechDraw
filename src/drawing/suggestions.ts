import type { Dimension, Part, Point2 } from '../model';
import { autoDimensions } from './dimensions';

const coordinate = (value: number) => Number(value.toPrecision(12));
const pointKey = (point: Point2) => point.map(coordinate).join(',');
const quantity = (dimension: Dimension) =>
  /^\s*\((\d+)x\)\s*$/.exec(dimension.suffix ?? '')?.[1] ?? '1';
const customSuffix = (dimension: Dimension) =>
  Boolean(dimension.suffix?.trim()) && !/^\s*\(\d+x\)\s*$/.test(dimension.suffix!);
const hasSpecification = (dimension: Dimension) =>
  Boolean(dimension.tolerance || dimension.prefix?.trim() || customSuffix(dimension));

/** Geometry, rather than generated IDs or array order, identifies a suggested measurement. */
function measurementKey(dimension: Dimension, groupedCircle = false): string {
  const prefix = `${dimension.viewId}:${dimension.kind}:${coordinate(dimension.value)}`;
  if (groupedCircle && dimension.kind === 'diameter')
    return `${prefix}:count-${quantity(dimension)}`;
  const points = [pointKey(dimension.a), pointKey(dimension.b)].sort();
  return `${prefix}:${points.join('|')}:${dimension.vertex ? pointKey(dimension.vertex) : ''}:count-${quantity(dimension)}`;
}

export interface RefreshedSuggestions {
  dimensions: Dimension[];
  preservedManual: number;
  preservedSpecifications: number;
}

/** Refresh suggestions without erasing explicitly authored measurements or specifications. */
export function mergeDimensionSuggestions(
  current: Dimension[],
  suggestions: Dimension[],
): RefreshedSuggestions {
  const knownIds = new Set(current.map((dimension) => dimension.id));
  const freshId = (dimension: Dimension) => {
    // A removed ordinal must never identify unrelated geometry on a later refresh.
    const base = `auto:${measurementKey(dimension, true)}`;
    let id = base;
    let serial = 2;
    while (knownIds.has(id)) id = `${base}:${serial++}`;
    knownIds.add(id);
    return id;
  };
  const manual = current.filter((dimension) => !dimension.automatic);
  const manualKeys = new Set(manual.map((dimension) => measurementKey(dimension)));
  const oldAutomatic = new Map<string, Dimension[]>();
  for (const dimension of current.filter((item) => item.automatic)) {
    const key = measurementKey(dimension, true);
    oldAutomatic.set(key, [...(oldAutomatic.get(key) ?? []), dimension]);
  }
  const consumed = new Set<string>();
  const updated: Dimension[] = [];
  let preservedSpecifications = 0;
  for (const suggestion of suggestions) {
    const exact = oldAutomatic
      .get(measurementKey(suggestion, true))
      ?.find((dimension) => !consumed.has(dimension.id));
    // Editing a grouped hole suffix can replace its generated quantity text.
    // The automatic generator emits one diameter group per view and nominal size.
    const sameCircleGroup =
      suggestion.kind === 'diameter'
        ? current.filter(
            (dimension) =>
              dimension.automatic &&
              dimension.kind === 'diameter' &&
              dimension.viewId === suggestion.viewId &&
              coordinate(dimension.value) === coordinate(suggestion.value) &&
              !consumed.has(dimension.id),
          )
        : [];
    const sameLockedRadius =
      suggestion.kind === 'radius'
        ? current.find(
            (dimension) =>
              dimension.locked &&
              (!dimension.automatic || !consumed.has(dimension.id)) &&
              dimension.kind === 'radius' &&
              dimension.viewId === suggestion.viewId &&
              coordinate(dimension.value) === coordinate(suggestion.value) &&
              pointKey(dimension.a) === pointKey(suggestion.a),
          )
        : undefined;
    const old =
      exact ??
      (sameCircleGroup.length === 1 ? sameCircleGroup[0] : undefined) ??
      (sameLockedRadius?.automatic ? sameLockedRadius : undefined);
    if (old?.locked) {
      consumed.add(old.id);
      updated.push(structuredClone(old));
      continue;
    }
    if (sameLockedRadius) continue;
    if (manualKeys.has(measurementKey(suggestion))) {
      if (old && !hasSpecification(old)) consumed.add(old.id);
      continue;
    }
    if (old) consumed.add(old.id);
    const next = structuredClone(suggestion);
    if (old) {
      next.id = old.id;
      if (old.tolerance) next.tolerance = structuredClone(old.tolerance);
      if (old.prefix !== undefined) next.prefix = old.prefix;
      if (old.suffix !== undefined) next.suffix = old.suffix;
      if (hasSpecification(old) || old.suffix !== suggestion.suffix) preservedSpecifications++;
    } else next.id = freshId(next);
    updated.push(next);
  }
  const protectedDimensions = current
    .filter(
      (dimension) =>
        dimension.automatic &&
        !consumed.has(dimension.id) &&
        (hasSpecification(dimension) || dimension.locked),
    )
    .map((dimension) =>
      dimension.locked
        ? structuredClone(dimension)
        : { ...structuredClone(dimension), automatic: false },
    );
  preservedSpecifications += protectedDimensions.length;
  const dimensions = [...structuredClone(manual), ...protectedDimensions];
  const reserved = new Set(dimensions.map((dimension) => dimension.id));
  for (const dimension of updated) {
    let id = dimension.id;
    if (reserved.has(id)) id = freshId(dimension);
    reserved.add(id);
    dimensions.push({ ...dimension, id });
  }
  return { dimensions, preservedManual: manual.length, preservedSpecifications };
}

export function refreshDimensionSuggestions(
  part: Part,
  current: Dimension[],
  detail: 'balanced' | 'full',
): RefreshedSuggestions {
  return mergeDimensionSuggestions(current, autoDimensions(part, detail));
}
