export function isGridSpacing(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0.1 && value <= 100;
}

/** Coordinates are always paper millimetres, independent of model scale and screen zoom. */
export function snapCoordinate(
  value: number,
  spacing: number,
  direction: 'nearest' | 'min' | 'max' = 'nearest',
): number {
  if (!Number.isFinite(value) || !isGridSpacing(spacing))
    throw new RangeError('Grid coordinates must be finite and spacing must be 0.1–100 mm.');
  const ratio = value / spacing;
  const nearest = Math.round(ratio);
  const integer =
    Math.abs(ratio - nearest) < 1e-10
      ? nearest
      : direction === 'min'
        ? Math.floor(ratio)
        : direction === 'max'
          ? Math.ceil(ratio)
          : nearest;
  // Remove binary rounding noise without limiting legitimate custom spacing precision.
  return Number((integer * spacing).toPrecision(14)) || 0;
}
