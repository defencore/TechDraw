import './style.css';
import { createCadClient } from './cad/client';
import { autoDimensions, arrangeDimensions } from './drawing/dimensions';
import { renderDrawing } from './drawing/render';
import { createLinearDimension, measureAngle } from './measurements';
import { parseProject, serializeProject } from './project';
import type {
  Dimension,
  DimensionKind,
  Part,
  Point2,
  Point3,
  ProjectedEdge,
  ViewId,
  DrawingSettings,
} from './model';
import { defaultSettings, DimensionHistory, type WorkspaceState } from './state';
import { icon } from './ui/icons';
import { button, option } from './ui/components';
import { createWorkspaceViews } from './ui/views';
import { downloadBlob, escapeHtml as e, readPreference, savePreference } from './ui/utils';

const app = document.querySelector<HTMLDivElement>('#app')!;
const state: WorkspaceState = {
  parts: [],
  selected: new Set(),
  activeId: null,
  dimensions: {},
  settings: { ...defaultSettings },
};
const histories = new Map<string, DimensionHistory>();
let theme = readPreference<string>(
  'theme',
  matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
);
let inspectorTab = 'sheet';
let tool: 'select' | DimensionKind = 'select';
let selectedDimension: string | undefined;
let pendingPoint: { viewId: ViewId; point: Point2; source?: Point3 } | undefined;
let pendingEdge: { viewId: ViewId; edge: ProjectedEdge } | undefined;
let busy = false;
let busyOperation: 'import' | 'export' = 'import';
let autoDetail: 'balanced' | 'full' = 'balanced';
const collapsedBranches = new Set<string>();
let progress = '';
let importToken = 0;
let zoom = 1;
let notification = '';
let toastTimer: ReturnType<typeof setTimeout>;
let rendered: ReturnType<typeof renderDrawing> | undefined;
let helpOpen = false;
const cad = createCadClient((message: string) => {
  progress = message;
  updateProgress();
});
const canvasResizeObserver = new ResizeObserver(() => {
  if (!drag) renderPaper();
});
const active = () => state.parts.find((p) => p.id === state.activeId);
const dims = () => (state.activeId ? (state.dimensions[state.activeId] ?? []) : []);
const history = () => {
  if (!state.activeId) return undefined;
  if (!histories.has(state.activeId)) histories.set(state.activeId, new DimensionHistory());
  return histories.get(state.activeId)!;
};

function toast(message: string): void {
  notification = message;
  clearTimeout(toastTimer);
  document.querySelector('#toast')!.textContent = message;
  document.querySelector('#toast')!.classList.add('visible');
  toastTimer = setTimeout(() => {
    notification = '';
    document.querySelector('#toast')?.classList.remove('visible');
  }, 5500);
}

function render(): void {
  document.documentElement.dataset.theme = theme;
  const part = active();
  const views = createWorkspaceViews({
    state,
    inspectorTab,
    selectedDimension,
    autoDetail,
    collapsedBranches,
  });
  app.innerHTML = `
    <header class="app-header">
      <a class="brand" href="./" aria-label="TechDraw home"><span class="brand-mark">${icon('dimension')}</span><strong>TechDraw<span class="brand-dot">.</span></strong><span class="brand-by">by DEFENCORE</span></a>
      <div class="header-right"><span class="local-pill">${icon('lock')}<span>Files stay on your device</span></span>${button('help', 'Quick guide', 'info', 'quiet help-button')}${button('theme', '', theme === 'light' ? 'moon' : 'sun', 'icon-button', `aria-label="Switch to ${theme === 'light' ? 'dark' : 'light'} theme" title="Switch theme"`)}</div>
    </header>
    <div class="workspace">
      <aside class="files-panel" aria-label="Model files">
        <div class="panel-title"><span>WORKSPACE</span><span class="count">${state.parts.length}</span></div>
        ${button('import', 'Import STEP', 'plus', 'import-button', busy ? 'disabled' : '')}
        <input id="file-input" type="file" accept=".step,.stp,.STEP,.STP" multiple hidden />
        <input id="project-input" type="file" accept=".json,.techdraw" hidden />
        <div class="file-tools">${button('open-project', 'Open project', 'file', 'text-button')}${button('save-project', 'Save', 'download', 'text-button', !part ? 'disabled' : '')}</div>
        <div class="files-section-heading"><span>PARTS</span>${state.parts.length ? button('select-all', state.selected.size === state.parts.length ? 'Clear' : 'Select all', undefined, 'text-button small') : ''}</div>
        <div class="part-list">${views.renderParts()}</div>
        <div class="sidebar-bottom"><div class="private-note">${icon('cube')}<div><strong>Real geometry. Local processing.</strong><p>STEP → CAD kernel → vector drawing.<br>No upload. No account.</p></div></div><a href="https://github.com/defencore/TechDraw" target="_blank" rel="noopener noreferrer">Source & documentation ${icon('arrow')}</a></div>
      </aside>
      <main class="drawing-workspace">
        <div class="workspace-heading"><div><div class="eyebrow">DRAWING WORKSPACE</div><h1>${part ? e(part.name) : 'From solid to sheet'}</h1></div><div class="export-group">${button('export-svg', 'SVG', undefined, 'secondary compact', !part || busy ? 'disabled' : '')}${button('export-pdf', `Export PDF${state.selected.size > 1 ? ` · ${state.selected.size}` : ''}`, 'download', 'primary', !state.selected.size || busy ? 'disabled' : '')}</div></div>
        <div class="drawing-toolbar" role="toolbar" aria-label="Drawing tools">
          <div class="tool-group">${button('tool:select', '', 'pointer', `tool-button ${tool === 'select' ? 'active' : ''}`, 'aria-label="Select and move dimensions" title="Select and move (Esc)"')}${button('auto-dimensions', 'Auto dimensions', 'dimension', 'quiet', !part || busy ? 'disabled' : '')}${button('arrange-dimensions', 'Arrange', 'layers', 'quiet', !part || busy ? 'disabled title="Arrange dimension lines"' : 'title="Place smaller dimensions inside larger ones"')}<span class="toolbar-divider"></span><select id="measure-tool" aria-label="Add dimension" ${!part || busy ? 'disabled' : ''}>${option('select', 'Add dimension…', tool)}${option('horizontal', 'Horizontal', tool)}${option('vertical', 'Vertical', tool)}${option('aligned', 'Aligned', tool)}${option('diameter', 'Diameter', tool)}${option('radius', 'Radius', tool)}${option('angle', 'Angle', tool)}</select></div>
          <div class="tool-group">${button('undo', '', 'undo', 'icon-button', `aria-label="Undo" title="Undo (Ctrl/⌘ Z)" ${!history()?.canUndo ? 'disabled' : ''}`)}${button('redo', '', 'redo', 'icon-button', `aria-label="Redo" title="Redo (Ctrl/⌘ Shift Z)" ${!history()?.canRedo ? 'disabled' : ''}`)}<span class="toolbar-divider"></span>${button('fit', '', 'fit', 'icon-button', 'aria-label="Fit sheet" title="Fit sheet"')}<select id="zoom" aria-label="Sheet zoom">${[0.6, 0.8, 1, 1.25, 1.5, 2].map((n) => option(n, `${Math.round(n * 100)}%`, zoom)).join('')}</select></div>
        </div>
        <div class="canvas-area ${tool !== 'select' ? 'measuring' : ''}" id="canvas-area"><div class="drop-overlay">${icon('upload')}Drop STEP files to import</div><div id="paper-host"></div>${!part ? views.renderEmpty() : ''}</div>
        <div class="canvas-status"><span id="tool-hint">${toolHint()}</span><span>${part ? `${state.settings.format} · ${state.settings.orientation} · mm` : 'STEP / STP · Multiple files supported'}</span></div>
      </main>
      <aside class="inspector" aria-label="Drawing properties">
        <div class="inspector-tabs" role="tablist">${['sheet', 'details', 'dimensions'].map((t) => `<button role="tab" aria-selected="${inspectorTab === t}" data-action="tab:${t}" class="${inspectorTab === t ? 'active' : ''}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div>
        <div class="inspector-body">${views.renderInspector()}</div>
        <div class="review-note">${icon('info')}<p><strong>Review before manufacture</strong>Automatic dimensions are a starting point. Confirm features, tolerances, fits and sections.</p></div>
      </aside>
    </div>
    <div id="busy-overlay" class="busy-overlay ${busy ? 'visible' : ''}" role="status" aria-live="polite"><div class="busy-card"><span class="spinner"></span><strong>${busyOperation === 'export' ? 'Exporting your PDF' : 'Preparing your drawing'}</strong><p id="progress-message">${e(progress)}</p>${busyOperation === 'import' ? button('cancel', 'Cancel', undefined, 'secondary') : ''}</div></div>
    <div id="toast" class="toast ${notification ? 'visible' : ''}" role="status" aria-live="polite">${e(notification)}</div>
    ${helpOpen ? views.renderHelp() : ''}`;
  renderPaper();
  canvasResizeObserver.disconnect();
  const canvas = document.querySelector('#canvas-area');
  if (canvas) canvasResizeObserver.observe(canvas);
}

function toolHint(): string {
  if (tool === 'select')
    return active()
      ? 'Select a dimension to edit · Drag a label to move · Delete to remove'
      : 'Drop STEP files anywhere in the workspace';
  if (tool === 'diameter' || tool === 'radius')
    return `Click a circular edge in an orthographic view · Esc to cancel`;
  if (tool === 'angle')
    return pendingEdge
      ? 'Click the second straight edge in the same view'
      : 'Click two straight edges to measure an angle';
  return pendingPoint
    ? 'Click the second snap point in the same view'
    : 'Click a straight edge, or two snap points · Esc to cancel';
}

function renderPaper(): void {
  const part = active(),
    host = document.querySelector<HTMLDivElement>('#paper-host');
  if (!part || !host) {
    rendered = undefined;
    return;
  }
  rendered = renderDrawing(part, dims(), state.settings, selectedDimension, drag?.layout);
  host.innerHTML = rendered.svg;
  host.className = 'paper-host';
  host.style.setProperty('--zoom', String(zoom));
  host.style.setProperty('--paper-ratio', String(rendered.width / rendered.height));
  const canvas = document.querySelector<HTMLElement>('#canvas-area');
  if (canvas) {
    const style = getComputedStyle(canvas);
    const availableWidth =
      canvas.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const availableHeight =
      canvas.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    const fitWidth = Math.max(
      80,
      Math.min(availableWidth, (availableHeight * rendered.width) / rendered.height),
    );
    host.style.width = `${fitWidth * zoom}px`;
  }
  const svg = host.querySelector('svg');
  if (svg) {
    svg.setAttribute('aria-label', `Technical drawing of ${part.name}`);
    svg.setAttribute('role', 'img');
  }
  const stats = document.querySelector('#sheet-stats');
  if (stats)
    stats.innerHTML = `<dl><dt>Views</dt><dd>4 · First angle</dd><dt>Sheet size</dt><dd>${rendered.width} × ${rendered.height} mm</dd><dt>Scale</dt><dd>${rendered.scale >= 1 ? `${+rendered.scale.toFixed(3)}:1` : `1:${+(1 / rendered.scale).toFixed(3)}`}</dd><dt>Dimensions</dt><dd>${dims().length}</dd></dl>${rendered.warnings?.map((w) => `<p class="layout-warning">${e(w)}</p>`).join('') ?? ''}`;
}

function updateProgress(): void {
  const el = document.querySelector('#progress-message');
  if (el) el.textContent = progress;
}
function setTool(value: typeof tool): void {
  tool = value;
  pendingPoint = undefined;
  pendingEdge = undefined;
  selectedDimension = undefined;
  render();
}
function changeDimensions(next: Dimension[]): void {
  history()?.record(dims());
  state.dimensions[state.activeId!] = next;
  render();
}

function syncSettingsFromControls(): void {
  for (const control of app.querySelectorAll<
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  >('[data-setting]')) {
    const key = control.dataset.setting as keyof DrawingSettings;
    const value =
      control instanceof HTMLInputElement && control.type === 'checkbox'
        ? control.checked
        : key === 'precision'
          ? Number(control.value)
          : key === 'scale' && control.value !== 'auto'
            ? Number(control.value)
            : control.value;
    (state.settings as any)[key] = value;
  }
}

let paperUpdateTimer: ReturnType<typeof setTimeout> | undefined;
app.addEventListener('input', (event) => {
  const control = event.target as HTMLInputElement | HTMLTextAreaElement;
  if (!control.matches('input[data-setting]:not([type="checkbox"]),textarea[data-setting]')) return;
  syncSettingsFromControls();
  clearTimeout(paperUpdateTimer);
  paperUpdateTimer = setTimeout(renderPaper, 120);
});

async function importFiles(files: File[]): Promise<void> {
  if (busy) return;
  const valid = files.filter((f) => /\.(step|stp)$/i.test(f.name));
  if (!valid.length) {
    toast('Choose a STEP (.step or .stp) file.');
    return;
  }
  busy = true;
  busyOperation = 'import';
  progress = 'Loading the browser CAD kernel…';
  const token = ++importToken;
  render();
  let added = 0;
  let firstAddedId: string | undefined;
  const errors: string[] = [];
  try {
    for (const file of valid) {
      if (token !== importToken) break;
      if (file.size > 64 * 1024 * 1024) {
        errors.push(`${file.name}: exceeds the 64 MB browser import limit.`);
        continue;
      }
      try {
        progress = `Reading ${file.name}…`;
        updateProgress();
        const result = await cad.importStep(await file.arrayBuffer(), file.name);
        if (token !== importToken) break;
        for (const part of result.parts) {
          part.id = crypto.randomUUID();
          state.parts.push(part);
          state.selected.add(part.id);
          state.dimensions[part.id] = autoDimensions(part);
          firstAddedId ??= part.id;
          added++;
        }
        if (result.warnings.length) errors.push(...result.warnings);
      } catch (err) {
        if (token === importToken) errors.push(`${file.name}: ${errorMessage(err)}`);
      }
    }
  } finally {
    if (token === importToken) {
      busy = false;
      if (firstAddedId) {
        state.activeId = firstAddedId;
        pendingPoint = undefined;
        pendingEdge = undefined;
        selectedDimension = undefined;
        tool = 'select';
      }
      render();
      if (errors.length) toast([...new Set(errors)].join(' ').slice(0, 700));
      else if (added)
        toast(
          `${added} ${added === 1 ? 'part' : 'parts'} imported. Review the dimensions before export.`,
        );
    }
  }
}

async function loadDemo(): Promise<void> {
  if (busy) return;
  busy = true;
  busyOperation = 'import';
  progress = 'Building the example with the CAD kernel…';
  const token = ++importToken;
  render();
  try {
    const result = await cad.demo();
    if (token !== importToken) return;
    for (const part of result.parts) {
      part.id = crypto.randomUUID();
      state.parts.push(part);
      state.selected.add(part.id);
      state.dimensions[part.id] = autoDimensions(part);
      state.activeId = part.id;
    }
    toast('Example ready. Try moving a dimension or changing the sheet format.');
  } catch (err) {
    if (token === importToken) toast(errorMessage(err));
  } finally {
    if (token === importToken) {
      busy = false;
      render();
    }
  }
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function exportDrawing(): Promise<void> {
  const parts = state.parts.filter((p) => state.selected.has(p.id));
  if (!parts.length || busy) return;
  busy = true;
  busyOperation = 'export';
  progress = `Creating ${parts.length} vector PDF ${parts.length === 1 ? 'page' : 'pages'}…`;
  render();
  try {
    const { exportPdf } = await import('./drawing/pdf');
    await exportPdf(
      parts.map((part) => ({
        part,
        dimensions: state.dimensions[part.id] ?? [],
        settings: state.settings,
      })),
      parts.length === 1 ? `${safeName(parts[0].name)}.pdf` : 'techdraw-drawing-set.pdf',
    );
    toast('PDF exported. Print at actual size to preserve scale.');
  } catch (err) {
    toast(`PDF export failed: ${errorMessage(err)}`);
  } finally {
    busy = false;
    render();
  }
}
const safeName = (name: string) => name.replace(/[^a-z0-9_.-]+/gi, '-').slice(0, 100) || 'drawing';

function saveProject(): void {
  try {
    downloadBlob(
      new Blob([serializeProject(state)], { type: 'application/json' }),
      'workspace.techdraw.json',
    );
    toast('Editable project saved to your device.');
  } catch (error) {
    toast(`Cannot save project: ${errorMessage(error)}`);
  }
}

async function openProject(file: File): Promise<void> {
  if (file.size > 100 * 1024 * 1024) {
    toast('Project exceeds the 100 MB limit.');
    return;
  }
  try {
    const data = parseProject(await file.text());
    state.parts = data.parts;
    state.settings = data.settings;
    state.dimensions = data.dimensions;
    state.activeId = state.parts[0].id;
    state.selected = new Set(data.selected);
    histories.clear();
    selectedDimension = undefined;
    pendingPoint = undefined;
    pendingEdge = undefined;
    tool = 'select';
    render();
    toast('Editable project opened.');
  } catch (err) {
    toast(`Cannot open project: ${errorMessage(err)}`);
  }
}

function addDimension(d: Dimension): void {
  tool = 'select';
  selectedDimension = d.id;
  pendingPoint = undefined;
  pendingEdge = undefined;
  inspectorTab = 'dimensions';
  changeDimensions(
    arrangeDimensions([...dims(), d], {
      scale: rendered?.scale,
      precision: state.settings.precision,
      part: active(),
    }),
  );
  toast('Dimension added. Drag its label to position it.');
}

function handleGeometryClick(target: Element): void {
  if (tool === 'select' || !active()) return;
  const edgeEl = target.closest<SVGElement>('[data-edge-id]');
  const anchorEl = target.closest<SVGElement>('[data-anchor-id]');
  const viewId = (target.closest('[data-view-id]')?.getAttribute('data-view-id') ??
    edgeEl?.getAttribute('data-view-id') ??
    anchorEl?.getAttribute('data-view-id')) as ViewId;
  if (!viewId || viewId === 'iso') {
    toast('Add dimensions in the front, top or right view.');
    return;
  }
  const view = active()!.views.find((v) => v.id === viewId)!;
  if (anchorEl && ['horizontal', 'vertical', 'aligned'].includes(tool)) {
    const point: Point2 = [Number(anchorEl.dataset.modelX), Number(anchorEl.dataset.modelY)];
    if (!point.every(Number.isFinite)) return;
    const source = view.anchors?.find((a) => a.id === anchorEl.dataset.anchorId)?.source;
    if (pendingPoint && pendingPoint.viewId === viewId) {
      try {
        addDimension(
          createLinearDimension(
            viewId,
            pendingPoint.point,
            point,
            tool as DimensionKind,
            pendingPoint.source,
            source,
          ),
        );
      } catch (err) {
        pendingPoint = undefined;
        toast(errorMessage(err));
      }
    } else {
      pendingPoint = { viewId, point, source };
      document.querySelector('#tool-hint')!.textContent = toolHint();
      toast('First point selected. Choose the second point in the same view.');
    }
    return;
  }
  if (!edgeEl) return;
  const edge = view.edges.find((x) => x.id === edgeEl.dataset.edgeId);
  if (!edge) return;
  if (tool === 'diameter' || tool === 'radius') {
    if (edge.kind !== 'circle' || !edge.center || !edge.radius) {
      toast('Choose an edge recognized as a circular arc or circle.');
      return;
    }
    addDimension({
      id: crypto.randomUUID(),
      viewId,
      kind: tool,
      a: [...edge.center],
      b:
        tool === 'radius'
          ? [...edge.points[Math.floor(edge.points.length / 2)]]
          : [edge.center[0] + edge.radius, edge.center[1]],
      value: edge.radius * (tool === 'diameter' ? 2 : 1),
      offset: 10,
      automatic: false,
    });
    return;
  }
  if (edge.kind !== 'line' || edge.points.length < 2) {
    toast('Choose a straight edge or use two snap points.');
    return;
  }
  if (tool === 'angle') {
    if (!pendingEdge || pendingEdge.viewId !== viewId) {
      pendingEdge = { viewId, edge };
      document.querySelector('#tool-hint')!.textContent = toolHint();
      toast('First edge selected. Choose the second straight edge.');
      return;
    }
    try {
      addDimension(measureAngle(viewId, pendingEdge.edge, edge));
    } catch (err) {
      pendingEdge = undefined;
      toast(errorMessage(err));
    }
    return;
  }
  try {
    addDimension(
      createLinearDimension(
        viewId,
        edge.points[0],
        edge.points.at(-1)!,
        tool,
        edge.sourcePoints?.[0],
        edge.sourcePoints?.at(-1),
        edge.length,
      ),
    );
  } catch (err) {
    toast(errorMessage(err));
  }
}

app.addEventListener('click', (event) => {
  const target = event.target as Element;
  syncSettingsFromControls();
  if (target.classList.contains('modal-backdrop')) {
    helpOpen = false;
    render();
    return;
  }
  const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
  if (action) {
    if (action === 'import') document.querySelector<HTMLInputElement>('#file-input')!.click();
    else if (action === 'demo') void loadDemo();
    else if (action === 'theme') {
      theme = theme === 'light' ? 'dark' : 'light';
      savePreference('theme', theme);
      render();
    } else if (action === 'help') {
      helpOpen = true;
      render();
      document.querySelector<HTMLButtonElement>('[data-action="close-help"]')?.focus();
    } else if (action === 'close-help') {
      helpOpen = false;
      render();
    } else if (action === 'export-pdf') void exportDrawing();
    else if (action === 'export-svg' && rendered)
      downloadBlob(
        new Blob([rendered.svg], { type: 'image/svg+xml' }),
        `${safeName(active()!.name)}.svg`,
      );
    else if (action === 'save-project') saveProject();
    else if (action === 'open-project')
      document.querySelector<HTMLInputElement>('#project-input')!.click();
    else if (action === 'select-all') {
      state.selected =
        state.selected.size === state.parts.length
          ? new Set()
          : new Set(state.parts.map((p) => p.id));
      render();
    } else if (action === 'fit') {
      zoom = 1;
      render();
    } else if (action === 'auto-dimensions' && active()) {
      selectedDimension = undefined;
      changeDimensions(autoDimensions(active()!, autoDetail));
      toast('Automatic dimensions regenerated. Undo restores the previous set.');
    } else if (action === 'arrange-dimensions' && active()) {
      changeDimensions(
        arrangeDimensions(dims(), {
          scale: rendered?.scale,
          precision: state.settings.precision,
          part: active(),
        }),
      );
      toast('Dimension lines arranged from smaller to larger.');
    } else if (action === 'undo' || action === 'redo') {
      const result = action === 'undo' ? history()?.undo(dims()) : history()?.redo(dims());
      if (result) {
        state.dimensions[state.activeId!] = result;
        selectedDimension = undefined;
        render();
      }
    } else if (action === 'delete-dimension' && selectedDimension) {
      const id = selectedDimension;
      selectedDimension = undefined;
      changeDimensions(dims().filter((d) => d.id !== id));
    } else if (action === 'cancel') {
      importToken++;
      cad.reset();
      state.activeId ??= state.parts[0]?.id ?? null;
      pendingPoint = undefined;
      pendingEdge = undefined;
      tool = 'select';
      busy = false;
      render();
      toast('Import cancelled.');
    } else if (action.startsWith('tab:')) {
      inspectorTab = action.slice(4);
      render();
    } else if (action === 'tool:select') setTool('select');
    return;
  }
  const removeId = target.closest<HTMLElement>('[data-remove-part]')?.dataset.removePart;
  if (removeId) {
    state.parts = state.parts.filter((p) => p.id !== removeId);
    state.selected.delete(removeId);
    delete state.dimensions[removeId];
    histories.delete(removeId);
    if (state.activeId === removeId) state.activeId = state.parts[0]?.id ?? null;
    selectedDimension = undefined;
    pendingPoint = undefined;
    pendingEdge = undefined;
    tool = 'select';
    render();
    return;
  }
  const partId = target.closest<HTMLElement>('[data-part-id]')?.dataset.partId;
  if (partId) {
    state.activeId = partId;
    selectedDimension = undefined;
    pendingPoint = undefined;
    pendingEdge = undefined;
    render();
    return;
  }
  const dimensionId =
    target.closest<HTMLElement>('[data-dimension-select]')?.dataset.dimensionSelect ??
    target.closest<SVGElement>('[data-dimension-id]')?.dataset.dimensionId;
  if (dimensionId && tool === 'select') {
    selectedDimension = dimensionId;
    inspectorTab = 'dimensions';
    render();
    return;
  }
  if (target.closest('#paper-host')) handleGeometryClick(target);
});

app.addEventListener('change', (event) => {
  const target = event.target as HTMLInputElement;
  if (target.id === 'file-input') {
    void importFiles(Array.from(target.files ?? []));
    target.value = '';
    return;
  }
  if (target.id === 'project-input') {
    const file = target.files?.[0];
    if (file) void openProject(file);
    target.value = '';
    return;
  }
  if (target.id === 'measure-tool') {
    setTool(target.value as typeof tool);
    return;
  }
  if (target.id === 'auto-detail') {
    autoDetail = target.value as typeof autoDetail;
    if (active()) {
      selectedDimension = undefined;
      changeDimensions(autoDimensions(active()!, autoDetail));
    }
    return;
  }
  if (target.id === 'zoom') {
    zoom = Number(target.value);
    renderPaper();
    return;
  }
  if (target.dataset.partCheck) {
    if (target.checked) state.selected.add(target.dataset.partCheck);
    else state.selected.delete(target.dataset.partCheck);
    render();
    return;
  }
  const key = target.dataset.setting as keyof DrawingSettings | undefined;
  if (key) {
    const value =
      target.type === 'checkbox'
        ? target.checked
        : key === 'precision'
          ? Number(target.value)
          : key === 'scale' && target.value !== 'auto'
            ? Number(target.value)
            : target.value;
    (state.settings as any)[key] = value;
    renderPaper();
    const status = document.querySelector('.canvas-status > span:last-child');
    if (status && active())
      status.textContent = `${state.settings.format} · ${state.settings.orientation} · mm`;
    return;
  }
  if (target.dataset.dimensionSetting && selectedDimension) {
    const key = target.dataset.dimensionSetting as 'offset' | 'prefix' | 'suffix';
    const next = structuredClone(dims());
    const d = next.find((x) => x.id === selectedDimension)!;
    if (key === 'offset') {
      const n = Number(target.value);
      if (!Number.isFinite(n) || Math.abs(n) > 1000) {
        toast('Use an offset between -1000 and 1000 mm.');
        return;
      }
      d.offset = n;
    } else d[key] = target.value.slice(0, 120);
    history()?.record(dims());
    state.dimensions[state.activeId!] = next;
    renderPaper();
    const undoButton = document.querySelector<HTMLButtonElement>('[data-action="undo"]');
    const redoButton = document.querySelector<HTMLButtonElement>('[data-action="redo"]');
    if (undoButton) undoButton.disabled = false;
    if (redoButton) redoButton.disabled = true;
  }
});

app.addEventListener(
  'toggle',
  (event) => {
    const el = event.target as HTMLDetailsElement;
    if (el.dataset.treePath) {
      if (el.open) collapsedBranches.delete(el.dataset.treePath);
      else collapsedBranches.add(el.dataset.treePath);
    }
  },
  true,
);

let drag:
  | {
      id: string;
      start: Point2;
      initial: Point2;
      old: Dimension[];
      initialOffset: number;
      layout?: Pick<ReturnType<typeof renderDrawing>, 'scale' | 'viewTransforms'>;
      moved: boolean;
      pointerId: number;
    }
  | undefined;
app.addEventListener('pointerdown', (event) => {
  if (tool !== 'select' || busy) return;
  const target = event.target as Element,
    el = target.closest<SVGElement>('[data-dimension-id]');
  if (!el) return;
  const dimension = dims().find((d) => d.id === el.dataset.dimensionId);
  if (!dimension) return;
  const point = sheetPoint(event);
  if (!point) return;
  drag = {
    id: dimension.id,
    start: point,
    initial: dimension.textOffset ?? [0, 0],
    old: structuredClone(dims()),
    initialOffset: dimension.offset,
    layout: rendered
      ? { scale: rendered.scale, viewTransforms: rendered.viewTransforms }
      : undefined,
    moved: false,
    pointerId: event.pointerId,
  };
  (event.target as Element).setPointerCapture?.(event.pointerId);
});
window.addEventListener('pointermove', (event) => {
  if (!drag) return;
  const point = sheetPoint(event);
  if (!point) return;
  const dx = point[0] - drag.start[0],
    dy = point[1] - drag.start[1];
  if (Math.hypot(dx, dy) < 0.4 && !drag.moved) return;
  drag.moved = true;
  const d = dims().find((x) => x.id === drag!.id);
  if (d) {
    if (d.kind === 'horizontal') d.offset = drag.initialOffset + dy;
    else if (d.kind === 'vertical') d.offset = drag.initialOffset - dx;
    else if (d.kind === 'aligned') {
      const vx = d.b[0] - d.a[0],
        vy = -(d.b[1] - d.a[1]),
        length = Math.hypot(vx, vy) || 1;
      d.offset = drag.initialOffset + (-vy * dx + vx * dy) / length;
    } else if (d.kind === 'angle' && d.vertex && rendered) {
      const t = rendered.viewTransforms[d.viewId],
        cx = t.x + d.vertex[0] * t.scale,
        cy = t.y - d.vertex[1] * t.scale;
      d.offset = Math.max(
        6,
        drag.initialOffset +
          Math.hypot(point[0] - cx, point[1] - cy) -
          Math.hypot(drag.start[0] - cx, drag.start[1] - cy),
      );
    } else d.textOffset = [drag.initial[0] + dx, drag.initial[1] + dy];
    selectedDimension = d.id;
    renderPaper();
  }
});
window.addEventListener('pointerup', () => {
  const finished = drag;
  drag = undefined;
  if (finished?.moved) {
    history()?.record(finished.old);
    inspectorTab = 'dimensions';
    render();
  }
});
function sheetPoint(event: PointerEvent): Point2 | undefined {
  const svg = document.querySelector<SVGSVGElement>('#paper-host svg');
  if (!svg) return;
  const matrix = svg.getScreenCTM();
  if (!matrix) return;
  const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
  return [p.x, p.y];
}

let dragDepth = 0;
window.addEventListener('dragenter', (event) => {
  if (event.dataTransfer?.types.includes('Files')) {
    event.preventDefault();
    dragDepth++;
    document.querySelector('#canvas-area')?.classList.add('dragover');
  }
});
window.addEventListener('dragover', (event) => {
  event.preventDefault();
});
window.addEventListener('dragleave', () => {
  dragDepth--;
  if (dragDepth <= 0) {
    dragDepth = 0;
    document.querySelector('#canvas-area')?.classList.remove('dragover');
  }
});
window.addEventListener('drop', (event) => {
  event.preventDefault();
  dragDepth = 0;
  document.querySelector('#canvas-area')?.classList.remove('dragover');
  if (event.dataTransfer) void importFiles([...event.dataTransfer.files]);
});
window.addEventListener('keydown', (event) => {
  if (helpOpen && event.key === 'Tab') {
    const controls = [
      ...document.querySelectorAll<HTMLElement>('.help-dialog button,.help-dialog a'),
    ];
    const first = controls[0],
      last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
    return;
  }
  const editing = (event.target as Element)?.matches('input,textarea,select');
  if (event.key === 'Escape') {
    helpOpen = false;
    setTool('select');
    return;
  }
  if (editing) return;
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    document
      .querySelector<HTMLButtonElement>(`[data-action="${event.shiftKey ? 'redo' : 'undo'}"]`)
      ?.click();
  }
  if ((event.key === 'Delete' || event.key === 'Backspace') && selectedDimension) {
    event.preventDefault();
    document.querySelector<HTMLButtonElement>('[data-action="delete-dimension"]')?.click();
  }
});
window.addEventListener('pointercancel', () => {
  if (drag) {
    state.dimensions[state.activeId!] = drag.old;
    drag = undefined;
    render();
  }
});
window.addEventListener('beforeunload', (event) => {
  if (state.parts.length) {
    event.preventDefault();
  }
});
render();
