/** Keep generated source identifiers available in metadata while showing the descriptive name. */
export function partDisplayLabel(name: string): string {
  const normalized = name.replace(/\s+/g, ' ').trim();
  return normalized.replace(/^PL3D\.[A-Z0-9_.]+-[A-F0-9]{8,64}\s+/i, '') || normalized;
}
