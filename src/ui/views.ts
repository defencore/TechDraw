import type { WorkspaceState } from '../state';
import type { Part, ViewId } from '../model';
import { button, option } from './components';
import { icon } from './icons';
import { t } from './i18n';
import { escapeHtml as e } from './utils';
import { partDisplayLabel } from './part-label';
import { renderTitleBlockEditor } from './title-block-editor';
import { renderDimensionEditor } from './dimension-editor';
import { STANDARD_DRAWING_SCALES } from '../drawing/page-layout';
import { renderDimensionBrowser, type DimensionFilter } from './dimension-browser';
import {
  renderDimensionPlacementEditor,
  type PlacementControls,
} from './dimension-placement-editor';

interface ViewContext {
  state: WorkspaceState;
  inspectorTab: string;
  selectedDimension?: string;
  selectedDimensionIds: ReadonlySet<string>;
  dimensionFilter: DimensionFilter;
  placement: PlacementControls;
  autoDetail: 'balanced' | 'full';
  collapsedBranches: Set<string>;
  annotationPanel?: () => string;
  instructionsPanel?: () => string;
  manufacturingPanel?: () => string;
  hasLockedItems?: boolean;
}

export function createWorkspaceViews({
  state,
  inspectorTab,
  selectedDimension,
  selectedDimensionIds,
  dimensionFilter,
  placement,
  autoDetail,
  collapsedBranches,
  annotationPanel,
  instructionsPanel,
  manufacturingPanel,
  hasLockedItems = false,
}: ViewContext) {
  const active = () => state.parts.find((p) => p.id === state.activeId);
  const dims = () => (state.activeId ? (state.dimensions[state.activeId] ?? []) : []);
  function partRow(p: Part): string {
    return `<div class="part-row ${p.id === state.activeId ? 'active' : ''}"><input type="checkbox" data-part-check="${e(p.id)}" aria-label="Include ${e(p.name)} in PDF" ${state.selected.has(p.id) ? 'checked' : ''}/><button class="part-select" data-part-id="${e(p.id)}" title="${e(p.path.join(' / '))}">${icon('cube')}<span><strong>${e(partDisplayLabel(p.name))}</strong><small>${p.bounds.max.map((v, i) => Math.abs(v - p.bounds.min[i]).toFixed(1)).join(' × ')} mm</small></span></button><button class="part-remove" data-remove-part="${e(p.id)}" aria-label="Remove ${e(p.name)}" title="Remove part">${icon('close')}</button></div>`;
  }
  function assemblyTree(parts: Part[], depth: number, source: string): string {
    const leaves = parts.filter((p) => p.path.length <= depth + 1);
    const branches = new Map<string, Part[]>();
    for (const p of parts.filter((p) => p.path.length > depth + 1)) {
      const key = p.path[depth];
      branches.set(key, [...(branches.get(key) ?? []), p]);
    }
    return (
      leaves.map(partRow).join('') +
      [...branches]
        .map(([name, children]) => {
          const key = JSON.stringify([source, ...children[0].path.slice(1, depth + 1)]);
          return `<details class="assembly-branch" data-tree-path="${e(key)}" ${collapsedBranches.has(key) ? '' : 'open'}><summary title="${e(name)}">${icon('chevron')}${e(name)}<span>${children.length}</span></summary><div>${assemblyTree(children, depth + 1, source)}</div></details>`;
        })
        .join('')
    );
  }
  function renderParts(): string {
    if (!state.parts.length)
      return `<div class="empty-files">${icon('layers')}<p>Your parts will appear here.</p><span>Import a STEP or DXF file or try an example.</span></div>`;
    const sources = [...new Set(state.parts.map((p) => p.sourceName))];
    const drawingsAction =
      state.parts.length > 1
        ? `<div class="parts-drawing-action">${button('prepare-all-drawings', 'Drawings for all parts', 'layers', 'secondary compact')}<p>Prepare sheets for every imported part.</p></div>`
        : '';
    return (
      drawingsAction +
      sources
        .map(
          (source) =>
            `<section class="source-group"><div class="source-name" title="${e(source)}">${icon('file')}${e(source)}</div>${assemblyTree(
              state.parts.filter((p) => p.sourceName === source),
              1,
              source,
            )}</section>`,
        )
        .join('')
    );
  }

  function renderEmpty(): string {
    return `<div class="empty-workspace"><div class="empty-illustration" aria-hidden="true"><div class="mini-sheet"><div class="mini-cross"></div><svg viewBox="0 0 200 140"><g fill="none" stroke="currentColor" stroke-width="1.2"><path d="M28 25h65v38H28zM28 80h65v28H28zM118 25h28v38h-28zM123 92l30-17 29 17v26l-29 17-30-17V92l30 17 29-17m-29 17v26"/><circle cx="60" cy="44" r="9"/><circle cx="60" cy="94" r="9"/><path d="M28 17h65M28 13v9m65-9v9M20 25v38m-4-38h9m-9 38h9" stroke-width=".7"/></g></svg><div class="mini-title"></div></div></div><div class="eyebrow">PRECISION STARTS WITH GEOMETRY</div><h2>Your next drawing starts here.</h2><p>Turn STEP and DXF models into clear technical drawings.<br>3D projections or a 2D drawing, editable dimensions, ready-to-share PDFs.</p><div class="empty-actions">${button('import', 'Choose STEP or DXF files', 'upload', 'primary')}${button('demo', 'Try an example', 'arrow', 'secondary')}${button('demo-dxf', 'Try DXF example', 'file', 'text-button')}</div><span class="empty-caption">Files are processed on your device.</span></div>`;
  }

  function renderInspector(): string {
    const s = state.settings,
      part = active(),
      dimension = dims().find((d) => d.id === selectedDimension);
    const layoutDisabled = hasLockedItems ? ' disabled' : '';
    const scales: number[] = [...STANDARD_DRAWING_SCALES];
    if (typeof s.scale === 'number' && !scales.includes(s.scale)) scales.push(s.scale);
    scales.sort((a, b) => a - b);
    if (inspectorTab === 'sheet')
      return `<div class="section-label">PAGE SETUP</div>${hasLockedItems ? '<p class="locked-item-notice">Unlock drawing items before changing the sheet layout.</p>' : ''}<div class="field-row"><label class="field"><span>Format</span><select data-setting="format"${layoutDisabled}>${['A4', 'A3', 'A2', 'A1'].map((x) => option(x, x, s.format)).join('')}</select></label><label class="field"><span>Orientation</span><select data-setting="orientation"${layoutDisabled}>${s.format === 'A4' && (s.template === 'eskd' || s.template === 'eskd-uk') ? '<option value="landscape" disabled>Landscape (use ISO or Minimal)</option>' : option('landscape', 'Landscape', s.orientation)}${option('portrait', 'Portrait', s.orientation)}</select></label></div><label class="field"><span>Drawing template</span><select data-setting="template"${layoutDisabled}>${option('eskd', 'ESKD · GOST 2.104-68 · English', s.template)}${option('eskd-uk', 'ESKD · GOST 2.104-68 · Ukrainian', s.template)}${option('iso', 'ISO style', s.template)}${option('minimal', 'Minimal', s.template)}</select></label><p class="field-help">${part?.sourceKind === 'dxf' ? '2D drawing from DXF. No depth or additional projections are inferred. Drawing scale controls printed size; Zoom inspects details.' : 'First-angle projection. ESKD templates use Form 1 (185 × 55 mm) with 20 mm left and 5 mm other frame margins. Use A4 portrait for the standard A4 arrangement. Drawing scale controls printed size; Zoom inspects details.'}</p><div class="field-row"><label class="field"><span>Drawing scale</span><select data-setting="scale"${layoutDisabled}>${option('auto', 'Auto fit', s.scale)}${scales.map((x) => option(x, x >= 1 ? `${x}:1` : `1:${+(1 / x).toFixed(3)}`, s.scale)).join('')}</select></label><label class="field"><span>Decimal places</span><select data-setting="precision">${[0, 1, 2, 3, 4, 5, 6].map((x) => option(x, String(x), s.precision)).join('')}</select></label></div><div class="inspector-rule"></div><div class="section-label">DISPLAY</div><label class="switch-row"><span>Hidden edges</span><input type="checkbox" data-setting="hiddenLines" ${s.hiddenLines ? 'checked' : ''}/></label><label class="switch-row"><span>Center lines</span><input type="checkbox" data-setting="centerLines" ${s.centerLines ? 'checked' : ''}/></label><label class="field"><span>Automatic dimension detail</span><select id="auto-detail">${option('balanced', 'Balanced', autoDetail)}${option('full', 'All baseline coordinates', autoDetail)}</select></label><p class="field-help">Refreshes automatic suggestions while keeping manual dimensions and specifications. Undo restores the previous set.</p><div class="inspector-rule"></div><div class="section-label">CURRENT SHEET</div><div id="sheet-stats" class="sheet-stats">${part ? 'Generating layout…' : 'Import a part to create a sheet.'}</div><p class="field-help">One selected part per PDF page. Use the checkboxes in the parts list to create a drawing set.</p>`;
    if (inspectorTab === 'details')
      return `${renderTitleBlockEditor(s, part?.name)}${part?.sourceNotes?.length ? `<details class="source-notes"><summary>DXF source notes</summary><p class="field-help">DXF notes are reference text from the source file, not measured geometry.</p>${part.sourceNotes.map((note) => `<p data-user-content>${e(note)}</p>`).join('')}</details>` : ''}${part?.warnings.length ? `<div class="geometry-note"><strong>Import notes</strong>${part.warnings.map((w) => `<p>${e(w)}</p>`).join('')}</div>` : ''}`;
    if (inspectorTab === 'annotations') return annotationPanel?.() ?? '';
    if (inspectorTab === 'instructions') return instructionsPanel?.() ?? '';
    if (inspectorTab === 'manufacturing') return manufacturingPanel?.() ?? '';
    const selectedCount = dims().filter((item) => selectedDimensionIds.has(item.id)).length;
    const lockedCount = dims().filter(
      (item) => selectedDimensionIds.has(item.id) && item.locked,
    ).length;
    const editor = dimension
      ? renderDimensionEditor(dimension, s.precision, { count: selectedCount, lockedCount })
      : '';
    const availableViews = part?.views
      .filter((view) => view.id !== 'iso')
      .map((view) => view.id as Exclude<ViewId, 'iso'>) ?? ['front', 'top', 'right'];
    const arrangement = renderDimensionPlacementEditor(
      dims(),
      selectedDimensionIds,
      placement,
      availableViews,
    );
    const browser = renderDimensionBrowser(
      dims(),
      selectedDimensionIds,
      selectedDimension,
      dimensionFilter,
      s.precision,
      availableViews,
    );
    const warning = '<div id="dimension-layout-warning" aria-live="polite"></div>';
    const help =
      '<details class="dimension-tool-help"><summary>Dimension tools</summary><p class="field-help">Choose Horizontal, Vertical, Aligned, Diameter, Radius or Angle in the drawing dock. Pick an edge or snap points, move the preview and click to place. Radius and diameter use circular edges; angles use two straight edges.</p></details>';
    if (!selectedCount)
      return `<p class="dimension-selection-tip">Select a dimension on the sheet to edit it, or use the list below. Checkboxes and Shift / Ctrl-click build a group.</p>${warning}${browser}${arrangement}${help}`;
    if (selectedCount === 1) return `${editor}${arrangement}${warning}${browser}${help}`;
    return `<div class="dimension-selection-summary"><div><strong>${selectedCount} dimensions selected</strong>${lockedCount ? `<p class="selection-lock-count">${e(t('{count} locked', { count: lockedCount }))}</p>` : '<p class="field-help">Drag a selected dimension to move the group, or arrange it by side.</p>'}</div>${button('clear-dimension-selection', 'Clear', undefined, 'text-button', 'aria-label="Clear dimension selection"')}</div>${arrangement}${warning}${browser}${editor ? `<details class="focused-dimension-editor"><summary>Edit focused dimension</summary>${editor}</details>` : ''}${help}`;
  }

  function renderHelp(): string {
    return `<div class="modal-backdrop"><section class="help-dialog" role="dialog" aria-modal="true" aria-labelledby="help-title"><div class="dialog-heading"><h2 id="help-title">From STEP to a drawing set</h2>${button('close-help', '', 'close', 'icon-button', 'aria-label="Close guide"')}</div><ol><li><strong>Import your model</strong><p>Choose one or more STEP or DXF files. STEP solids become selectable parts; DXF contains a 2D drawing. Source units are converted to millimetres.</p></li><li><strong>Choose your sheet</strong><p>Select parts for export, a paper format, orientation and template. STEP parts have front, right, top and isometric views. DXF preserves its 2D view.</p></li><li><strong>Review and dimension</strong><p>Automatic suggestions cover overall sizes, recognized circular features and orthogonal steps. Add missing dimensions using the tools. Click to place a new dimension, then drag its label or line to move it. Wheel zooms under the cursor; Space + drag or the hand tool pans the sheet. Select a group with the list checkboxes or Shift/Ctrl-click; use the side buttons to align or cascade it. Below the sheet, toggle Grid (G) and Snap (S), and enter a step in paper millimetres. Hold Alt while dragging for free placement.</p></li><li><strong>Complete the specification</strong><p>Set material, tolerances and technical notes. STEP geometry does not define manufacturing intent: threads, fits, surface finish, datum systems and sections require engineering review.</p></li><li><strong>Export vector PDF</strong><p>Each checked part is a separate page. Print at 100% / actual size to preserve the indicated scale. Save a project to keep editable work.</p></li></ol><p class="guide-footnote">ESKD frames use GOST 2.104-68 Form 1. Other ESKD requirements, including manufacturing specifications and approvals, must be completed for the drawing. Imported curves are displayed with a controlled approximation; dimensions use CAD geometry. No model files leave this browser.</p>${button('close-help', 'Start drawing', 'arrow', 'primary')}</section></div>`;
  }

  return { renderParts, renderEmpty, renderInspector, renderHelp };
}
