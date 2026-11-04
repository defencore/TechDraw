import './style.css';
import './ui/workspace-cad.css';
import './ui/drawing-share.css';
import './ui/viewer.css';
import './ui/text-annotation-editor.css';
import './ui/gear-editor.css';
import './ui/part-type-editor.css';
import { createCadClient } from './cad/client';
import { WorkspaceFiles, drawingFileName } from './application/workspace-files';
import { WorkspaceSaveState } from './application/workspace-save-state';
import { refreshDimensionSuggestions } from './drawing/suggestions';
import { renderDrawingFeedback } from './ui/drawing-feedback';
import { ToleranceEditorController } from './ui/tolerance-controller';
import { TextAnnotationEditorController } from './ui/text-annotation-controller';
import { ManufacturingEditorController } from './ui/manufacturing-editor-controller';
import { WorkspaceViewState } from './ui/workspace-view-state';
import { nextInspectorTab, renderInspectorTabs } from './ui/inspector-tabs';
import { DimensionSelection } from './ui/dimension-selection';
import type { GridSettings } from './ui/drawing-grid';
import { isGridSpacing } from './drawing/grid-coordinates';
import { readGridPreferences, saveGridPreferences } from './ui/workspace-preferences';
import type { PlacementControls } from './ui/dimension-placement-editor';
import { applyDimensionPlacement, type PlacementSide } from './drawing/dimension-placement';
import { renderWorkspaceControls } from './ui/drawing-toolbar';
import {
  dimensionTools,
  getCommands,
  getCommand,
  findShortcutCommand,
  isEditingTarget,
  type CommandContext,
  type CommandId,
} from './ui/command-registry';
import { CommandPaletteController } from './ui/command-palette';
import { ContextMenuController } from './ui/context-menu';
import { defaultDimensionFilter, renderDimensionResults } from './ui/dimension-browser';
import { titleBlockDefaults, cleanTitleBlockText } from './drawing/title-block-data';
import {
  readTitleBlockCache,
  saveTitleBlockCache,
  clearTitleBlockCache,
} from './ui/title-block-cache';
import { renderDrawing } from './drawing/render';
import { DrawingCanvas, type CanvasTool } from './ui/drawing-canvas';
import type { Dimension, DrawingSettings, Point2 } from './model';
import { defaultSettings, type WorkspaceState } from './state';
import { WorkspaceDocument } from './workspace-document';
import { errorMessage } from './ui/error-message';
import { icon } from './ui/icons';
import { button, option, renderLockBadge } from './ui/components';
import { createWorkspaceViews } from './ui/views';
import { partDisplayLabel } from './ui/part-label';
import { downloadBlob, escapeHtml as e, readPreference, savePreference } from './ui/utils';
import {
  readLanguage,
  setLanguage,
  localizeUi,
  renderLanguageControl,
  renderProjectLink,
  t,
} from './ui/i18n';
import { DrawingShareController } from './ui/drawing-share';
import { CaptureRegionController } from './ui/capture-region';
import { browserScreenAwake } from './ui/screen-awake';
import { renderDrawingViewerControls } from './ui/viewer-controls';
import { renderMarkupGuide } from './ui/markup-guide';
import { DEFAULT_ANNOTATION_COLOR } from './drawing/annotation-style';
import { GRID_PRESETS } from './ui/grid-spacing-editor';
import type { DrawingAppearance } from './drawing/appearance';
import type { DrawingAnnotation } from './model';
import {
  renderAnnotationEditor,
  readAnnotationEdit,
  readAnnotationOptions,
} from './ui/annotation-editor';
import type { DxfUnit } from './io/dxf-import';

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
  annotations: {},
  instructions: {},
  description: '',
  layouts: {},
  settings: { ...defaultSettings, ...readTitleBlockCache(titleBlockStorage) },
};
setLanguage(readLanguage(titleBlockStorage), titleBlockStorage);
const workspaceDocument = new WorkspaceDocument(state);
const saveState = new WorkspaceSaveState(state);
const viewState = new WorkspaceViewState();
let titleBlockCached = saveTitleBlockCache(titleBlockStorage, state.settings);
let theme = readPreference<string>(
  'theme',
  matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
);
let inspectorTab = 'dimensions';
let workspaceMode: 'dimensions' | 'annotations' = 'dimensions';
let tool: CanvasTool = 'select';
const dimensionSelection = new DimensionSelection();
let grid = readGridPreferences(titleBlockStorage);
let customGrid = !GRID_PRESETS.some((spacing) => spacing === grid.spacing);
const placement: PlacementControls = { view: 'front', mode: 'cascade', gap: 7 };
let autoDetail: 'balanced' | 'full' = 'balanced';
const collapsedBranches = new Set<string>();
let canvasHint = 'Drop STEP files anywhere in the workspace';
let notification = '';
let toastTimer: ReturnType<typeof setTimeout>;
let rendered: ReturnType<typeof renderDrawing> | undefined;
let helpOpen = false;
let focusMode = false;
let viewerMode = false;
let viewerGeneration = 0;
let viewerFocusSnapshot = false;
let selectedAnnotation: string | undefined;
let lastShownPartId: string | null = null;
let drawingAppearance: 'auto' | DrawingAppearance = 'auto';
let exportAppearance: DrawingAppearance = 'paper';
let dxfUnit: DxfUnit | undefined;
const annotationOptions = {
  text: '',
  fontSize: 3.5,
  strokeWidth: 0.5,
  color: DEFAULT_ANNOTATION_COLOR,
};
const dimensionFilter = { ...defaultDimensionFilter };
const cad = createCadClient((message) => files.updateProgress(message));
const files = new WorkspaceFiles({
  document: workspaceDocument,
  cad,
  blocked: () => viewerMode,
  dxfUnit: () => dxfUnit,
  appearance: () => exportAppearance,
  changed: render,
  progressChanged: updateProgress,
  imported() {
    drawingCanvas.cancel();
    dimensionSelection.clear();
    selectedAnnotation = undefined;
    tool = 'select';
  },
  opened() {
    manufacturingEditors.clear();
    toleranceEditor.reset();
    const savedOrientation = state.settings.orientation;
    normalizeSheetOrientation();
    if (savedOrientation !== state.settings.orientation) state.layouts = {};
    cacheTitleBlock();
    drawingCanvas.cancel();
    dimensionSelection.clear();
    selectedAnnotation = undefined;
    tool = 'select';
  },
  saved: () => saveState.markSaved(state),
  report: toast,
  translate: (message) => t(message),
  download: downloadBlob,
  exampleUrl: `${import.meta.env.BASE_URL}examples/inspection-plate.dxf`,
});
const active = () => workspaceDocument.active;
const dims = () => workspaceDocument.dimensions;
const annotations = () => (state.activeId ? (state.annotations[state.activeId] ?? []) : []);
const instructions = (id = state.activeId) => (id ? (state.instructions[id] ?? '') : '');
const lockedSelectionCount = () =>
  dims().filter((item) => dimensionSelection.ids.has(item.id) && item.locked).length +
  Number(Boolean(annotations().find((item) => item.id === selectedAnnotation)?.locked));
const partHasLocks = (id: string) =>
  (state.dimensions[id] ?? []).some((item) => item.locked) ||
  (state.annotations[id] ?? []).some((item) => item.locked);
const hasLockedItems = () => workspaceDocument.hasLocks;
const screenAppearance = (): DrawingAppearance =>
  drawingAppearance === 'auto' ? (theme === 'dark' ? 'blueprint' : 'paper') : drawingAppearance;
const screenAwake = browserScreenAwake(() => updateViewerStatus());
const toleranceEditor = new ToleranceEditorController({
  getSelection() {
    const dimension = dims().find((item) => item.id === dimensionSelection.focus);
    return state.activeId && dimension ? { partId: state.activeId, dimension } : undefined;
  },
  precision: () => state.settings.precision,
  commit({ partId, dimension }, tolerance) {
    if (dimension.locked) {
      toast('Unlock the selection before editing or deleting it.');
      return;
    }
    const next = structuredClone(state.dimensions[partId]);
    const edited = next.find((item) => item.id === dimension.id)!;
    if (tolerance) edited.tolerance = tolerance;
    else delete edited.tolerance;
    changeDimensions(next);
    toast(
      tolerance ? 'Tolerance applied. The measured dimension is unchanged.' : 'Tolerance cleared.',
    );
  },
  reportError: toast,
});
const manufacturingEditors = new ManufacturingEditorController({
  document: workspaceDocument,
  busy: () => files.busy,
  render,
  refresh: refreshInspector,
  report: toast,
});

const drawingCanvas = new DrawingCanvas({
  selectAnnotation(id) {
    selectedAnnotation = id;
    if (id) {
      dimensionSelection.clear();
      inspectorTab = 'annotations';
      if (workspaceMode !== 'annotations') {
        workspaceMode = 'annotations';
        render();
        return;
      }
    }
    refreshInspector();
    renderPaper();
  },
  addAnnotation(annotation) {
    changeAnnotations([...annotations(), annotation]);
    selectedAnnotation = annotation.kind === 'freehand' ? undefined : annotation.id;
    tool = annotation.kind === 'freehand' ? 'freehand' : 'select';
    inspectorTab = 'annotations';
    workspaceMode = 'annotations';
    render();
  },
  editAnnotation(annotation) {
    changeAnnotations(annotations().map((item) => (item.id === annotation.id ? annotation : item)));
  },
  textAnnotation(request) {
    openTextNote(request.annotationId, request.point, [request.clientX, request.clientY]);
  },
  select(id, additive = false) {
    selectedAnnotation = undefined;
    dimensionSelection.select(id, additive);
    inspectorTab = 'dimensions';
    if (workspaceMode !== 'dimensions') {
      workspaceMode = 'dimensions';
      render();
      return;
    }
    refreshInspector();
  },
  selectMany(ids, additive) {
    const switchingMode = workspaceMode !== 'dimensions';
    selectedAnnotation = undefined;
    dimensionSelection.replace(additive ? [...dimensionSelection.ids, ...ids] : ids);
    setTool('select');
    inspectorTab = 'dimensions';
    workspaceMode = 'dimensions';
    if (switchingMode) {
      render();
      return;
    }
    refreshInspector();
    renderPaper();
  },
  contextMenu({ clientX, clientY }) {
    const selected = dimensionSelection.ids.size > 0;
    contextMenu.open(
      clientX,
      clientY,
      selectedAnnotation
        ? [
            'edit-dimension',
            'fit-selection',
            'toggle-selection-lock',
            'share-drawing',
            'delete-selected-dimensions',
            'command-palette',
          ]
        : selected
          ? [
              'edit-dimension',
              'fit-selection',
              'toggle-selection-lock',
              'place-dimensions:left',
              'place-dimensions:right',
              'place-dimensions:top',
              'place-dimensions:bottom',
              'clear-dimension-selection',
              'delete-selected-dimensions',
              'command-palette',
            ]
          : [
              'tool:select',
              'tool:box-select',
              'tool:horizontal',
              'tool:vertical',
              'tool:diameter',
              'fit',
              'command-palette',
            ],
      selectedAnnotation
        ? 'Annotation actions'
        : selected
          ? `${dimensionSelection.ids.size} selected`
          : 'Drawing actions',
    );
  },
  add: addDimension,
  edit(dimension) {
    changeDimensions(
      dims().map((d) => (d.id === dimension.id ? dimension : d)),
      false,
      true,
    );
  },
  editMany(dimensions) {
    const edits = new Map(dimensions.map((dimension) => [dimension.id, dimension]));
    changeDimensions(
      dims().map((dimension) => edits.get(dimension.id) ?? dimension),
      false,
      true,
    );
  },
  zoom() {
    const select = document.querySelector<HTMLSelectElement>('#zoom');
    if (select) select.innerHTML = zoomOptions();
    updateGridDensity();
  },
  hint(message) {
    const label = dimensionTools.find((item) => item.id === tool)?.label;
    canvasHint = active()
      ? `${label ? `${label} · ` : ''}${message}`
      : 'Drop STEP files anywhere in the workspace';
    const hint = document.querySelector('#tool-hint');
    if (hint) hint.textContent = t(canvasHint);
  },
  error: toast,
});
const textNoteEditor = new TextAnnotationEditorController({
  commit(session, annotation) {
    if (state.activeId !== session.partId || files.busy || viewerMode)
      throw new Error('The drawing changed. Close this editor and select the note again.');
    const current = session.annotation
      ? annotations().find((item) => item.id === session.annotation!.id)
      : undefined;
    if (
      session.annotation &&
      (!current || JSON.stringify(current) !== JSON.stringify(session.annotation))
    )
      throw new Error('The drawing changed. Close this editor and select the note again.');
    if (current?.locked) throw new Error('Unlock the note before editing it.');
    if (!drawingCanvas.canPlaceAnnotation(annotation))
      throw new Error(
        'This note does not fit at this position. Shorten it or reduce the text size.',
      );
    workspaceDocument.changeAnnotations(
      current
        ? annotations().map((item) => (item.id === current.id ? annotation : item))
        : [...annotations(), annotation],
    );
    annotationOptions.color = annotation.color!;
    annotationOptions.fontSize = annotation.fontSize!;
    annotationOptions.text = '';
    selectedAnnotation = annotation.id;
    tool = 'select';
    render();
    toast(session.annotation ? 'Note updated.' : 'Note added. Drag to move; click to edit.');
  },
  cancel() {
    tool = 'select';
    render();
  },
  closed() {
    drawingCanvas.setEnabled(!files.busy && !helpOpen && !textNoteEditor.isOpen);
    app.querySelector<HTMLElement>('#canvas-area')?.focus({ preventScroll: true });
  },
});

function openTextNote(id?: string, point?: Point2, client?: Point2): void {
  if (!state.activeId || files.busy || viewerMode || textNoteEditor.isOpen) return;
  const annotation = id ? annotations().find((item) => item.id === id) : undefined;
  if (id && (!annotation || annotation.kind !== 'text')) return;
  if (annotation?.locked) {
    toast('Unlock the note before editing it.');
    return;
  }
  const anchor = annotation?.points[0] ?? point;
  if (!anchor) return;
  selectedAnnotation = annotation?.id;
  dimensionSelection.clear();
  workspaceMode = 'annotations';
  inspectorTab = 'annotations';
  drawingCanvas.cancel();
  textNoteEditor.open({
    partId: state.activeId,
    point: anchor,
    client,
    annotation,
    options: { ...annotationOptions, text: '' },
  });
  drawingCanvas.setEnabled(false);
}
const controlsResize = new ResizeObserver(() => {
  measureCanvasControls();
  drawingCanvas.refreshViewport();
});
const imageShare = new DrawingShareController({
  drawing(appearance) {
    const part = active();
    if (!part) return;
    return {
      ...renderDrawing(part, dims(), state.settings, undefined, workspaceDocument.layout(part), {
        annotations: annotations(),
        instructions: instructions(),
        appearance,
      }),
      name: part.name,
    };
  },
  visible: () => drawingCanvas.getVisiblePaperBounds(),
  selection: () => drawingCanvas.getSelectionPaperBounds(),
  capture: startCapture,
  report: toast,
});
const captureRegion = new CaptureRegionController(
  (bounds) => {
    app.querySelector('.capture-cancel')?.remove();
    drawingCanvas.setEnabled(!files.busy && !helpOpen && !textNoteEditor.isOpen);
    imageShare.open(screenAppearance(), bounds);
  },
  () => {
    app.querySelector('.capture-cancel')?.remove();
    drawingCanvas.setEnabled(!files.busy && !helpOpen);
    renderPaper();
  },
);
const commandPalette = new CommandPaletteController({
  getCommands: () => getCommands(commandContext()),
  execute: (id) => runWorkspaceAction(id),
});
const contextMenu = new ContextMenuController({
  getCommands: () => getCommands(commandContext()),
  execute: (id) => runWorkspaceAction(id),
});
function commandContext(): CommandContext {
  return {
    busy: files.busy,
    importing: files.busy && files.kind !== 'pdf' && files.kind !== 'save',
    partCount: state.parts.length,
    hasActivePart: Boolean(active()),
    selectedPartCount: state.selected.size,
    selectionCount: dimensionSelection.ids.size,
    dimensionCount: dims().length,
    canUndo: Boolean(workspaceDocument.history?.canUndo),
    canRedo: Boolean(workspaceDocument.history?.canRedo),
    tool,
    gridVisible: grid.visible,
    gridSnap: grid.snap,
    focusMode,
    inspectorTab,
    helpOpen,
    viewerMode,
    annotationSelection: Boolean(selectedAnnotation),
    lockedCount: lockedSelectionCount(),
    keepAwake: screenAwake.enabled,
    nativeFullscreen: Boolean(document.fullscreenElement),
    nativeFullscreenAvailable: Boolean(document.fullscreenEnabled),
  };
}
function startCapture(): void {
  if (!active() || files.busy) return;
  drawingCanvas.cancel();
  drawingCanvas.setEnabled(false);
  captureRegion.startCapture();
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'capture-cancel secondary';
  button.textContent = t('Cancel capture');
  button.addEventListener('click', () => captureRegion.cancel());
  app.querySelector('.canvas-shell')?.append(button);
  toast('Drag over the drawing to capture an area. Press Escape to cancel.');
}

function changeAnnotations(next: DrawingAnnotation[]): void {
  if (workspaceDocument.changeAnnotations(next)) {
    if (!next.some((item) => item.id === selectedAnnotation)) selectedAnnotation = undefined;
    renderPaper();
    refreshInspector();
    updateUndoControls();
  }
}
function refreshDimensionBrowser(): void {
  const results = app.querySelector('#dimension-browser-results');
  if (results)
    results.innerHTML = renderDimensionResults(
      dims(),
      dimensionSelection.ids,
      dimensionSelection.focus,
      dimensionFilter,
      state.settings.precision,
    );
  if (results) localizeUi(results);
}
function updateSelectionActions(): void {
  const bar = app.querySelector<HTMLElement>('#selection-actions');
  if (!bar) return;
  const count = dimensionSelection.ids.size;
  const lockedCount = lockedSelectionCount();
  const lockCommand = getCommand('toggle-selection-lock', commandContext());
  const countLabel = `${count} selected${lockedCount ? ` · ${lockedCount} locked` : ''}`;
  const editLabel = count === 1 ? 'Edit' : 'Properties';
  bar.hidden = !count || files.busy;
  bar.innerHTML = count
    ? `<span class="selection-actions-count" title="${e(t(countLabel))}">${e(t(countLabel))}</span>${button('edit-dimension', editLabel, 'dimension', 'selection-action', `aria-label="${e(t(editLabel))}" title="${e(t(editLabel))}"`)}${button('fit-selection', 'Focus', 'fit', 'selection-action', 'title="Fit selected dimensions · F"')}${button('toggle-selection-lock', lockCommand?.label ?? 'Lock selection', lockCommand?.icon ?? 'lock', 'selection-action', `aria-label="${e(lockCommand?.label ?? t('Lock selection'))}" title="${e(lockCommand?.label ?? t('Lock selection'))}"`)}${button('delete-selected-dimensions', 'Delete', 'trash', 'selection-action destructive', `aria-label="${e(t('Delete'))}" title="${e(t(lockedCount ? 'Unlock the selection before editing or deleting it.' : 'Delete'))}"${lockedCount ? ' disabled' : ''}`)}${button('clear-dimension-selection', '', 'close', 'selection-action', 'aria-label="Clear dimension selection" title="Clear dimension selection"')}`
    : '';
  localizeUi(bar);
}
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
  viewState.capture(app);
  normalizeActiveViews();
  toleranceEditor.capture(app);
  const views = createWorkspaceViews({
    state,
    inspectorTab,
    selectedDimension: dimensionSelection.focus,
    selectedDimensionIds: dimensionSelection.ids,
    placement,
    dimensionFilter,
    autoDetail,
    collapsedBranches,
    annotationPanel: renderMarkupPanel,
    instructionsPanel: () => manufacturingEditors.renderInstructions(),
    manufacturingPanel: () => manufacturingEditors.renderParameters(),
    hasLockedItems: hasLockedItems(),
  });
  const body = app.querySelector('.inspector-body');
  if (body) {
    body.innerHTML = views.renderInspector();
    body.setAttribute('data-panel-view-key', JSON.stringify([state.activeId, inspectorTab]));
    body.setAttribute('aria-labelledby', `inspector-tab-${inspectorTab}`);
  }
  toleranceEditor.restore(app);
  updateCacheStatus();
  updateDrawingFeedback();
  updateSelectionActions();
  localizeUi(app);
  viewState.restore(app);
  measureCanvasControls();
  drawingCanvas.refreshViewport();
  for (const tab of app.querySelectorAll<HTMLElement>('.inspector-tabs [role="tab"]')) {
    const selected = tab.dataset.action === `tab:${inspectorTab}`;
    tab.classList.toggle('active', selected);
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }
}

function toast(message: string): void {
  notification = t(message);
  clearTimeout(toastTimer);
  document.querySelector('#toast')!.textContent = notification;
  document.querySelector('#toast')!.classList.add('visible');
  toastTimer = setTimeout(() => {
    notification = '';
    document.querySelector('#toast')?.classList.remove('visible');
  }, 5500);
}

function renderViewerControls(): string {
  return renderDrawingViewerControls({
    parts: state.parts,
    activeId: state.activeId,
    appearance: screenAppearance(),
    keepAwake: screenAwake.enabled,
    wakeStatus: screenAwake.status,
    wakeLabel: wakeStatusText(),
    fullscreenAvailable: Boolean(document.fullscreenEnabled),
    fullscreen: Boolean(document.fullscreenElement),
  });
}
function renderMarkupPanel(): string {
  const selected = annotations().find((item) => item.id === selectedAnnotation);
  return `${renderMarkupGuide({ tool, enabled: !files.busy && Boolean(active()), selected: Boolean(selected), selectedKind: selected?.kind })}${renderAnnotationEditor(selected, annotationOptions, tool)}<div class="annotation-list"><div class="section-label">ANNOTATIONS · ${annotations().length}</div>${annotations()
    .map(
      (item, index) =>
        `<button type="button" class="annotation-list-item ${item.id === selectedAnnotation ? 'active' : ''}" data-annotation-select="${e(item.id)}"><span>${e(item.kind)}</span><span data-user-content>${e(item.text?.split('\n')[0].slice(0, 45) || String(index + 1))}</span>${renderLockBadge(item.locked)}</button>`,
    )
    .join('')}</div>`;
}
function syncAnnotationSwatches(color: string): void {
  for (const swatch of app.querySelectorAll<HTMLElement>('[data-annotation-color]'))
    swatch.setAttribute(
      'aria-pressed',
      String(swatch.dataset.annotationColor === color.toLowerCase()),
    );
}
function wakeStatusText(): string {
  return t(
    {
      off: 'Screen lock off',
      requesting: 'Keeping screen awake…',
      active: 'Screen stays awake',
      paused: 'Screen lock paused · tap to retry',
      unavailable: 'Screen lock unavailable · tap to retry',
    }[screenAwake.status],
  );
}
function updateViewerStatus(): void {
  const status = app.querySelector<HTMLElement>('#viewer-awake');
  if (status) {
    status.textContent = wakeStatusText();
    status.dataset.status = screenAwake.status;
    status.title = wakeStatusText();
  }
  const button = app.querySelector('[data-action="toggle-wake-lock"]');
  button?.setAttribute('aria-pressed', String(screenAwake.enabled));
}
function enterViewer(): void {
  if (!active() || files.busy) return;
  viewerMode = true;
  clearTimeout(toastTimer);
  notification = '';
  viewerFocusSnapshot = focusMode;
  focusMode = false;
  selectedAnnotation = undefined;
  dimensionSelection.clear();
  tool = 'select';
  render();
  screenAwake.setActive(true);
  ++viewerGeneration;
}
function toggleNativeFullscreen(): void {
  if (!viewerMode) return;
  const generation = ++viewerGeneration;
  if (document.fullscreenElement) {
    void document
      .exitFullscreen()
      .catch(() => toast('System fullscreen is unavailable in this browser.'));
    return;
  }
  if (document.fullscreenEnabled && document.documentElement.requestFullscreen) {
    void document.documentElement
      .requestFullscreen()
      .then(() => {
        if (generation !== viewerGeneration || !viewerMode) {
          if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
          return;
        }
        updateNativeFullscreenControl();
      })
      .catch(() => {
        if (generation === viewerGeneration && viewerMode)
          toast('Viewer fills this browser. System fullscreen is unavailable.');
      });
  }
}
function updateNativeFullscreenControl(): void {
  const button = app.querySelector<HTMLElement>('[data-action="toggle-native-fullscreen"]');
  if (!button) return;
  const fullscreen = Boolean(document.fullscreenElement);
  const label = t(fullscreen ? 'Exit system fullscreen' : 'System fullscreen');
  button.setAttribute('aria-pressed', String(fullscreen));
  button.setAttribute('aria-label', label);
  button.title = label;
}
function exitViewer(): void {
  ++viewerGeneration;
  viewerMode = false;
  focusMode = viewerFocusSnapshot;
  screenAwake.setActive(false);
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  render();
}
function openExportOptions(): void {
  const dialog = document.createElement('dialog');
  dialog.className = 'export-options-dialog';
  dialog.innerHTML = `<form method="dialog"><div class="share-heading"><h2>Export drawing</h2><button class="icon-button" aria-label="Close">×</button></div></form><p class="share-message">PDF includes the checked parts. SVG exports the active part.</p><label>Appearance<select id="export-appearance">${option('paper', 'Paper · print ready', exportAppearance)}${option('blueprint', 'Blueprint · white on blue', exportAppearance)}</select></label><p class="share-message">Review annotations are included. Model measurements remain unchanged.</p><div class="share-actions">${button('export-svg', 'Save SVG', undefined, 'secondary')}${button('export-pdf', 'Save PDF', 'download', 'primary')}</div>`;
  dialog.addEventListener('close', () => dialog.remove());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) {
      dialog.close();
      return;
    }
    const action = (event.target as Element).closest<HTMLElement>('[data-action]')?.dataset.action;
    if (action === 'export-svg' || action === 'export-pdf') {
      exportAppearance = dialog.querySelector<HTMLSelectElement>('#export-appearance')!
        .value as DrawingAppearance;
      dialog.close();
      runWorkspaceAction(action);
    }
  });
  document.body.append(dialog);
  localizeUi(dialog);
  dialog.showModal();
}

function render(): void {
  viewState.capture(app);
  normalizeActiveViews();
  if (selectedAnnotation && !annotations().some((item) => item.id === selectedAnnotation))
    selectedAnnotation = undefined;
  toleranceEditor.capture(app);
  contextMenu.close(false);
  dimensionSelection.retain(dims().map((dimension) => dimension.id));
  document.documentElement.dataset.theme = theme;
  document.documentElement.classList.toggle('workshop-viewer', viewerMode);
  const retainedCanvas = app.querySelector<HTMLElement>('#canvas-area');
  const part = active();
  const views = createWorkspaceViews({
    state,
    inspectorTab,
    selectedDimension: dimensionSelection.focus,
    selectedDimensionIds: dimensionSelection.ids,
    placement,
    dimensionFilter,
    autoDetail,
    collapsedBranches,
    annotationPanel: renderMarkupPanel,
    instructionsPanel: () => manufacturingEditors.renderInstructions(),
    manufacturingPanel: () => manufacturingEditors.renderParameters(),
    hasLockedItems: hasLockedItems(),
  });
  app.innerHTML = `
    <header class="app-header">
      <a class="brand" href="./" aria-label="TechDraw home"><span class="brand-mark">${icon('dimension')}</span><span class="brand-wordmark"><strong>TechDraw<span class="brand-dot">.</span></strong><span class="brand-by">by DEFENCORE</span></span></a>
      <div class="header-right"><span class="local-pill">${icon('lock')}<span>Files stay on your device</span></span>${renderProjectLink()}${renderLanguageControl()}${button('command-palette', 'Commands <kbd>⌘ / Ctrl K</kbd>', 'search', 'command-search-trigger', 'aria-label="Search commands"')}${button('toggle-focus-mode', `<span class="focus-toggle-label">${focusMode ? 'Show panels' : 'Focus mode'}</span>`, focusMode ? 'panels' : 'expand', `quiet focus-mode-toggle${focusMode ? ' active' : ''}`, `aria-label="${focusMode ? 'Show panels' : 'Focus mode'}" title="Focus drawing · Shift+F" aria-pressed="${focusMode}"`)}${button('help', 'Quick guide', 'info', 'quiet help-button')}${button('theme', '', theme === 'light' ? 'moon' : 'sun', 'icon-button', `aria-label="Switch to ${theme === 'light' ? 'dark' : 'light'} theme" title="Switch theme"`)}</div>
    </header>
    <div class="workspace${focusMode ? ' focus-mode' : ''}">
      <aside class="files-panel" aria-label="Model files" data-panel-view-key="files">
        <div class="panel-title"><span>WORKSPACE</span><span class="count">${state.parts.length}</span></div>
        ${button('import', 'Import files', 'plus', 'import-button', files.busy ? 'disabled' : '')}
        <input id="file-input" type="file" accept=".step,.stp,.dxf" multiple hidden />
        <input id="project-input" type="file" accept=".zip,.json,.techdraw" hidden />
        <details class="import-settings"><summary>Import settings</summary><label>DXF units<select id="dxf-unit">${option('file', 'From file · mm if unset', dxfUnit ?? 'file')}${(['mm', 'cm', 'm', 'in', 'ft'] as const).map((unit) => option(unit, unit, dxfUnit ?? 'file')).join('')}</select></label></details>
        <div class="file-tools">${button('open-project', 'Open project', 'file', 'text-button')}${button('save-project', 'Save', 'download', 'text-button', !part ? 'disabled' : '')}</div>
        <div class="files-section-heading"><span>PARTS</span>${state.parts.length ? button('select-all', state.selected.size === state.parts.length ? 'Clear' : 'Select all', undefined, 'text-button small') : ''}</div>
        <div class="part-list" data-panel-view-key="parts">${views.renderParts()}</div>
        <details class="project-notes"><summary>Project description</summary><textarea id="project-description" data-user-content maxlength="10000" aria-label="Project description" placeholder="Notes for the engineer or customer">${e(state.description)}</textarea><p>Saved in the project archive with source files and editable drawing data.</p></details>
        <div class="sidebar-bottom"><div class="private-note">${icon('cube')}<div><strong>Real geometry. Local processing.</strong><p>STEP → CAD kernel → vector drawing.<br>No upload. No account.</p></div></div><a href="https://github.com/defencore/TechDraw" target="_blank" rel="noopener noreferrer">Source & documentation ${icon('arrow')}</a></div>
      </aside>
      <main class="drawing-workspace">
        ${focusMode ? `<div class="focus-mode-banner" role="status"><span>Focus mode is on</span>${button('toggle-focus-mode', 'Show panels', 'panels', 'text-button')}</div>` : ''}
        <div class="workspace-heading"><div><div class="eyebrow">DRAWING WORKSPACE</div><h1 ${part ? `data-user-content title="${e(part.name)}"` : ''}>${part ? e(partDisplayLabel(part.name)) : 'From solid to sheet'}</h1></div><div class="export-group">${button('view-drawing', 'View', 'expand', 'secondary compact', !part || files.busy ? 'disabled' : '')}${button('share-drawing', 'Copy image', 'copy', 'secondary compact', !part || files.busy ? 'disabled' : '')}${button('export-options', `Export${state.selected.size > 1 ? ` · ${state.selected.size}` : ''}`, 'download', 'primary', !state.selected.size || files.busy ? 'disabled' : '')}</div></div>
        <div id="workspace-feedback" role="status" aria-live="polite" hidden></div>
        <div class="canvas-shell"><div id="selection-actions" class="selection-actions" role="toolbar" aria-label="Selected dimension actions" hidden></div>${renderWorkspaceControls({ tool, mode: workspaceMode, enabled: Boolean(part) && !files.busy, canUndo: Boolean(workspaceDocument.history?.canUndo), canRedo: Boolean(workspaceDocument.history?.canRedo), zoomOptions: zoomOptions(), grid, customGrid })}
        <div class="canvas-area ${dimensionTools.some((item) => item.id === tool) ? 'measuring' : ''}" id="canvas-area" tabindex="0" aria-label="Drawing canvas. Wheel to zoom, drag empty space to pan."><div class="drop-overlay">${icon('upload')}Drop STEP files to import</div><div id="paper-host"></div>${!part ? views.renderEmpty() : ''}</div>
        </div><div class="canvas-status"><span id="tool-hint">${e(canvasHint)}</span><span>${part ? `${state.settings.format} · ${state.settings.orientation} · mm` : 'STEP / STP / DXF · Multiple files supported'}</span></div>
      </main>
      <aside class="inspector" aria-label="Drawing properties">
        <div class="inspector-tabs" role="tablist">${renderInspectorTabs(inspectorTab)}</div>
        <div class="inspector-body" id="inspector-panel" role="tabpanel" aria-labelledby="inspector-tab-${inspectorTab}" data-panel-view-key="${e(JSON.stringify([state.activeId, inspectorTab]))}">${views.renderInspector()}</div>
        <div class="review-note">${icon('info')}<p><strong>Review before manufacture</strong>Automatic dimensions are a starting point. Confirm features, tolerances, fits and sections.</p></div>
      </aside>
    </div>
    <div id="busy-overlay" class="busy-overlay ${files.busy ? 'visible' : ''}" role="status" aria-live="polite"><div class="busy-card"><span class="spinner"></span><strong>${files.kind === 'pdf' ? 'Exporting your PDF' : files.kind === 'save' ? 'Saving project archive…' : 'Preparing your drawing'}</strong><p id="progress-message">${e(files.message)}</p>${files.kind !== 'pdf' && files.kind !== 'save' ? button('cancel', 'Cancel', undefined, 'secondary') : ''}</div></div>
    <div id="toast" class="toast ${notification ? 'visible' : ''}" role="status" aria-live="polite">${e(notification)}</div>
    ${helpOpen ? views.renderHelp() : ''}${viewerMode ? renderViewerControls() : ''}`;
  if (retainedCanvas) app.querySelector('#canvas-area')!.replaceWith(retainedCanvas);
  const canvas = app.querySelector<HTMLElement>('#canvas-area')!;
  const empty = canvas.querySelector('.empty-workspace');
  if (part) empty?.remove();
  else if (!empty) canvas.insertAdjacentHTML('beforeend', views.renderEmpty());
  drawingCanvas.attach(canvas);
  captureRegion.attach(canvas);
  drawingCanvas.setEnabled(!files.busy && !helpOpen && !textNoteEditor.isOpen);
  drawingCanvas.setReadOnly(viewerMode);
  drawingCanvas.setAnnotationOptions(annotationOptions);
  drawingCanvas.setTool(tool);
  drawingCanvas.setGrid(viewerMode ? { ...grid, visible: false, snap: false } : grid);
  updateSelectionActions();
  localizeUi(app);
  measureCanvasControls();
  controlsResize.disconnect();
  for (const control of app.querySelectorAll<HTMLElement>(
    '.workspace-dock,#selection-actions,.viewer-controls,.grid-dock,.viewport-dock',
  ))
    controlsResize.observe(control);
  renderPaper();
  toleranceEditor.restore(app);
  updateCacheStatus();
  updateSelectionActions();
  localizeUi(app);
  viewState.restore(app);
  if (state.activeId !== lastShownPartId && !viewerMode) {
    lastShownPartId = state.activeId;
    if (matchMedia('(min-width: 961px)').matches)
      [...app.querySelectorAll<HTMLElement>('[data-part-id]')]
        .find((element) => element.dataset.partId === state.activeId)
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}

function measureCanvasControls(): void {
  const shell = app.querySelector<HTMLElement>('.canvas-shell');
  if (!shell) return;
  const bounds = shell.getBoundingClientRect();
  const toolbar = app.querySelector<HTMLElement>(
    viewerMode ? '.viewer-controls' : '.workspace-dock',
  );
  if (!toolbar || toolbar.getBoundingClientRect().height < 1) return;
  const nextRow = Math.max(0, toolbar.getBoundingClientRect().bottom - bounds.top + 8);
  shell.style.setProperty('--selection-top', `${nextRow}px`);
  const selection = app.querySelector<HTMLElement>('#selection-actions');
  const top = viewerMode
    ? nextRow
    : nextRow +
      Math.max(44, selection && !selection.hidden ? selection.getBoundingClientRect().height : 0) +
      8;
  const docks = [
    ...shell.querySelectorAll<HTMLElement>(
      viewerMode ? '.viewport-dock' : '.viewport-dock,.grid-dock',
    ),
  ];
  const bottom = Math.max(
    56,
    ...docks.map((dock) => bounds.bottom - dock.getBoundingClientRect().top + 8),
  );
  shell.style.setProperty('--canvas-top', `${Math.max(0, top)}px`);
  shell.style.setProperty('--canvas-bottom', `${bottom}px`);
}

function updateCacheStatus(): void {
  const status = app.querySelector('#title-block-cache-status');
  if (status)
    status.textContent = t(
      titleBlockCached
        ? 'Saved automatically in this browser and reused for your next drawing.'
        : 'Session only. Browser storage is unavailable. Save a project to keep these fields.',
    );
}
function cacheTitleBlock(): void {
  titleBlockCached = saveTitleBlockCache(titleBlockStorage, state.settings);
  updateCacheStatus();
}

function renderPaper(): void {
  const part = active();
  const layout = part ? workspaceDocument.layout(part) : undefined;
  rendered = drawingCanvas.setDocument(
    part
      ? {
          part,
          dimensions: dims(),
          settings: state.settings,
          layout: layout!,
          selectedDimension: dimensionSelection.focus,
          selectedDimensionIds: [...dimensionSelection.ids],
          annotations: annotations(),
          instructions: instructions(),
          selectedAnnotation,
          appearance: screenAppearance(),
        }
      : undefined,
  );
  if (!part || !rendered) {
    canvasHint = 'Drop STEP files anywhere in the workspace';
    updateDrawingFeedback();
    return;
  }
  const stats = app.querySelector('#sheet-stats');
  const titleWarning = app.querySelector('#title-block-warning');
  if (titleWarning)
    titleWarning.innerHTML = rendered.warnings
      .filter((w) => /title block|shortened|technical note/i.test(w))
      .map((w) => `<p class="layout-warning">${e(w)}</p>`)
      .join('');
  updateDrawingFeedback();
  if (stats)
    stats.innerHTML = `<dl><dt>Views</dt><dd>${part.sourceKind === 'dxf' ? '2D · DXF' : '4 · First angle'}</dd><dt>Sheet size</dt><dd>${rendered.width} × ${rendered.height} mm</dd><dt>Scale</dt><dd>${rendered.scale >= 1 ? `${+rendered.scale.toFixed(3)}:1` : `1:${+(1 / rendered.scale).toFixed(3)}`}</dd><dt>Dimensions</dt><dd>${dims().length}</dd></dl>${rendered.warnings.map((w) => `<p class="layout-warning">${e(w)}</p>`).join('')}`;
  localizeUi(app.querySelector('.inspector-body') ?? app);
}

function updateDrawingFeedback(): void {
  const warnings = active() ? (rendered?.warnings ?? []) : [];
  const feedback = app.querySelector<HTMLElement>('#workspace-feedback');
  if (feedback) {
    const signature = JSON.stringify(warnings);
    if (feedback.dataset.warnings !== signature) {
      feedback.innerHTML = renderDrawingFeedback(warnings);
      feedback.dataset.warnings = signature;
    }
    feedback.hidden = !warnings.length;
    localizeUi(feedback);
  }
  const dimensionWarning = app.querySelector('#dimension-layout-warning');
  if (dimensionWarning)
    dimensionWarning.innerHTML = warnings
      .filter(
        (warning) =>
          warning.startsWith('Dimensions exceed') || warning.startsWith('The selected scale'),
      )
      .map((warning) => `<p class="layout-warning">${e(warning)}</p>`)
      .join('');
}

function updateProgress(): void {
  const el = document.querySelector('#progress-message');
  if (el) el.textContent = t(files.message);
}
function setTool(value: CanvasTool): void {
  if (files.busy || (value !== 'select' && value !== 'pan' && !active())) return;
  drawingCanvas.cancel();
  tool = value;
  drawingCanvas.setTool(value);
  if (['text', 'arrow', 'rectangle', 'ellipse', 'freehand'].includes(value)) {
    selectedAnnotation = undefined;
    dimensionSelection.clear();
    inspectorTab = 'annotations';
    workspaceMode = 'annotations';
    render();
    if (matchMedia('(max-width: 960px)').matches)
      app.querySelector('#canvas-area')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    if (value === 'text') {
      app.querySelector<HTMLElement>('#canvas-area')?.focus({ preventScroll: true });
      toast('Click the drawing to choose where your note starts.');
    }
    return;
  }
  if (dimensionTools.some((item) => item.id === value)) {
    selectedAnnotation = undefined;
    const switchingMode = workspaceMode === 'annotations';
    workspaceMode = 'dimensions';
    dimensionSelection.clear();
    inspectorTab = 'dimensions';
    if (switchingMode) {
      render();
      return;
    }
    refreshInspector();
    renderPaper();
  }
  for (const control of app.querySelectorAll<HTMLButtonElement>('[data-action^="tool:"]')) {
    const selected = control.dataset.action === `tool:${value}`;
    control.classList.toggle('active', selected);
    control.setAttribute('aria-pressed', String(selected));
  }
}
function changeDimensions(next: Dimension[], arrange = false, preserveEditor = false): void {
  if (arrange && state.activeId && partHasLocks(state.activeId)) {
    toast('Unlock drawing items before changing the sheet layout.');
    return;
  }
  if (!workspaceDocument.changeDimensions(next, { arrange })) return;
  dimensionSelection.retain(next.map((dimension) => dimension.id));
  if (preserveEditor) {
    renderPaper();
    updateUndoControls();
    const offset = app.querySelector<HTMLInputElement>('[data-dimension-setting="offset"]');
    const dimension = next.find((d) => d.id === dimensionSelection.focus);
    if (offset && dimension) offset.value = dimension.offset.toFixed(1);
  } else render();
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
    if (hasLockedItems() && ['format', 'orientation', 'template', 'scale'].includes(key)) continue;
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
  if (!key || !dimensionSelection.focus) return;
  const current = dims().find((d) => d.id === dimensionSelection.focus);
  if (!current || current.locked) return;
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
    workspaceDocument.checkpoint();
    dimensionInputSession.recorded = true;
  }
  const next = structuredClone(dims()),
    dimension = next.find((d) => d.id === dimensionSelection.focus)!;
  if (key === 'offset') dimension.offset = Number(value);
  else dimension[key] = String(value);
  workspaceDocument.changeDimensions(next, { record: false });
  clearTimeout(paperUpdateTimer);
  paperUpdateTimer = setTimeout(renderPaper, 80);
  updateUndoControls();
}
function updateUndoControls(): void {
  const undo = app.querySelector<HTMLButtonElement>('[data-action="undo"]'),
    redo = app.querySelector<HTMLButtonElement>('[data-action="redo"]');
  if (undo) undo.disabled = !workspaceDocument.history?.canUndo;
  if (redo) redo.disabled = !workspaceDocument.history?.canRedo;
  commandPalette.update();
}

app.addEventListener('focusout', (event) => {
  const control = event.target as HTMLInputElement;
  if (
    control.dataset.dimensionSetting === 'offset' &&
    (control.value === '' ||
      !Number.isFinite(Number(control.value)) ||
      Math.abs(Number(control.value)) > 1000)
  ) {
    const dimension = dims().find((d) => d.id === dimensionSelection.focus);
    if (dimension) control.value = dimension.offset.toFixed(1);
    toast('Use an offset between -1000 and 1000 mm.');
  }
  if (control.dataset.dimensionSetting) dimensionInputSession = undefined;
});
app.addEventListener('submit', (event) => {
  if (manufacturingEditors.handleSubmit(app, (event.target as HTMLElement).id))
    event.preventDefault();
});
app.addEventListener('input', (event) => {
  const control = event.target as HTMLInputElement | HTMLTextAreaElement;
  if (control.id === 'dimension-search') {
    dimensionFilter.query = control.value.slice(0, 120);
    refreshDimensionBrowser();
    return;
  }
  if (control.id === 'grid-spacing') {
    const spacing = Number(control.value);
    if (control.value.trim() && isGridSpacing(spacing)) updateGrid({ ...grid, spacing });
    return;
  }
  if (control.id === 'placement-gap') {
    const gap = Number(control.value);
    if (control.value.trim() && Number.isFinite(gap) && gap >= 7 && gap <= 100) placement.gap = gap;
    return;
  }
  if (toleranceEditor.handleInput(control)) return;
  if (control instanceof HTMLInputElement && control.dataset.dimensionSetting) {
    updateDimensionControl(control);
    return;
  }
  if (!control.matches('input[data-setting]:not([type="checkbox"]),textarea[data-setting]')) return;
  syncSettingsFromControls();
  clearTimeout(paperUpdateTimer);
  paperUpdateTimer = setTimeout(renderPaper, 120);
});

function addDimension(d: Dimension): void {
  tool = 'select';
  dimensionSelection.replace([d.id]);
  inspectorTab = 'dimensions';
  changeDimensions([...dims(), d]);
  toast('Dimension added. Drag its label or line to adjust it.');
}

function updateGrid(next: GridSettings): void {
  grid = next;
  saveGridPreferences(grid, titleBlockStorage);
  drawingCanvas.setGrid(viewerMode ? { ...grid, visible: false, snap: false } : grid);
  updateGridDensity();
  for (const [action, value] of [
    ['toggle-grid', grid.visible],
    ['toggle-grid-snap', grid.snap],
  ] as const) {
    const control = app.querySelector<HTMLButtonElement>(`[data-action="${action}"]`);
    control?.classList.toggle('active', value);
    control?.setAttribute('aria-pressed', String(value));
  }
}

function updateGridDensity(): void {
  const label = app.querySelector<HTMLElement>('#grid-density');
  if (!label) return;
  const shown = drawingCanvas.gridDisplaySpacing;
  label.hidden = shown === undefined || shown <= grid.spacing + 1e-8;
  label.textContent = shown === undefined ? '' : t(`${Number(shown.toPrecision(6))} mm shown`);
  label.title = t(`Zoom in for finer grid lines. Snapping still uses ${grid.spacing} mm.`);
}

function placeSelectedDimensions(side: PlacementSide): void {
  const part = active();
  if (!part || !dimensionSelection.ids.size || files.busy) return;
  if (lockedSelectionCount()) {
    toast('Unlock the selection before editing or deleting it.');
    return;
  }
  const layout = workspaceDocument.layout(part);
  try {
    const result = applyDimensionPlacement(dims(), new Set(dimensionSelection.ids), part, layout, {
      side,
      mode: placement.mode,
      gap: placement.gap,
      gridSpacing: grid.snap ? grid.spacing : undefined,
      precision: state.settings.precision,
    });
    if (!result.placedIds.length) {
      toast(
        'Choose top or bottom for horizontal dimensions, left or right for vertical dimensions. Radius and diameter support any side.',
      );
      return;
    }
    const preview = renderDrawing(part, result.dimensions, state.settings, undefined, layout, {
      instructions: instructions(),
    });
    if (preview.warnings.some((warning) => warning.startsWith('Dimensions exceed'))) {
      toast(
        'This arrangement would leave the drawing frame. Use a smaller gap, another side or a larger sheet.',
      );
      return;
    }
    drawingCanvas.cancel();
    if (JSON.stringify(result.dimensions) === JSON.stringify(dims())) {
      toast('Selected dimensions are already in this arrangement.');
      return;
    }
    changeDimensions(result.dimensions);
    const skipped = result.unsupportedIds.length;
    toast(
      `${result.placedIds.length} dimensions ${placement.mode === 'align' ? 'aligned' : 'cascaded'} ${side}.${skipped ? ` ${skipped} are incompatible with this side; angles keep their position.` : ''} Undo restores their positions.`,
    );
  } catch (error) {
    toast(errorMessage(error));
  }
}

function refreshAutomaticDimensions(): void {
  const part = active();
  if (!part) return;
  const refreshed = refreshDimensionSuggestions(part, dims(), autoDetail);
  dimensionSelection.clear();
  drawingCanvas.cancel();
  changeDimensions(refreshed.dimensions, !partHasLocks(part.id));
  toast(
    'Automatic suggestions refreshed. Manual dimensions and specifications kept. Undo restores the previous set.',
  );
}

function openInspector(tab: string): void {
  if (tab === 'annotations' || tab === 'dimensions') workspaceMode = tab;
  if (tab === 'dimensions') selectedAnnotation = undefined;
  if (tab === 'annotations') dimensionSelection.clear();
  const annotationTool = ['text', 'arrow', 'rectangle', 'ellipse', 'freehand'].includes(tool);
  if (
    (tab !== 'annotations' && annotationTool) ||
    (tab === 'annotations' && dimensionTools.some((item) => item.id === tool))
  )
    tool = 'select';
  focusMode = false;
  inspectorTab = tab;
  render();
}
function normalizeActiveViews(): void {
  const part = active();
  if (!part) return;
  const available = part.views.filter((view) => view.id !== 'iso').map((view) => view.id);
  if (!available.includes(placement.view))
    placement.view = available[0] as PlacementControls['view'];
  if (dimensionFilter.view !== 'all' && !available.includes(dimensionFilter.view))
    dimensionFilter.view = 'all';
}
function deleteDimensions(ids: ReadonlySet<string>): void {
  if (!ids.size || !state.activeId) return;
  if (dims().some((item) => ids.has(item.id) && item.locked)) {
    toast('Unlock the selection before editing or deleting it.');
    return;
  }
  drawingCanvas.cancel();
  for (const id of ids) toleranceEditor.clearDimension(state.activeId, id);
  const next = dims().filter((dimension) => !ids.has(dimension.id));
  if (next.length === dims().length) return;
  changeDimensions(next);
  toast(`${ids.size} dimension${ids.size === 1 ? '' : 's'} deleted. Undo restores them.`);
}
function travelHistory(direction: 'undo' | 'redo'): void {
  drawingCanvas.cancel();
  if (workspaceDocument.travel(direction)) {
    manufacturingEditors.reconcileHistory();
    if (state.activeId) toleranceEditor.reconcilePart(state.activeId, dims());
    dimensionSelection.retain(dims().map((dimension) => dimension.id));
    if (!annotations().some((item) => item.id === selectedAnnotation))
      selectedAnnotation = undefined;
    render();
  }
}
const toolActions = Object.fromEntries(
  (
    [
      'select',
      'pan',
      'box-select',
      'text',
      'arrow',
      'rectangle',
      'ellipse',
      'freehand',
      ...dimensionTools.map((item) => item.id),
    ] as CanvasTool[]
  ).map((value) => [`tool:${value}`, () => setTool(value)]),
) as Record<`tool:${CanvasTool}`, () => void>;
const commandHandlers: Record<CommandId, () => void> = {
  ...toolActions,
  import: () => app.querySelector<HTMLInputElement>('#file-input')!.click(),
  'open-project': () => app.querySelector<HTMLInputElement>('#project-input')!.click(),
  'save-project': () => {
    void files.save();
  },
  'view-drawing': enterViewer,
  'toggle-native-fullscreen': toggleNativeFullscreen,
  'toggle-selection-lock': () => {
    const dimensions = new Set(dimensionSelection.ids);
    const annotationIds = new Set(selectedAnnotation ? [selectedAnnotation] : []);
    const count = dimensions.size + annotationIds.size;
    if (!count) return;
    const locked = lockedSelectionCount() !== count;
    if (workspaceDocument.setSelectionLocked({ dimensions, annotations: annotationIds }, locked))
      render();
  },
  'exit-viewer': exitViewer,
  'toggle-wake-lock': () => {
    screenAwake.setEnabled(!screenAwake.enabled);
    updateViewerStatus();
  },
  'share-drawing': () => imageShare.open(screenAppearance()),
  'capture-region': startCapture,
  'export-options': openExportOptions,
  demo: () => {
    void files.loadDemo();
  },
  'demo-dxf': () => {
    void files.loadDxfDemo();
  },
  'prepare-all-drawings': () => {
    void files.prepareAll();
  },
  'export-pdf': () => {
    void files.exportPdf();
  },
  'export-svg': () =>
    downloadBlob(
      new Blob(
        [
          renderDrawing(
            active()!,
            dims(),
            state.settings,
            undefined,
            workspaceDocument.layout(active()!),
            {
              annotations: annotations(),
              appearance: exportAppearance,
              instructions: instructions(),
            },
          ).svg,
        ],
        { type: 'image/svg+xml' },
      ),
      drawingFileName(active()!.name, 'svg'),
    ),
  'select-all': () => {
    state.selected =
      state.selected.size === state.parts.length
        ? new Set()
        : new Set(state.parts.map((part) => part.id));
    render();
  },
  'toggle-grid': () => updateGrid({ ...grid, visible: !grid.visible }),
  'toggle-grid-snap': () => updateGrid({ ...grid, snap: !grid.snap }),
  'select-view-dimensions': () => {
    drawingCanvas.cancel();
    dimensionSelection.replace(
      dims()
        .filter((dimension) => dimension.viewId === placement.view)
        .map((dimension) => dimension.id),
    );
    tool = 'select';
    openInspector('dimensions');
  },
  'select-all-dimensions': () => {
    drawingCanvas.cancel();
    dimensionSelection.replace(dims().map((dimension) => dimension.id));
    openInspector('dimensions');
  },
  'clear-dimension-selection': () => {
    drawingCanvas.cancel();
    dimensionSelection.clear();
    render();
  },
  'delete-selected-dimensions': () => {
    if (dimensionSelection.ids.size) deleteDimensions(new Set(dimensionSelection.ids));
    else if (selectedAnnotation) {
      if (lockedSelectionCount()) toast('Unlock the selection before editing or deleting it.');
      else changeAnnotations(annotations().filter((item) => item.id !== selectedAnnotation));
    }
  },
  'delete-dimension': () =>
    deleteDimensions(new Set(dimensionSelection.focus ? [dimensionSelection.focus] : [])),
  'edit-dimension': () => {
    if (selectedAnnotation) {
      if (annotations().find((item) => item.id === selectedAnnotation)?.kind === 'text') {
        openTextNote(selectedAnnotation);
        return;
      }
      openInspector('annotations');
      app
        .querySelector<HTMLElement>('.annotation-editor textarea,.annotation-editor input')
        ?.focus();
      return;
    }
    openInspector('dimensions');
    const details = app.querySelector<HTMLDetailsElement>('.focused-dimension-editor');
    if (details) details.open = true;
    app.querySelector<HTMLElement>('.dimension-editor')?.scrollIntoView({ block: 'nearest' });
    app
      .querySelector<HTMLElement>(
        '.dimension-editor input,.dimension-editor [role="radio"][tabindex="0"]',
      )
      ?.focus();
  },
  'place-dimensions:left': () => placeSelectedDimensions('left'),
  'place-dimensions:right': () => placeSelectedDimensions('right'),
  'place-dimensions:top': () => placeSelectedDimensions('top'),
  'place-dimensions:bottom': () => placeSelectedDimensions('bottom'),
  fit: () => drawingCanvas.fit(),
  'fit-selection': () => {
    drawingCanvas.fitSelection();
  },
  'zoom-in': () => drawingCanvas.zoomBy(1.25),
  'zoom-out': () => drawingCanvas.zoomBy(1 / 1.25),
  'auto-dimensions': refreshAutomaticDimensions,
  'arrange-dimensions': () => {
    if (state.activeId && partHasLocks(state.activeId)) {
      toast('Unlock drawing items before changing the sheet layout.');
      return;
    }
    drawingCanvas.cancel();
    changeDimensions(dims(), true);
    toast('Views and dimension labels arranged. All measurements and specifications kept.');
  },
  undo: () => travelHistory('undo'),
  redo: () => travelHistory('redo'),
  'toggle-focus-mode': () => {
    focusMode = !focusMode;
    render();
    toast(
      focusMode
        ? 'Focus mode is on. Panels are hidden. Use Show panels or Shift+F to return.'
        : 'Panels restored.',
    );
  },
  'command-palette': () => {
    contextMenu.close(false);
    commandPalette.open();
  },
  'tab:sheet': () => openInspector('sheet'),
  'tab:details': () => openInspector('details'),
  'tab:dimensions': () => openInspector('dimensions'),
  'tab:instructions': () => openInspector('instructions'),
  'tab:manufacturing': () => openInspector('manufacturing'),
  'tab:annotations': () => openInspector('annotations'),
  theme: () => {
    theme = theme === 'light' ? 'dark' : 'light';
    savePreference('theme', theme);
    render();
  },
  help: () => {
    helpOpen = true;
    render();
    app.querySelector<HTMLButtonElement>('[data-action="close-help"]')?.focus();
  },
  'close-help': () => {
    helpOpen = false;
    render();
  },
  'clear-title-block': () => {
    Object.assign(state.settings, titleBlockDefaults);
    titleBlockCached = clearTitleBlockCache(titleBlockStorage);
    render();
    toast(
      titleBlockCached
        ? 'Title block cleared. Ready for a new part.'
        : 'Title block cleared. Browser storage is unavailable.',
    );
  },
  cancel: () => files.cancel(),
};
function runWorkspaceAction(action: string): void {
  if (textNoteEditor.isOpen) return;
  if (captureRegion.active && action !== 'capture-region') captureRegion.cancel();
  if (action === 'language:en' || action === 'language:uk') {
    setLanguage(action === 'language:en' ? 'en' : 'uk', titleBlockStorage);
    render();
    return;
  }
  if (
    viewerMode &&
    ![
      'exit-viewer',
      'toggle-native-fullscreen',
      'toggle-wake-lock',
      'share-drawing',
      'capture-region',
      'export-options',
      'export-pdf',
      'export-svg',
      'zoom-in',
      'zoom-out',
      'fit',
      'theme',
      'command-palette',
      'tool:pan',
      'tool:select',
    ].includes(action)
  )
    return;
  const command = getCommand(action, commandContext());
  if (!command) return;
  if (!command.enabled) {
    if (command.disabledReason) toast(command.disabledReason);
    return;
  }
  syncSettingsFromControls();
  if (
    [
      'save-project',
      'export-pdf',
      'export-svg',
      'share-drawing',
      'capture-region',
      'prepare-all-drawings',
    ].includes(command.id)
  ) {
    try {
      manufacturingEditors.flush();
    } catch (error) {
      toast(errorMessage(error));
      return;
    }
  }
  commandHandlers[command.id]();
}

app.addEventListener('click', (event) => {
  const target = event.target as Element;
  if (manufacturingEditors.handleClick(app, target)) {
    event.preventDefault();
    return;
  }
  syncSettingsFromControls();
  if (target.closest('#viewer-awake')) {
    screenAwake.retry();
    return;
  }
  const annotationColor =
    target.closest<HTMLElement>('[data-annotation-color]')?.dataset.annotationColor;
  if (annotationColor) {
    const input = app.querySelector<HTMLInputElement>('#annotation-color');
    if (input) input.value = annotationColor;
    syncAnnotationSwatches(annotationColor);
    if (!selectedAnnotation) {
      try {
        Object.assign(annotationOptions, readAnnotationOptions(app, annotationOptions));
        drawingCanvas.setAnnotationOptions(annotationOptions);
      } catch (error) {
        toast(errorMessage(error));
      }
    }
    return;
  }
  const annotationAction = target.closest<HTMLElement>('[data-annotation-action]')?.dataset
    .annotationAction;
  if (annotationAction === 'lock') {
    runWorkspaceAction('toggle-selection-lock');
    return;
  }
  if (annotationAction === 'edit-text' && selectedAnnotation) {
    openTextNote(selectedAnnotation);
    return;
  }
  if (annotationAction && selectedAnnotation) {
    const selected = annotations().find((item) => item.id === selectedAnnotation);
    if (!selected) return;
    if (selected.locked) {
      toast('Unlock the selection before editing or deleting it.');
      return;
    }
    try {
      if (annotationAction === 'delete')
        changeAnnotations(annotations().filter((item) => item.id !== selected.id));
      else if (annotationAction === 'apply') {
        const edited = readAnnotationEdit(app, selected);
        changeAnnotations(annotations().map((item) => (item.id === edited.id ? edited : item)));
      }
    } catch (error) {
      toast(errorMessage(error));
    }
    return;
  }
  const annotationId = target.closest<HTMLElement>('[data-annotation-select]')?.dataset
    .annotationSelect;
  if (annotationId) {
    selectedAnnotation = annotationId;
    dimensionSelection.clear();
    tool = 'select';
    inspectorTab = 'annotations';
    workspaceMode = 'annotations';
    render();
    if (annotations().find((item) => item.id === annotationId)?.kind === 'text')
      openTextNote(annotationId);
    return;
  }
  if (toleranceEditor.handleClick(target)) return;
  if (target.classList.contains('modal-backdrop')) {
    helpOpen = false;
    render();
    return;
  }
  const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
  if (action === 'reset-dimension-filters') {
    Object.assign(dimensionFilter, defaultDimensionFilter);
    refreshInspector();
    return;
  }
  if (action) {
    runWorkspaceAction(action);
    return;
  }
  const removeId = target.closest<HTMLElement>('[data-remove-part]')?.dataset.removePart;
  if (removeId) {
    if (partHasLocks(removeId)) {
      toast('Unlock drawing items before removing this part.');
      return;
    }
    toleranceEditor.clearPart(removeId);
    manufacturingEditors.clearPart(removeId);
    drawingCanvas.cancel();
    files.removePart(removeId);
    dimensionSelection.clear();
    selectedAnnotation = undefined;
    tool = 'select';
    render();
    return;
  }
  const partId = target.closest<HTMLElement>('[data-part-id]')?.dataset.partId;
  if (partId) {
    drawingCanvas.cancel();
    state.activeId = partId;
    dimensionSelection.clear();
    selectedAnnotation = undefined;
    render();
    return;
  }
  const dimensionId =
    target.closest<HTMLElement>('[data-dimension-select]')?.dataset.dimensionSelect;
  if (dimensionId) {
    selectedAnnotation = undefined;
    workspaceMode = 'dimensions';
    dimensionSelection.select(dimensionId, event.shiftKey || event.ctrlKey || event.metaKey);
    inspectorTab = 'dimensions';
    tool = 'select';
    drawingCanvas.setTool('select');
    render();
  }
});

app.addEventListener('change', (event) => {
  const target = event.target as HTMLInputElement;
  if (manufacturingEditors.handleChange(app, target)) return;
  if (target.id === 'dxf-unit') {
    dxfUnit = target.value === 'file' ? undefined : (target.value as DxfUnit);
    return;
  }
  if (target.id === 'viewer-part') {
    state.activeId = target.value;
    selectedAnnotation = undefined;
    dimensionSelection.clear();
    render();
    return;
  }
  if (target.id === 'viewer-appearance') {
    drawingAppearance = target.value as DrawingAppearance;
    renderPaper();
    return;
  }
  if (target.dataset.annotationSetting) {
    if (target.id === 'annotation-color') syncAnnotationSwatches(target.value);
    if (!selectedAnnotation) {
      try {
        Object.assign(annotationOptions, readAnnotationOptions(app, annotationOptions));
        drawingCanvas.setAnnotationOptions(annotationOptions);
      } catch (error) {
        toast(errorMessage(error));
      }
    }
    return;
  }
  if (target.id === 'dimension-filter-view' || target.id === 'dimension-filter-kind') {
    if (target.id === 'dimension-filter-view')
      dimensionFilter.view = target.value as typeof dimensionFilter.view;
    else dimensionFilter.kind = target.value as typeof dimensionFilter.kind;
    refreshDimensionBrowser();
    return;
  }
  if (target.dataset.dimensionCheck) {
    selectedAnnotation = undefined;
    workspaceMode = 'dimensions';
    drawingCanvas.cancel();
    dimensionSelection.set(target.dataset.dimensionCheck, target.checked);
    inspectorTab = 'dimensions';
    tool = 'select';
    render();
    return;
  }
  if (target.id === 'placement-view') {
    placement.view = target.value as PlacementControls['view'];
    return;
  }
  if (target.id === 'placement-mode') {
    placement.mode = target.value as PlacementControls['mode'];
    return;
  }
  if (target.id === 'placement-gap') {
    const gap = Number(target.value);
    if (target.value.trim() && Number.isFinite(gap) && gap >= 7 && gap <= 100) placement.gap = gap;
    else toast('Enter a minimum gap from 7 to 100 mm on paper.');
    target.value = String(placement.gap);
    return;
  }
  if (target.id === 'grid-preset') {
    if (target.value === 'custom') {
      customGrid = true;
      render();
      const input = app.querySelector<HTMLInputElement>('#grid-spacing');
      input?.focus();
      input?.select();
    } else {
      const spacing = Number(target.value);
      if (GRID_PRESETS.some((preset) => preset === spacing)) {
        customGrid = false;
        updateGrid({ ...grid, spacing });
        render();
      }
    }
    return;
  }
  if (target.id === 'grid-spacing') {
    const spacing = Number(target.value);
    if (target.value.trim() && isGridSpacing(spacing)) updateGrid({ ...grid, spacing });
    else toast('Enter a grid step from 0.1 to 100 mm on paper.');
    target.value = String(grid.spacing);
    return;
  }
  if (target.id === 'file-input') {
    void files.importFiles(Array.from(target.files ?? []));
    target.value = '';
    return;
  }
  if (target.id === 'project-input') {
    const file = target.files?.[0];
    if (file) void files.open(file);
    target.value = '';
    return;
  }
  if (target.id === 'auto-detail') {
    autoDetail = target.value as typeof autoDetail;
    if (active()) {
      refreshAutomaticDimensions();
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
    if (hasLockedItems() && ['format', 'orientation', 'template', 'scale'].includes(key)) {
      toast('Unlock drawing items before changing the sheet layout.');
      render();
      return;
    }
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
  if (target.dataset.dimensionSetting && dimensionSelection.focus) updateDimensionControl(target);
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
  if (event.dataTransfer && !viewerMode && !textNoteEditor.isOpen)
    void files.importFiles([...event.dataTransfer.files]);
});
window.addEventListener('keydown', (event) => {
  if (event.defaultPrevented || commandPalette.isOpen) return;
  if (document.querySelector('dialog[open]')) return;
  const tab = (event.target as Element)?.closest<HTMLElement>('.inspector-tabs [role="tab"]');
  if (tab && !event.altKey && !event.ctrlKey && !event.metaKey) {
    const next = nextInspectorTab(tab.dataset.action?.slice(4) ?? '', event.key);
    if (next) {
      event.preventDefault();
      const command = getCommand(`tab:${next}`, commandContext());
      if (command?.enabled) {
        runWorkspaceAction(command.id);
        app.querySelector<HTMLElement>(`#inspector-tab-${next}`)?.focus({ preventScroll: true });
      }
      return;
    }
  }
  if (toleranceEditor.handleKeydown(event)) return;
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
  const editing = isEditingTarget(event.target);
  if (event.key === 'Escape') {
    event.preventDefault();
    if (captureRegion.active) {
      captureRegion.cancel();
      return;
    }
    if (viewerMode && document.fullscreenElement) {
      toggleNativeFullscreen();
      return;
    }
    if (viewerMode) {
      exitViewer();
      return;
    }
    if (helpOpen) {
      helpOpen = false;
      render();
      return;
    }
    if (editing) {
      const input = event.target as HTMLInputElement;
      if (input.id === 'dimension-search') {
        input.value = '';
        dimensionFilter.query = '';
        refreshDimensionBrowser();
      } else (event.target as HTMLElement)?.blur();
      return;
    }
    drawingCanvas.cancel();
    if (tool !== 'select') setTool('select');
    else if (dimensionSelection.ids.size || selectedAnnotation) {
      dimensionSelection.clear();
      selectedAnnotation = undefined;
      render();
    } else if (focusMode) {
      focusMode = false;
      render();
    }
    return;
  }
  if (helpOpen) return;
  const shortcut = findShortcutCommand(event, commandContext());
  if (shortcut) {
    event.preventDefault();
    runWorkspaceAction(shortcut.id);
    return;
  }
  if (editing) return;
  if (event.code === 'Space') {
    const target = event.target as Element;
    if (
      target !== document.body &&
      target !== document.documentElement &&
      !target.closest('#canvas-area')
    )
      return;
    event.preventDefault();
    drawingCanvas.setPanKey(true);
  }
});
window.addEventListener('keyup', (event) => {
  if (event.code === 'Space') drawingCanvas.setPanKey(false);
});
window.addEventListener('blur', () => drawingCanvas.setPanKey(false));
document.addEventListener('visibilitychange', () => screenAwake.visibilityChanged());
window.addEventListener('resize', measureCanvasControls);
document.addEventListener('fullscreenchange', () => {
  updateNativeFullscreenControl();
});
window.addEventListener('pagehide', () => screenAwake.setActive(false));
window.addEventListener('pageshow', () => {
  if (viewerMode) screenAwake.setActive(true);
});
app.addEventListener('input', (event) => {
  const input = event.target as HTMLInputElement;
  if (manufacturingEditors.handleInput(app, input)) return;
  if (input.id === 'project-description') state.description = input.value.slice(0, 10000);
  if (input.id === 'annotation-color') syncAnnotationSwatches(input.value);
  if (input.dataset.annotationSetting && !selectedAnnotation) {
    try {
      Object.assign(annotationOptions, readAnnotationOptions(app, annotationOptions));
      drawingCanvas.setAnnotationOptions(annotationOptions);
    } catch {
      /* Incomplete values remain editable. */
    }
  }
});
window.addEventListener('beforeunload', (event) => {
  if (
    state.parts.length &&
    (saveState.hasChanges(state) ||
      manufacturingEditors.hasPendingChanges() ||
      toleranceEditor.hasPendingChanges(state.dimensions) ||
      textNoteEditor.hasPendingChanges)
  ) {
    event.preventDefault();
  }
});
render();
