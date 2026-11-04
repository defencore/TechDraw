export const DEFAULT_ANNOTATION_COLOR = '#e34d59';

export function annotationColor(value: unknown = DEFAULT_ANNOTATION_COLOR): string {
  if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value))
    throw new RangeError('Annotation color must be a six-digit hexadecimal color.');
  return value.toLowerCase();
}
