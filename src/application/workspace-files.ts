import type { CadClient } from '../cad/client';
import type { DrawingAppearance } from '../drawing/appearance';
import { importDxf, type DxfUnit } from '../io/dxf-import';
import { createProjectArchive, openProjectArchive } from '../io/project-archive';
import { MAX_SOURCE_BYTES, SourceRepository } from '../io/source-repository';
import { parseProject } from '../project';
import { errorMessage } from '../ui/error-message';
import type { WorkspaceDocument } from '../workspace-document';

interface FilesContext {
  document: WorkspaceDocument;
  cad: CadClient;
  blocked(): boolean;
  dxfUnit(): DxfUnit | undefined;
  appearance(): DrawingAppearance;
  changed(): void;
  progressChanged(): void;
  imported(): void;
  opened(): void;
  saved?(): void;
  report(message: string): void;
  translate(message: string): string;
  download(blob: Blob, name: string): void;
  nextFrame?(): Promise<void>;
  exampleUrl: string;
}
export type WorkspaceOperation = 'import' | 'pdf' | 'save' | 'prepare';
export function drawingFileName(name: string, extension: 'pdf' | 'svg'): string {
  const base = name
    .normalize('NFC')
    .replace(/[\\/<>:"|?*\u0000-\u001f]/g, '-')
    .trim()
    .replace(/^\.+|[. ]+$/g, '')
    .slice(0, 100)
    .trim();
  return `${base || 'drawing'}.${extension}`;
}

/** Owns exclusive file operations and ignores late completions after cancellation. */
export class WorkspaceFiles {
  readonly sources = new SourceRepository();
  busy = false;
  kind: WorkspaceOperation = 'import';
  message = '';
  private generation = 0;
  private fetchController?: AbortController;

  constructor(private readonly context: FilesContext) {}

  updateProgress(message: string): void {
    if (!this.busy) return;
    this.message = message;
    this.context.progressChanged();
  }

  private begin(
    kind: WorkspaceOperation,
    message: string,
    allowViewer = false,
  ): number | undefined {
    if (this.busy || (!allowViewer && this.context.blocked())) return;
    this.busy = true;
    this.kind = kind;
    this.message = message;
    const token = ++this.generation;
    this.context.changed();
    return token;
  }

  private finish(token: number): void {
    if (token !== this.generation) return;
    this.busy = false;
    this.fetchController = undefined;
    this.context.changed();
  }

  cancel(): void {
    if (!this.busy || this.kind === 'pdf' || this.kind === 'save') return;
    const preparing = this.kind === 'prepare';
    ++this.generation;
    this.fetchController?.abort();
    this.fetchController = undefined;
    if (!preparing) this.context.cad.reset();
    const state = this.context.document.state;
    state.activeId ??= state.parts[0]?.id ?? null;
    this.busy = false;
    this.context.imported();
    this.context.changed();
    this.context.report(preparing ? 'Drawing preparation cancelled.' : 'Import cancelled.');
  }

  private async readFiles(files: readonly File[], token: number): Promise<void> {
    const { document } = this.context;
    let added = 0;
    let firstAddedId: string | undefined;
    const errors: string[] = [];
    for (const file of files) {
      if (token !== this.generation) return;
      if (file.size > MAX_SOURCE_BYTES) {
        errors.push(`${file.name}: exceeds the 64 MB browser import limit.`);
        continue;
      }
      try {
        this.updateProgress(`Reading ${file.name}…`);
        const bytes = await file.arrayBuffer();
        if (token !== this.generation) return;
        const original = new Uint8Array(bytes).slice();
        const kind = /\.dxf$/i.test(file.name) ? 'dxf' : 'step';
        const result =
          kind === 'dxf'
            ? importDxf(bytes, file.name, { unit: this.context.dxfUnit() })
            : await this.context.cad.importStep(bytes, file.name);
        if (token !== this.generation) return;
        const source = this.sources.add({ name: file.name, kind, bytes: original });
        for (const part of result.parts) {
          part.id = crypto.randomUUID();
          part.sourceId = source.id;
          document.addPart(part);
          firstAddedId ??= part.id;
          added++;
        }
        errors.push(...result.warnings);
      } catch (error) {
        if (token === this.generation) errors.push(`${file.name}: ${errorMessage(error)}`);
      }
    }
    if (token !== this.generation) return;
    if (firstAddedId) {
      document.state.activeId = firstAddedId;
      this.context.imported();
    }
    if (errors.length)
      this.context.report(
        [...new Set(errors.map((message) => this.context.translate(message)))]
          .join(' ')
          .slice(0, 700),
      );
    else if (added)
      this.context.report(
        `${added} ${added === 1 ? 'part' : 'parts'} imported. Review the dimensions before export.`,
      );
  }

  async importFiles(files: readonly File[]): Promise<void> {
    if (this.busy || this.context.blocked()) return;
    const valid = files.filter((file) => /\.(step|stp|dxf)$/i.test(file.name));
    if (!valid.length) {
      this.context.report('Choose a STEP (.step, .stp) or DXF (.dxf) file.');
      return;
    }
    const token = this.begin('import', 'Loading the browser CAD kernel…');
    if (token === undefined) return;
    try {
      await this.readFiles(valid, token);
    } finally {
      this.finish(token);
    }
  }

  async loadDemo(): Promise<void> {
    const token = this.begin('import', 'Building the example with the CAD kernel…');
    if (token === undefined) return;
    try {
      const result = await this.context.cad.demo();
      if (token !== this.generation) return;
      const source = this.sources.add({
        name: result.sourceName,
        kind: 'step',
        bytes: result.sourceBytes,
      });
      for (const part of result.parts) {
        part.id = crypto.randomUUID();
        part.sourceId = source.id;
        this.context.document.addPart(part);
        this.context.document.state.activeId = part.id;
      }
      this.context.imported();
      this.context.report('Example ready. Try moving a dimension or changing the sheet format.');
    } catch (error) {
      if (token === this.generation) this.context.report(errorMessage(error));
    } finally {
      this.finish(token);
    }
  }

  async loadDxfDemo(): Promise<void> {
    const token = this.begin('import', 'Opening the DXF example…');
    if (token === undefined) return;
    const controller = new AbortController();
    this.fetchController = controller;
    try {
      const response = await fetch(this.context.exampleUrl, { signal: controller.signal });
      if (!response.ok) throw new Error('The example DXF file could not be loaded.');
      const buffer = await response.arrayBuffer();
      if (token !== this.generation) return;
      await this.readFiles(
        [new File([buffer], 'inspection-plate.dxf', { type: 'application/dxf' })],
        token,
      );
    } catch (error) {
      if (token === this.generation) this.context.report(errorMessage(error));
    } finally {
      this.finish(token);
    }
  }

  async prepareAll(): Promise<void> {
    const { document } = this.context;
    if (!document.state.parts.length) return;
    const token = this.begin('prepare', 'Preparing drawings for all parts…');
    if (token === undefined) return;
    document.state.selected = new Set(document.state.parts.map((part) => part.id));
    try {
      for (const [index, part] of document.state.parts.entries()) {
        if (token !== this.generation) return;
        this.updateProgress(`Preparing drawing ${index + 1} of ${document.state.parts.length}…`);
        document.layout(part);
        if (index % 4 === 0)
          await (this.context.nextFrame?.() ??
            new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
      }
      if (token === this.generation)
        this.context.report(
          'Drawings are ready for all parts. Export the selected pages or save one compact project ZIP.',
        );
    } catch (error) {
      if (token === this.generation) this.context.report(errorMessage(error));
    } finally {
      this.finish(token);
    }
  }

  async exportPdf(): Promise<void> {
    const { document } = this.context;
    const state = document.state;
    const parts = state.parts.filter((part) => state.selected.has(part.id));
    if (!parts.length) return;
    const token = this.begin(
      'pdf',
      `Creating ${parts.length} vector PDF ${parts.length === 1 ? 'page' : 'pages'}…`,
      true,
    );
    if (token === undefined) return;
    try {
      const { exportPdf } = await import('../drawing/pdf');
      await exportPdf(
        parts.map((part) => {
          const layout = document.layout(part);
          return {
            part,
            dimensions: state.dimensions[part.id] ?? [],
            settings: state.settings,
            layout,
            annotations: state.annotations[part.id] ?? [],
            instructions: document.getInstructions(part.id),
            appearance: this.context.appearance(),
          };
        }),
        parts.length === 1 ? drawingFileName(parts[0].name, 'pdf') : 'techdraw-drawing-set.pdf',
      );
      this.context.report('PDF exported. Print at actual size to preserve scale.');
    } catch (error) {
      this.context.report(`PDF export failed: ${errorMessage(error)}`);
    } finally {
      this.finish(token);
    }
  }

  async save(): Promise<void> {
    const { document } = this.context;
    if (!document.state.parts.length) return;
    const token = this.begin('save', 'Saving project archive…', true);
    if (token === undefined) return;
    let saved = false;
    try {
      for (const part of document.state.parts) document.layout(part);
      const bytes = await createProjectArchive(document.state, this.sources.all(), {
        description: document.state.description,
      });
      this.context.download(
        new Blob([new Uint8Array(bytes)], { type: 'application/zip' }),
        'workspace.techdraw.zip',
      );
      saved = true;
      this.context.report('Project archive saved with source files, dimensions and annotations.');
    } catch (error) {
      this.context.report(`Cannot save project: ${errorMessage(error)}`);
    } finally {
      this.finish(token);
      if (saved) this.context.saved?.();
    }
  }

  async open(file: File): Promise<void> {
    const zipped = /\.zip$/i.test(file.name);
    if (this.busy || this.context.blocked()) return;
    if (file.size > (zipped ? 128 : 100) * 1024 * 1024) {
      this.context.report('Project exceeds the supported file size limit.');
      return;
    }
    const token = this.begin('import', 'Opening project…');
    if (token === undefined) return;
    let opened = false;
    try {
      const archive = zipped
        ? await openProjectArchive(new Uint8Array(await file.arrayBuffer()))
        : undefined;
      const project = archive?.project ?? parseProject(await file.text());
      if (token !== this.generation) return;
      this.context.document.replace(project);
      this.sources.replace(archive?.sources ?? []);
      this.context.opened();
      opened = true;
      this.context.report(
        archive?.missingSources.length
          ? 'Project opened. Some original source files were unavailable when it was saved.'
          : 'Editable project opened.',
      );
    } catch (error) {
      if (token === this.generation)
        this.context.report(`Cannot open project: ${errorMessage(error)}`);
    } finally {
      this.finish(token);
      if (opened) this.context.saved?.();
    }
  }

  removePart(id: string): void {
    const sourceId = this.context.document.state.parts.find((part) => part.id === id)?.sourceId;
    this.context.document.removePart(id);
    if (sourceId && !this.context.document.state.parts.some((part) => part.sourceId === sourceId))
      this.sources.remove(sourceId);
  }
}
