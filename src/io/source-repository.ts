export type SourceKind = 'step' | 'dxf';
export interface ProjectSource {
  id: string;
  name: string;
  kind: SourceKind;
  bytes: Uint8Array;
}
export const MAX_SOURCE_BYTES = 64 * 1024 * 1024;

/** Validate source metadata and size without allocating another copy of its contents. */
export function inspectSource(
  source: ProjectSource,
): Omit<ProjectSource, 'bytes'> & { size: number } {
  if (typeof source.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(source.id))
    throw new Error('Source ID is invalid.');
  if (
    typeof source.name !== 'string' ||
    !source.name ||
    ['.', '..'].includes(source.name) ||
    source.name.length > 512 ||
    /[\\/\u0000-\u001f]/.test(source.name)
  )
    throw new Error('Source filename is invalid.');
  if (!['step', 'dxf'].includes(source.kind)) throw new Error('Source format is unsupported.');
  if (
    !(source.bytes instanceof Uint8Array) ||
    !source.bytes.length ||
    source.bytes.length > MAX_SOURCE_BYTES
  )
    throw new Error('An original source must contain 1 byte to 64 MB.');
  return { id: source.id, name: source.name, kind: source.kind, size: source.bytes.length };
}

export function validateSource(source: ProjectSource): ProjectSource {
  const metadata = inspectSource(source);
  return {
    id: metadata.id,
    name: metadata.name,
    kind: metadata.kind,
    bytes: new Uint8Array(source.bytes),
  };
}

/** Original bytes are copied before a CAD worker may transfer its input buffer. */
export class SourceRepository {
  private sources = new Map<string, ProjectSource>();
  add(input: {
    name: string;
    kind: SourceKind;
    bytes: ArrayBuffer | Uint8Array;
    id?: string;
  }): ProjectSource {
    const source = validateSource({
      id: input.id ?? crypto.randomUUID(),
      name: input.name,
      kind: input.kind,
      bytes: input.bytes instanceof Uint8Array ? input.bytes : new Uint8Array(input.bytes),
    });
    if (this.sources.has(source.id)) throw new Error('Source ID already exists.');
    this.sources.set(source.id, source);
    return validateSource(source);
  }
  get(id: string): ProjectSource | undefined {
    const source = this.sources.get(id);
    return source ? validateSource(source) : undefined;
  }
  all(): ProjectSource[] {
    return [...this.sources.values()].map(validateSource);
  }
  replace(sources: readonly ProjectSource[]): void {
    const next = new Map<string, ProjectSource>();
    for (const source of sources) {
      const copy = validateSource(source);
      if (next.has(copy.id)) throw new Error('Duplicate source ID.');
      next.set(copy.id, copy);
    }
    this.sources = next;
  }
  remove(id: string): void {
    this.sources.delete(id);
  }
  clear(): void {
    this.sources.clear();
  }
}
