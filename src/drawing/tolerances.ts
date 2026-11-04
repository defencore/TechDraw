import type { DimensionTolerance } from '../model';

const MAX_MAGNITUDE = 1e6;
const DECIMAL = /^[+-]?(?:0|[1-9]\d*)(?:\.\d{1,9})?$/;
const FIT = /^[A-Za-z]{1,3}(?:01|[0-9]{1,2})(?:\/[A-Za-z]{1,3}(?:01|[0-9]{1,2}))?$/;

/** Stored decimal text preserves intentional precision and never uses exponent notation. */
export function parseToleranceNumber(text: unknown): number | undefined {
  if (typeof text !== 'string' || text.length > 32 || !DECIMAL.test(text)) return undefined;
  const value = Number(text);
  return Number.isFinite(value) && Math.abs(value) <= MAX_MAGNITUDE ? value : undefined;
}

/** Normalize a completed UI entry without dropping its fractional trailing zeros. */
export function normalizeToleranceNumber(text: string): string | undefined {
  const match = /^([+-]?)(\d*)(?:\.(\d+))?$/.exec(text.trim().replace(',', '.').replace('−', '-'));
  if (!match || (!match[2] && !match[3])) return undefined;
  const whole = (match[2] || '0').replace(/^0+(?=\d)/, '');
  const normalized = `${match[1]}${whole}${match[3] === undefined ? '' : `.${match[3]}`}`;
  return parseToleranceNumber(normalized) === undefined ? undefined : normalized;
}

const invalid = (message: string): never => {
  throw new Error(`Invalid dimension tolerance: ${message}`);
};
function decimal(value: unknown, label: string): { text: string; number: number } {
  const parsed = parseToleranceNumber(value);
  if (parsed === undefined)
    return invalid(
      `${label} must be decimal text with at most 9 decimal places and an absolute value no greater than 1000000.`,
    );
  return { text: value as string, number: parsed };
}

/** Parse a fresh whitelisted object; a fit designation never implies numeric limits. */
export function parseDimensionTolerance(value: unknown): DimensionTolerance {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return invalid('choose symmetric, upper/lower deviations, or a fit designation.');
  const input = value as Record<string, unknown>;
  if (input.kind === 'symmetric') {
    const magnitude = decimal(input.magnitude, 'Symmetric magnitude');
    if (magnitude.number < 0) return invalid('symmetric magnitude cannot be negative.');
    return { kind: 'symmetric', magnitude: magnitude.text.replace(/^[+-]/, '') };
  }
  if (input.kind === 'deviation') {
    const upper = decimal(input.upper, 'Upper deviation'),
      lower = decimal(input.lower, 'Lower deviation');
    if (upper.number < lower.number)
      return invalid('upper deviation must be greater than or equal to lower deviation.');
    return { kind: 'deviation', upper: upper.text, lower: lower.text };
  }
  if (input.kind === 'fit') {
    if (
      typeof input.designation !== 'string' ||
      input.designation.length > 24 ||
      !FIT.test(input.designation)
    )
      return invalid(
        'use an ASCII fit designation such as H7, h6, JS7 or H7/g6 (maximum 24 characters).',
      );
    return { kind: 'fit', designation: input.designation };
  }
  return invalid('the tolerance type is not supported.');
}

/** UI validation can keep a partially edited input outside committed drawing state. */
export function tryParseDimensionTolerance(value: unknown): DimensionTolerance | undefined {
  try {
    return parseDimensionTolerance(value);
  } catch {
    return undefined;
  }
}
