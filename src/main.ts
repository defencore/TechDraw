import './style.css';
import { createCadClient } from './cad/client';
import { autoDimensions, formatDimension } from './drawing/dimensions';
import { normalizeToleranceNumber, parseDimensionTolerance } from './drawing/tolerances';
import { renderToleranceFields, type ToleranceMode } from './ui/tolerance-editor';
import { initializeDrawing } from './drawing/layout';
import { titleBlockDefaults, cleanTitleBlockText } from './drawing/title-block-data';
import {
  readTitleBlockCache,
  saveTitleBlockCache,
  clearTitleBlockCache,
} from './ui/title-block-cache';
import { renderDrawing } from './drawing/render';
import { DrawingCanvas, type CanvasTool } from './ui/drawing-canvas';
import { parseProject, serializeProject } from './project';
import type { Dimension, DimensionTolerance, Part, DrawingSettings } from './model';
import { defaultSettings, DimensionHistory, type WorkspaceState } from './state';
import { icon } from './ui/icons';
import { button, option } from './ui/components';
import { createWorkspaceViews } from './ui/views';
import { downloadBlob, escapeHtml as e, readPreference, savePreference } from './ui/utils';

const app = document.querySelector<HTMLDivElement>('#app')!;
const titleBlockStorage = (() => {
  try {
    return localStorage;
  } catch {
    return undefined;
  }
})();
const state: WorkspaceState = {
  parts: [],
  selected: new Set(),
  activeId: null,
  dimensions: {},
  layouts: {},
  settings: { ...defaultSettings, ...readTitleBlockCache(titleBlockStorage) },
};
const histories = new Map<string, DimensionHistory>();
let titleBlockCached = saveTitleBlockCache(titleBlockStorage, state.settings);
const pendingArrangement = new Set<string>();
let theme = readPreference<string>(
  'theme',
  matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
);
let inspectorTab = 'sheet';
let tool: CanvasTool = 'select';
let selectedDimension: string | undefined;
let busy = false;
let busyOperation: 'import' | 'export' = 'import';
let autoDetail: 'balanced' | 'full' = 'balanced';
const collapsedBranches = new Set<string>();
let progress = '';
let importToken = 0;
let canvasHint = 'Drop STEP files anywhere in the workspace';
let layoutSettingsKey = '';
let notification = '';
let toastTimer: ReturnType<typeof setTimeout>;
let rendered: ReturnType<typeof renderDrawing> | undefined;
let helpOpen = false;
const cad = createCadClient((message: string) => {
  progress = message;
  updateProgress();
});
const active = () => state.parts.find((p) => p.id === state.activeId);
const dims = () => (state.activeId ? (state.dimensions[state.activeId] ?? []) : []);
const history = () => {
  if (!state.activeId) return undefined;
  if (!histories.has(state.activeId)) histories.set(state.activeId, new DimensionHistory());
  return histories.get(state.activeId)!;
};

const drawingCanvas = new DrawingCanvas({
  select(id) {
    selectedDimension = id;
    inspectorTab = 'dimensions';
    refreshInspector();
  },
  add: addDimension,
  edit(dimension) {
    changeDimensions(dims().map((d) => (d.id === dimension.id ? dimension : d)));
  },
  zoom() {
    const select = document.querySelector<HTMLSelectElement>('#zoom');
    if (select) select.innerHTML = zoomOptions();
  },
  hint(message) {
    canvasHint = active() ? message : 'Drop STEP files anywhere in the workspace';
    const hint = document.querySelector('#tool-hint');
    if (hint) hint.textContent = canvasHint;
  },
  error: toast,
});
function zoomOptions(): string {
  const value = drawingCanvas.zoom;
  const choices = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 12, 16];
  if (!choices.some((n) => Math.abs(n - value) < 1e-8)) choices.push(value);
  return choices
    .sort((a, b) => a - b)
    .map((n) => option(n, `${Math.round(n * 100)}%`, value))
    .join('');
}
function refreshInspector(): void {
  const views = createWorkspaceViews({
    state,
    inspectorTab,
    selectedDimension,
    autoDetail,
    collapsedBranches,
  });
  const body = app.querySelector('.inspector-body');
  if (body) body.innerHTML = views.renderInspector();
  updateCacheStatus();
  for (const tab of app.querySelectorAll<HTMLElement>('.inspector-tabs [role="tab"]')) {
    const selected = tab.dataset.action === `tab:${inspectorTab}`;
    tab.classList.toggle('active', selected);
    tab.setAttribute('aria-selected', String(selected));
  }
}
function getPartLayout(part: Part) {
  const key = JSON.stringify([
    state.settings.format,
    state.settings.orientation,
    state.settings.template,
    state.settings.scale,
  ]);
  if (key !== layoutSettingsKey) {
    state.layouts = {};
    for (const item of histories.values()) item.invalidateLayouts();
    layoutSettingsKey = key;
  }
  if (!state.layouts[part.id]) {
    const initialized = initializeDrawing(part, state.dimensions[part.id] ?? [], state.settings, {
      arrange: pendingArrangement.has(part.id),
    });
    state.dimensions[part.id] = initialized.dimensions;
    state.layouts[part.id] = initialized.layout;
    pendingArrangement.delete(part.id);
  }
  return state.layouts[part.id];
}

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
  const retainedCanvas = app.querySelector<HTMLElement>('#canvas-area');
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
      <a class="brand" href="./" aria-label="TechDraw home"><span class="brand-mark">${icon('dimension')}</span><span class="brand-wordmark"><strong>TechDraw<span class="brand-dot">.</span></strong><span class="brand-by">by DEFENCORE</span></span></a>
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
          <div class="tool-group">${button('tool:select', '', 'pointer', `tool-button ${tool === 'select' ? 'active' : ''}`, 'aria-label="Select and move dimensions" title="Select and move (Esc)"')}${button('tool:pan', '', 'hand', `tool-button ${tool === 'pan' ? 'active' : ''}`, 'aria-label="Pan drawing" title="Pan (Space + drag or middle mouse)"')}${button('auto-dimensions', 'Auto dimensions', 'dimension', 'quiet', !part || busy ? 'disabled' : '')}${button('arrange-dimensions', 'Arrange', 'layers', 'quiet', !part || busy ? 'disabled title="Arrange dimension lines"' : 'title="Place smaller dimensions inside larger ones"')}<span class="toolbar-divider"></span><select id="measure-tool" aria-label="Add dimension" ${!part || busy ? 'disabled' : ''}>${option('select', 'Add dimension…', tool)}${option('horizontal', 'Horizontal', tool)}${option('vertical', 'Vertical', tool)}${option('aligned', 'Aligned', tool)}${option('diameter', 'Diameter', tool)}${option('radius', 'Radius', tool)}${option('angle', 'Angle', tool)}</select></div>
          <div class="tool-group">${button('undo', '', 'undo', 'icon-button', `aria-label="Undo" title="Undo (Ctrl/⌘ Z)" ${!history()?.canUndo ? 'disabled' : ''}`)}${button('redo', '', 'redo', 'icon-button', `aria-label="Redo" title="Redo (Ctrl/⌘ Shift Z)" ${!history()?.canRedo ? 'disabled' : ''}`)}<span class="toolbar-divider"></span>${button('fit', '', 'fit', 'icon-button', 'aria-label="Fit sheet" title="Fit sheet (0)"')}${button('zoom-out', '', 'minus', 'icon-button', 'aria-label="Zoom out" title="Zoom out (-)"')}<select id="zoom" aria-label="Sheet zoom">${zoomOptions()}</select>${button('zoom-in', '', 'plus', 'icon-button', 'aria-label="Zoom in" title="Zoom in (+)"')}</div>
        </div>
        <div class="canvas-area ${!['select', 'pan'].includes(tool) ? 'measuring' : ''}" id="canvas-area" tabindex="0" aria-label="Drawing canvas. Wheel to zoom, drag empty space to pan."><div class="drop-overlay">${icon('upload')}Drop STEP files to import</div><div id="paper-host"></div>${!part ? views.renderEmpty() : ''}</div>
        <div class="canvas-status"><span id="tool-hint">${e(canvasHint)}</span><span>${part ? `${state.settings.format} · ${state.settings.orientation} · mm` : 'STEP / STP · Multiple files supported'}</span></div>
      </main>
      <aside class="inspector" aria-label="Drawing properties">
        <div class="inspector-tabs" role="tablist">${['sheet', 'details', 'dimensions'].map((t) => `<button role="tab" aria-selected="${inspectorTab === t}" data-action="tab:${t}" class="${inspectorTab === t ? 'active' : ''}">${t === 'details' ? 'Title block' : t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div>
        <div class="inspector-body">${views.renderInspector()}</div>
        <div class="review-note">${icon('info')}<p><strong>Review before manufacture</strong>Automatic dimensions are a starting point. Confirm features, tolerances, fits and sections.</p></div>
      </aside>
    </div>
    <div id="busy-overlay" class="busy-overlay ${busy ? 'visible' : ''}" role="status" aria-live="polite"><div class="busy-card"><span class="spinner"></span><strong>${busyOperation === 'export' ? 'Exporting your PDF' : 'Preparing your drawing'}</strong><p id="progress-message">${e(progress)}</p>${busyOperation === 'import' ? button('cancel', 'Cancel', undefined, 'secondary') : ''}</div></div>
    <div id="toast" class="toast ${notification ? 'visible' : ''}" role="status" aria-live="polite">${e(notification)}</div>
    ${helpOpen ? views.renderHelp() : ''}`;
  if (retainedCanvas) app.querySelector('#canvas-area')!.replaceWith(retainedCanvas);
  const canvas = app.querySelector<HTMLElement>('#canvas-area')!;
  const empty = canvas.querySelector('.empty-workspace');
  if (part) empty?.remove();
  else if (!empty) canvas.insertAdjacentHTML('beforeend', views.renderEmpty());
  drawingCanvas.attach(canvas);
  drawingCanvas.setEnabled(!busy && !helpOpen);
  drawingCanvas.setTool(tool);
  renderPaper();
  updateCacheStatus();
}

function updateCacheStatus(): void {
  const status = app.querySelector('#title-block-cache-status');
  if (status)
    status.textContent = titleBlockCached
      ? 'Saved automatically in this browser and reused for your next drawing.'
      : 'Session only. Browser storage is unavailable. Save a project to keep these fields.';
}
function cacheTitleBlock(): void {
  titleBlockCached = saveTitleBlockCache(titleBlockStorage, state.settings);
  updateCacheStatus();
}

function renderPaper(): void {
  const part = active();
  const layout = part ? getPartLayout(part) : undefined;
  rendered = drawingCanvas.setDocument(
    part
      ? {
          part,
          dimensions: dims(),
          settings: state.settings,
          layout: layout!,
          selectedDimension,
        }
      : undefined,
  );
  if (!part || !rendered) {
    canvasHint = 'Drop STEP files anywhere in the workspace';
    return;
  }
  const stats = app.querySelector('#sheet-stats');
  const titleWarning = app.querySelector('#title-block-warning');
  if (titleWarning)
    titleWarning.innerHTML = rendered.warnings
      .filter((w) => /title block|shortened|technical note/i.test(w))
      .map((w) => `<p class="layout-warning">${e(w)}</p>`)
      .join('');
  const warning = app.querySelector('#dimension-layout-warning');
  if (warning)
    warning.innerHTML = rendered.warnings
      .filter((w) => w.startsWith('Dimensions exceed') || w.startsWith('The selected scale'))
      .map((w) => `<p class="layout-warning">${e(w)}</p>`)
      .join('');
  if (stats)
    stats.innerHTML = `<dl><dt>Views</dt><dd>4 · First angle</dd><dt>Sheet size</dt><dd>${rendered.width} × ${rendered.height} mm</dd><dt>Scale</dt><dd>${rendered.scale >= 1 ? `${+rendered.scale.toFixed(3)}:1` : `1:${+(1 / rendered.scale).toFixed(3)}`}</dd><dt>Dimensions</dt><dd>${dims().length}</dd></dl>${rendered.warnings.map((w) => `<p class="layout-warning">${e(w)}</p>`).join('')}`;
}

function updateProgress(): void {
  const el = document.querySelector('#progress-message');
  if (el) el.textContent = progress;
}
function setTool(value: CanvasTool): void {
  tool = value;
  selectedDimension = undefined;
  drawingCanvas.setTool(value);
  render();
}
function changeDimensions(next: Dimension[], arrange = false): void {
  history()?.record({ dimensions: dims(), layout: state.layouts[state.activeId!] });
  if (arrange) {
    delete state.layouts[state.activeId!];
    pendingArrangement.add(state.activeId!);
  }
  state.dimensions[state.activeId!] = next;
  render();
}

function controlSettingValue(
  control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  key: keyof DrawingSettings,
): string | number | boolean {
  if (control instanceof HTMLInputElement && control.type === 'checkbox') return control.checked;
  if (key === 'precision' || (key === 'scale' && control.value !== 'auto'))
    return Number(control.value);
  if (Object.hasOwn(titleBlockDefaults, key)) {
    const text = cleanTitleBlockText(control.value).slice(0, key === 'notes' ? 10000 : 1024);
    if (text !== control.value) control.value = text;
  }
  return control.value;
}
function syncSettingsFromControls(): void {
  for (const control of app.querySelectorAll<
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  >('[data-setting]')) {
    const key = control.dataset.setting as keyof DrawingSettings;
    (state.settings as any)[key] = controlSettingValue(control, key);
  }
  normalizeSheetOrientation();
  cacheTitleBlock();
}

function normalizeSheetOrientation(): void {
  const eskd = state.settings.template === 'eskd' || state.settings.template === 'eskd-uk';
  if (eskd && state.settings.format === 'A4') state.settings.orientation = 'portrait';
}

let paperUpdateTimer: ReturnType<typeof setTimeout> | undefined;
let dimensionInputSession: { element: HTMLInputElement; recorded: boolean } | undefined;
function updateDimensionControl(control: HTMLInputElement): void {
  const key = control.dataset.dimensionSetting as 'offset' | 'prefix' | 'suffix' | undefined;
  if (!key || !selectedDimension) return;
  const current = dims().find((d) => d.id === selectedDimension);
  if (!current) return;
  const value = key === 'offset' ? Number(control.value) : control.value.slice(0, 120);
  if (
    key === 'offset' &&
    (control.value === '' || !Number.isFinite(value) || Math.abs(Number(value)) > 1000)
  )
    return;
  if (current[key] === value) return;
  if (!dimensionInputSession || dimensionInputSession.element !== control)
    dimensionInputSession = { element: control, recorded: false };
  if (!dimensionInputSession.recorded) {
    history()?.record({ dimensions: dims(), layout: state.layouts[state.activeId!] });
    dimensionInputSession.recorded = true;
  }
  const next = structuredClone(dims()),
    dimension = next.find((d) => d.id === selectedDimension)!;
  if (key === 'offset') dimension.offset = Number(value);
  else dimension[key] = String(value);
  state.dimensions[state.activeId!] = next;
  clearTimeout(paperUpdateTimer);
  paperUpdateTimer = setTimeout(renderPaper, 80);
  const undo = app.querySelector<HTMLButtonElement>('[data-action="undo"]'),
    redo = app.querySelector<HTMLButtonElement>('[data-action="redo"]');
  if (undo) undo.disabled = false;
  if (redo) redo.disabled = true;
}

function toleranceFromControls(): DimensionTolerance | undefined {
  const dimension = dims().find((d) => d.id === selectedDimension);
  if (!dimension) throw new Error('Select a dimension first.');
  const mode = app.querySelector<HTMLSelectElement>('#tolerance-kind')?.value as ToleranceMode;
  const raw = (key: string) =>
    app.querySelector<HTMLInputElement>(`[data-tolerance-field="${key}"]`)?.value ?? '';
  const decimal = (key: string) => {
    const value = normalizeToleranceNumber(raw(key));
    if (value === undefined)
      throw new Error('Enter decimal deviations, for example 0.05 or -0.02.');
    return value;
  };
  if (mode === 'none') return undefined;
  if (mode === 'fit') {
    if (dimension.kind === 'angle') throw new Error('Fit designations apply to linear dimensions.');
    return parseDimensionTolerance({ kind: mode, designation: raw('designation').trim() });
  }
  return parseDimensionTolerance(
    mode === 'symmetric'
      ? { kind: mode, magnitude: decimal('magnitude') }
      : { kind: mode, upper: decimal('upper'), lower: decimal('lower') },
  );
}
function updateTolerancePreview(): void {
  const preview = app.querySelector('#tolerance-preview');
  if (!preview) return;
  const error = app.querySelector<HTMLElement>('#tolerance-error');
  if (error) error.hidden = true;
  const dimension = dims().find((d) => d.id === selectedDimension);
  try {
    const tolerance = toleranceFromControls();
    preview.textContent = dimension
      ? `Preview: ${formatDimension({ ...dimension, tolerance }, state.settings.precision)}`
      : '';
  } catch {
    preview.textContent = 'Enter the tolerance values, then choose Apply tolerance.';
  }
}
function applyTolerance(remove = false): void {
  const dimension = dims().find((d) => d.id === selectedDimension);
  if (!dimension) return;
  try {
    const tolerance = remove ? undefined : toleranceFromControls();
    if (JSON.stringify(tolerance) === JSON.stringify(dimension.tolerance)) return;
    const next = structuredClone(dims());
    const edited = next.find((d) => d.id === dimension.id)!;
    if (tolerance) edited.tolerance = tolerance;
    else delete edited.tolerance;
    changeDimensions(next);
    toast(
      tolerance ? 'Tolerance applied. The measured dimension is unchanged.' : 'Tolerance cleared.',
    );
  } catch (error) {
    const message = app.querySelector<HTMLElement>('#tolerance-error');
    if (message) {
      message.textContent = errorMessage(error);
      message.hidden = false;
    }
  }
}
app.addEventListener('focusout', (event) => {
  const control = event.target as HTMLInputElement;
  if (
    control.dataset.dimensionSetting === 'offset' &&
    (control.value === '' ||
      !Number.isFinite(Number(control.value)) ||
      Math.abs(Number(control.value)) > 1000)
  ) {
    const dimension = dims().find((d) => d.id === selectedDimension);
    if (dimension) control.value = dimension.offset.toFixed(1);
    toast('Use an offset between -1000 and 1000 mm.');
  }
  if (control.dataset.dimensionSetting) dimensionInputSession = undefined;
});
app.addEventListener('input', (event) => {
  const control = event.target as HTMLInputElement | HTMLTextAreaElement;
  if (control.dataset.toleranceField) {
    updateTolerancePreview();
    return;
  }
  if (control instanceof HTMLInputElement && control.dataset.dimensionSetting) {
    updateDimensionControl(control);
    return;
  }
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
          pendingArrangement.add(part.id);
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
      pendingArrangement.add(part.id);
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
      parts.map((part) => {
        const layout = getPartLayout(part);
        return {
          part,
          dimensions: state.dimensions[part.id] ?? [],
          settings: state.settings,
          layout,
        };
      }),
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
    for (const part of state.parts) getPartLayout(part);
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
    const savedOrientation = data.settings.orientation;
    state.parts = data.parts;
    state.settings = data.settings;
    normalizeSheetOrientation();
    state.dimensions = data.dimensions;
    state.layouts = savedOrientation === state.settings.orientation ? data.layouts : {};
    cacheTitleBlock();
    pendingArrangement.clear();
    layoutSettingsKey = JSON.stringify([
      state.settings.format,
      state.settings.orientation,
      state.settings.template,
      state.settings.scale,
    ]);
    drawingCanvas.cancel();
    state.activeId = state.parts[0].id;
    state.selected = new Set(data.selected);
    histories.clear();
    selectedDimension = undefined;
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
  inspectorTab = 'dimensions';
  changeDimensions([...dims(), d]);
  toast('Dimension added. Drag its label or line to adjust it.');
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
    } else if (action === 'clear-title-block') {
      Object.assign(state.settings, titleBlockDefaults);
      const cleared = clearTitleBlockCache(titleBlockStorage);
      titleBlockCached = cleared;
      render();
      toast(
        cleared
          ? 'Title block cleared. Ready for a new part.'
          : 'Title block cleared. Browser storage is unavailable.',
      );
    } else if (action === 'close-help') {
      helpOpen = false;
      render();
    } else if (action === 'export-pdf') void exportDrawing();
    else if (action === 'export-svg' && rendered)
      downloadBlob(
        new Blob(
          [
            renderDrawing(active()!, dims(), state.settings, undefined, getPartLayout(active()!))
              .svg,
          ],
          { type: 'image/svg+xml' },
        ),
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
      drawingCanvas.fit();
    } else if (action === 'zoom-in') drawingCanvas.zoomBy(1.25);
    else if (action === 'apply-tolerance') applyTolerance();
    else if (action === 'remove-tolerance') applyTolerance(true);
    else if (action === 'zoom-out') drawingCanvas.zoomBy(1 / 1.25);
    else if (action === 'auto-dimensions' && active()) {
      selectedDimension = undefined;
      drawingCanvas.cancel();
      changeDimensions(autoDimensions(active()!, autoDetail), true);
      toast('Automatic dimensions regenerated. Undo restores the previous set.');
    } else if (action === 'arrange-dimensions' && active()) {
      drawingCanvas.cancel();
      changeDimensions(dims(), true);
      toast('Dimension lines arranged from smaller to larger.');
    } else if (action === 'undo' || action === 'redo') {
      drawingCanvas.cancel();
      const snapshot = { dimensions: dims(), layout: state.layouts[state.activeId!] };
      const result = action === 'undo' ? history()?.undo(snapshot) : history()?.redo(snapshot);
      if (result) {
        pendingArrangement.delete(state.activeId!);
        state.dimensions[state.activeId!] = result.dimensions;
        if (result.layout) state.layouts[state.activeId!] = result.layout;
        else delete state.layouts[state.activeId!];
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
      tool = 'select';
      busy = false;
      render();
      toast('Import cancelled.');
    } else if (action.startsWith('tab:')) {
      inspectorTab = action.slice(4);
      render();
    } else if (action === 'tool:select') setTool('select');
    else if (action === 'tool:pan') setTool('pan');
    return;
  }
  const removeId = target.closest<HTMLElement>('[data-remove-part]')?.dataset.removePart;
  if (removeId) {
    state.parts = state.parts.filter((p) => p.id !== removeId);
    state.selected.delete(removeId);
    delete state.dimensions[removeId];
    delete state.layouts[removeId];
    pendingArrangement.delete(removeId);
    drawingCanvas.cancel();
    histories.delete(removeId);
    if (state.activeId === removeId) state.activeId = state.parts[0]?.id ?? null;
    selectedDimension = undefined;
    tool = 'select';
    render();
    return;
  }
  const partId = target.closest<HTMLElement>('[data-part-id]')?.dataset.partId;
  if (partId) {
    drawingCanvas.cancel();
    state.activeId = partId;
    selectedDimension = undefined;
    render();
    return;
  }
  const dimensionId =
    target.closest<HTMLElement>('[data-dimension-select]')?.dataset.dimensionSelect;
  if (dimensionId) {
    selectedDimension = dimensionId;
    inspectorTab = 'dimensions';
    tool = 'select';
    drawingCanvas.setTool('select');
    render();
  }
});

app.addEventListener('change', (event) => {
  const target = event.target as HTMLInputElement;
  if (target.id === 'tolerance-kind') {
    const dimension = dims().find((d) => d.id === selectedDimension);
    const fields = app.querySelector('#tolerance-fields');
    if (dimension && fields)
      fields.innerHTML = renderToleranceFields(target.value as ToleranceMode, dimension);
    const apply = app.querySelector<HTMLButtonElement>('[data-action="apply-tolerance"]');
    if (apply) apply.disabled = target.value === 'none' && !dimension?.tolerance;
    updateTolerancePreview();
    return;
  }
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
      drawingCanvas.cancel();
      changeDimensions(autoDimensions(active()!, autoDetail), true);
    }
    return;
  }
  if (target.id === 'zoom') {
    drawingCanvas.setZoom(Number(target.value));
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
    (state.settings as any)[key] = controlSettingValue(target, key);
    normalizeSheetOrientation();
    cacheTitleBlock();
    if (key === 'format' || key === 'template' || key === 'orientation') render();
    else renderPaper();
    const status = document.querySelector('.canvas-status > span:last-child');
    if (status && active())
      status.textContent = `${state.settings.format} · ${state.settings.orientation} · mm`;
    return;
  }
  if (target.dataset.dimensionSetting && selectedDimension) updateDimensionControl(target);
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
  if (event.key === 'Enter' && (event.target as HTMLElement)?.dataset.toleranceField) {
    event.preventDefault();
    applyTolerance();
    return;
  }
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
    drawingCanvas.cancel();
    setTool('select');
    return;
  }
  if (editing) return;
  if (event.code === 'Space') {
    event.preventDefault();
    drawingCanvas.setPanKey(true);
    return;
  }
  if (event.key === '+' || event.key === '=') {
    event.preventDefault();
    drawingCanvas.zoomBy(1.25);
    return;
  }
  if (event.key === '-') {
    event.preventDefault();
    drawingCanvas.zoomBy(1 / 1.25);
    return;
  }
  if (event.key === '0') {
    event.preventDefault();
    drawingCanvas.fit();
    return;
  }
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
window.addEventListener('keyup', (event) => {
  if (event.code === 'Space') drawingCanvas.setPanKey(false);
});
window.addEventListener('blur', () => drawingCanvas.setPanKey(false));
window.addEventListener('beforeunload', (event) => {
  if (state.parts.length) {
    event.preventDefault();
  }
});
render();
