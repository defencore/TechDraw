import { strFromU8, strToU8, unzip, unzipSync, zip, type AsyncZippable } from 'fflate';
import { parseProject, serializeProject, type ProjectData } from '../project';
import type { WorkspaceState } from '../state';
import type { DrawingAnnotation } from '../model';
import {
  MAX_SOURCE_BYTES,
  validateSource,
  type ProjectSource,
  type SourceKind,
} from './source-repository';

const MAX_ARCHIVE = 128 * 1024 * 1024;
const MAX_TOTAL = 256 * 1024 * 1024;
const PROJECT_PATH = 'project.json';
const MANIFEST_PATH = 'manifest.json';
interface SourceEntry {
  id: string;
  name: string;
  kind: SourceKind;
  path: string;
  size: number;
  sha256: string;
  partIds: string[];
}
export interface MissingProjectSource {
  partId: string;
  sourceName: string;
  sourceId?: string;
}
interface Manifest {
  format: 'techdraw-project';
  version: 1;
  project: { path: typeof PROJECT_PATH; size: number; sha256: string };
  sources: SourceEntry[];
  missingSources: MissingProjectSource[];
}
export interface OpenedProjectArchive {
  project: ProjectData;
  sources: ProjectSource[];
  description: string;
  missingSources: MissingProjectSource[];
}
type ArchiveState = WorkspaceState & {
  annotations?: Record<string, DrawingAnnotation[]>;
  description?: string;
};
const fail = (message: string): never => {
  throw new Error(`Invalid project archive: ${message}`);
};
const hash = async (bytes: Uint8Array) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer))]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
const pathFor = (source: ProjectSource) =>
  `sources/${source.id}/${source.name.replace(/[^\p{L}\p{N}._-]/gu, '_')}`;
const missingSources = (project: ProjectData, sources: readonly ProjectSource[]) =>
  project.parts
    .filter((part) => !sources.some((source) => source.id === part.sourceId))
    .map((part) => ({
      partId: part.id,
      sourceName: part.sourceName,
      ...(part.sourceId ? { sourceId: part.sourceId } : {}),
    }));

/** One ZIP contains validated editable drawing data and byte-for-byte original CAD sources. */
export async function createProjectArchive(
  state: ArchiveState,
  originals: readonly ProjectSource[],
  options: { description?: string } = {},
): Promise<Uint8Array> {
  const text = serializeProject({
    ...state,
    description: options.description ?? state.description ?? '',
  });
  const project = parseProject(text);
  const ids = new Set<string>();
  const sources = originals
    .filter((source) => {
      if (ids.has(source.id)) throw new Error('Duplicate original source ID.');
      ids.add(source.id);
      return project.parts.some((part) => part.sourceId === source.id);
    })
    .map(validateSource);
  const projectBytes = strToU8(text);
  if (projectBytes.length > 100 * 1024 * 1024)
    throw new Error('Project drawing data exceeds 100 MB.');
  const files: AsyncZippable = Object.create(null);
  files[PROJECT_PATH] = projectBytes;
  const entries: SourceEntry[] = [];
  for (const source of sources) {
    const parts = project.parts.filter((part) => part.sourceId === source.id);
    if (
      parts.some(
        (part) => part.sourceName !== source.name || (part.sourceKind ?? 'step') !== source.kind,
      )
    )
      throw new Error('An original source does not match its linked parts.');
    const path = pathFor(source);
    files[path] = source.bytes;
    entries.push({
      id: source.id,
      name: source.name,
      kind: source.kind,
      path,
      size: source.bytes.length,
      sha256: await hash(source.bytes),
      partIds: parts.map((part) => part.id),
    });
  }
  const missing = missingSources(project, sources);
  const manifest: Manifest = {
    format: 'techdraw-project',
    version: 1,
    project: { path: PROJECT_PATH, size: projectBytes.length, sha256: await hash(projectBytes) },
    sources: entries,
    missingSources: missing,
  };
  const manifestBytes = strToU8(JSON.stringify(manifest, null, 2));
  if (manifestBytes.length > 8 * 1024 * 1024)
    throw new Error('Project source metadata exceeds 8 MB.');
  files[MANIFEST_PATH] = manifestBytes;
  files['README.txt'] = strToU8(
    `TechDraw local project\n\n${project.settings.title || project.parts[0].name}\n\n${project.description || project.settings.notes}\n\nParts: ${project.parts.length}\nOriginal source files: ${sources.length}\nMissing originals: ${missing.length}\n\nproject.json contains dimensions, tolerances, annotations, title block and fixed sheet layouts.\nOriginal files in sources/ are preserved without modification.\nMissing original files cannot be reconstructed from projected drawing data.\n`,
  );
  const total =
    projectBytes.length +
    manifestBytes.length +
    (files['README.txt'] as Uint8Array).length +
    sources.reduce((sum, source) => sum + source.bytes.length, 0);
  if (total > MAX_TOTAL || entries.length > 1000)
    throw new Error('The project exceeds the 256 MB archive content limit.');
  const archive = await new Promise<Uint8Array>((resolve, reject) =>
    zip(files, { level: 6, mtime: new Date('1980-01-01T00:00:00Z') }, (error, bytes) =>
      error ? reject(error) : resolve(bytes),
    ),
  );
  if (archive.length > MAX_ARCHIVE) throw new Error('The project archive exceeds 128 MB.');
  return archive;
}

/** Inspect all entry sizes before decompression; source/project digests detect damaged contents. */
export async function openProjectArchive(
  input: ArrayBuffer | Uint8Array,
): Promise<OpenedProjectArchive> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (!bytes.length || bytes.length > MAX_ARCHIVE) return fail('file is empty or exceeds 128 MB.');
  const names = new Set<string>();
  let total = 0;
  try {
    unzipSync(bytes, {
      filter(entry) {
        if (
          names.has(entry.name) ||
          names.size >= 1003 ||
          /[\\\u0000]/.test(entry.name) ||
          entry.name.split('/').some((part) => !part || part === '.' || part === '..')
        )
          return fail('duplicate or unsafe ZIP entry path.');
        names.add(entry.name);
        if (
          ![PROJECT_PATH, MANIFEST_PATH, 'README.txt'].includes(entry.name) &&
          !/^sources\/[A-Za-z0-9_-]{1,128}\/[^/]+$/u.test(entry.name)
        )
          return fail('unrecognized files are present.');
        const limit =
          entry.name === PROJECT_PATH
            ? 100 * 1024 * 1024
            : entry.name === MANIFEST_PATH
              ? 8 * 1024 * 1024
              : entry.name === 'README.txt'
                ? 512 * 1024
                : MAX_SOURCE_BYTES;
        total += entry.originalSize;
        if (
          !Number.isSafeInteger(entry.originalSize) ||
          entry.originalSize < 0 ||
          entry.originalSize > limit ||
          total > MAX_TOTAL
        )
          return fail('ZIP content exceeds the supported size limits.');
        if (![0, 8].includes(entry.compression))
          return fail('ZIP compression method is unsupported.');
        return false;
      },
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'ZIP directory is damaged.');
  }
  if (!names.has(PROJECT_PATH) || !names.has(MANIFEST_PATH))
    return fail('project.json or manifest.json is missing.');
  const files = await new Promise<Record<string, Uint8Array>>((resolve, reject) =>
    unzip(bytes, (error, files) =>
      error ? reject(new Error('Invalid project archive: ZIP data is damaged.')) : resolve(files),
    ),
  );
  let manifest: Manifest;
  try {
    manifest = JSON.parse(strFromU8(files[MANIFEST_PATH]));
  } catch {
    return fail('manifest is not valid JSON.');
  }
  if (
    manifest?.format !== 'techdraw-project' ||
    manifest.version !== 1 ||
    !Array.isArray(manifest.sources) ||
    manifest.sources.length > 1000 ||
    !Array.isArray(manifest.missingSources)
  )
    return fail('manifest format is unsupported.');
  if (
    manifest.project?.path !== PROJECT_PATH ||
    manifest.project.size !== files[PROJECT_PATH].length ||
    manifest.project.sha256 !== (await hash(files[PROJECT_PATH]))
  )
    return fail('project data size or SHA-256 digest does not match.');
  const project = parseProject(strFromU8(files[PROJECT_PATH]));
  const allowed = new Set([PROJECT_PATH, MANIFEST_PATH, 'README.txt']);
  const sources: ProjectSource[] = [];
  const ids = new Set<string>();
  for (const entry of manifest.sources) {
    if (
      !entry ||
      typeof entry !== 'object' ||
      typeof entry.path !== 'string' ||
      !files[entry.path] ||
      !Array.isArray(entry.partIds)
    )
      return fail('original source entry is missing.');
    let source: ProjectSource;
    try {
      source = validateSource({
        id: entry.id,
        name: entry.name,
        kind: entry.kind,
        bytes: files[entry.path],
      });
    } catch {
      return fail('original source metadata is invalid.');
    }
    if (
      ids.has(source.id) ||
      entry.path !== pathFor(source) ||
      entry.size !== source.bytes.length ||
      entry.sha256 !== (await hash(source.bytes))
    )
      return fail('original source path, size or SHA-256 digest does not match.');
    ids.add(source.id);
    allowed.add(entry.path);
    const linked = project.parts.filter((part) => part.sourceId === source.id);
    if (
      !linked.length ||
      linked.some(
        (part) => part.sourceName !== source.name || (part.sourceKind ?? 'step') !== source.kind,
      ) ||
      JSON.stringify([...entry.partIds].sort()) !==
        JSON.stringify(linked.map((part) => part.id).sort())
    )
      return fail('source-to-part associations are inconsistent.');
    sources.push(source);
  }
  if ([...names].some((name) => !allowed.has(name))) return fail('unrecognized files are present.');
  const missing = missingSources(project, sources);
  if (JSON.stringify(manifest.missingSources) !== JSON.stringify(missing))
    return fail('missing-source information is inconsistent.');
  return { project, sources, description: project.description, missingSources: missing };
}
