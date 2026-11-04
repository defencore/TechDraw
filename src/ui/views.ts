import type { WorkspaceState } from '../state';
import type { Part } from '../model';
import { button, option } from './components';
import { icon } from './icons';
import { escapeHtml as e } from './utils';
import { renderTitleBlockEditor } from './title-block-editor';
import { renderDimensionEditor } from './dimension-editor';
import { STANDARD_DRAWING_SCALES } from '../drawing/page-layout';
import { formatDimensionLabel } from '../drawing/dimension-label';
import {
  renderDimensionPlacementEditor,
  type PlacementControls,
} from './dimension-placement-editor';

interface ViewContext {
  state: WorkspaceState;
  inspectorTab: string;
  selectedDimension?: string;
  selectedDimensionIds: ReadonlySet<string>;
  placement: PlacementControls;
  autoDetail: 'balanced' | 'full';
  collapsedBranches: Set<string>;
}

export function createWorkspaceViews({
  state,
  inspectorTab,
  selectedDimension,
  selectedDimensionIds,
  placement,
  autoDetail,
  collapsedBranches,
}: ViewContext) {
  const active = () => state.parts.find((p) => p.id === state.activeId);
  const dims = () => (state.activeId ? (state.dimensions[state.activeId] ?? []) : []);
  function partRow(p: Part): string {
    return `<div class="part-row ${p.id === state.activeId ? 'active' : ''}"><input type="checkbox" data-part-check="${e(p.id)}" aria-label="Include ${e(p.name)} in PDF" ${state.selected.has(p.id) ? 'checked' : ''}/><button class="part-select" data-part-id="${e(p.id)}" title="${e(p.path.join(' / '))}">${icon('cube')}<span><strong>${e(p.name)}</strong><small>${p.bounds.max.map((v, i) => Math.abs(v - p.bounds.min[i]).toFixed(1)).join(' × ')} mm</small></span></button><button class="part-remove" data-remove-part="${e(p.id)}" aria-label="Remove ${e(p.name)}" title="Remove part">${icon('close')}</button></div>`;
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
      return `<div class="empty-files">${icon('layers')}<p>Your parts will appear here.</p><span>Import a STEP file or try the example.</span></div>`;
    const sources = [...new Set(state.parts.map((p) => p.sourceName))];
    return sources
      .map(
        (source) =>
          `<section class="source-group"><div class="source-name" title="${e(source)}">${icon('file')}${e(source)}</div>${assemblyTree(
            state.parts.filter((p) => p.sourceName === source),
            1,
            source,
          )}</section>`,
      )
      .join('');
  }

  function renderEmpty(): string {
    return `<div class="empty-workspace"><div class="empty-illustration" aria-hidden="true"><div class="mini-sheet"><div class="mini-cross"></div><svg viewBox="0 0 200 140"><g fill="none" stroke="currentColor" stroke-width="1.2"><path d="M28 25h65v38H28zM28 80h65v28H28zM118 25h28v38h-28zM123 92l30-17 29 17v26l-29 17-30-17V92l30 17 29-17m-29 17v26"/><circle cx="60" cy="44" r="9"/><circle cx="60" cy="94" r="9"/><path d="M28 17h65M28 13v9m65-9v9M20 25v38m-4-38h9m-9 38h9" stroke-width=".7"/></g></svg><div class="mini-title"></div></div></div><div class="eyebrow">PRECISION STARTS WITH GEOMETRY</div><h2>Your next drawing starts here.</h2><p>Turn STEP models into clear technical drawings.<br>Four projections, editable dimensions, ready-to-share PDFs.</p><div class="empty-actions">${button('import', 'Choose STEP files', 'upload', 'primary')}${button('demo', 'Try an example', 'arrow', 'secondary')}</div><span class="empty-caption">Processed entirely in your browser with Open CASCADE.</span></div>`;
  }

  function renderInspector(): string {
    const s = state.settings,
      part = active(),
      dimension = dims().find((d) => d.id === selectedDimension);
    const scales: number[] = [...STANDARD_DRAWING_SCALES];
    if (typeof s.scale === 'number' && !scales.includes(s.scale)) scales.push(s.scale);
    scales.sort((a, b) => a - b);
    if (inspectorTab === 'sheet')
      return `<div class="section-label">PAGE SETUP</div><div class="field-row"><label class="field"><span>Format</span><select data-setting="format">${['A4', 'A3', 'A2', 'A1'].map((x) => option(x, x, s.format)).join('')}</select></label><label class="field"><span>Orientation</span><select data-setting="orientation">${s.format === 'A4' && (s.template === 'eskd' || s.template === 'eskd-uk') ? '<option value="landscape" disabled>Landscape (use ISO or Minimal)</option>' : option('landscape', 'Landscape', s.orientation)}${option('portrait', 'Portrait', s.orientation)}</select></label></div><label class="field"><span>Drawing template</span><select data-setting="template">${option('eskd', 'ESKD · GOST 2.104-68 · English', s.template)}${option('eskd-uk', 'ESKD · GOST 2.104-68 · Ukrainian', s.template)}${option('iso', 'ISO style', s.template)}${option('minimal', 'Minimal', s.template)}</select></label><p class="field-help">First-angle projection. ESKD templates use Form 1 (185 × 55 mm) with 20 mm left and 5 mm other frame margins. Use A4 portrait for the standard A4 arrangement. Drawing scale controls printed size; Zoom inspects details.</p><div class="field-row"><label class="field"><span>Drawing scale</span><select data-setting="scale">${option('auto', 'Auto fit', s.scale)}${scales.map((x) => option(x, x >= 1 ? `${x}:1` : `1:${+(1 / x).toFixed(3)}`, s.scale)).join('')}</select></label><label class="field"><span>Decimal places</span><select data-setting="precision">${[0, 1, 2, 3, 4, 5, 6].map((x) => option(x, String(x), s.precision)).join('')}</select></label></div><div class="inspector-rule"></div><div class="section-label">DISPLAY</div><label class="switch-row"><span>Hidden edges</span><input type="checkbox" data-setting="hiddenLines" ${s.hiddenLines ? 'checked' : ''}/></label><label class="switch-row"><span>Center lines</span><input type="checkbox" data-setting="centerLines" ${s.centerLines ? 'checked' : ''}/></label><label class="field"><span>Automatic dimension detail</span><select id="auto-detail">${option('balanced', 'Balanced', autoDetail)}${option('full', 'All baseline coordinates', autoDetail)}</select></label><p class="field-help">Refreshes automatic suggestions while keeping manual dimensions and specifications. Undo restores the previous set.</p><div class="inspector-rule"></div><div class="section-label">CURRENT SHEET</div><div id="sheet-stats" class="sheet-stats">${part ? 'Generating layout…' : 'Import a part to create a sheet.'}</div><p class="field-help">One selected part per PDF page. Use the checkboxes in the parts list to create a drawing set.</p>`;
    if (inspectorTab === 'details')
      return `${renderTitleBlockEditor(s, part?.name)}${part?.warnings.length ? `<div class="geometry-note"><strong>Import notes</strong>${part.warnings.map((w) => `<p>${e(w)}</p>`).join('')}</div>` : ''}`;
    const editor = dimension ? renderDimensionEditor(dimension, s.precision) : '';
    return `<div class="dimension-heading"><span class="section-label">DIMENSIONS <b>${dims().length}</b></span></div>${renderDimensionPlacementEditor(dims(), selectedDimensionIds, placement)}${selectedDimensionIds.size === 1 ? editor : ''}<div id="dimension-layout-warning" aria-live="polite"></div><p class="field-help dimension-selection-help">Use checkboxes or Shift / Ctrl-click to select a group. Drag a selected dimension to move the group.</p><div class="dimension-list">${dims()
      .map(
        (d) =>
          `<div class="dimension-list-item ${selectedDimensionIds.has(d.id) ? 'selected' : ''}"><input type="checkbox" data-dimension-check="${e(d.id)}" aria-label="Select ${e(formatDimensionLabel(d, s.precision).plainText)} ${d.viewId} ${d.kind}" ${selectedDimensionIds.has(d.id) ? 'checked' : ''}/><button class="dimension-row ${d.id === selectedDimension ? 'active' : ''}" data-dimension-select="${e(d.id)}" aria-pressed="${selectedDimensionIds.has(d.id)}"><span>${e(formatDimensionLabel(d, s.precision).plainText)}<small>${d.viewId} · ${d.kind}</small></span><span class="dimension-origin" title="${d.automatic ? 'Automatic suggestion' : 'Manual dimension'}">${d.automatic ? 'A' : 'M'}</span></button></div>`,
      )
      .join(
        '',
      )}</div>${selectedDimensionIds.size > 1 && editor ? `<details class="focused-dimension-editor"><summary>Edit focused dimension</summary>${editor}</details>` : ''}<div class="inspector-rule"></div><div class="section-label">ADD A DIMENSION</div><p class="field-help">Click Horizontal, Vertical, Aligned, Diameter, Radius or Angle above the sheet. Pick a straight edge or two snap points in the same orthographic view, then move the preview and click to place it. For a radius or diameter, click a circular edge. For an angle, click two straight edges.</p>`;
  }

  function renderHelp(): string {
    return `<div class="modal-backdrop"><section class="help-dialog" role="dialog" aria-modal="true" aria-labelledby="help-title"><div class="dialog-heading"><h2 id="help-title">From STEP to a drawing set</h2>${button('close-help', '', 'close', 'icon-button', 'aria-label="Close guide"')}</div><ol><li><strong>Import your model</strong><p>Choose one or more STEP files. Each solid becomes a selectable part. Assembly occurrences keep their placement; product names are recovered where available.</p></li><li><strong>Choose your sheet</strong><p>Select parts for export, a paper format, orientation and template. Front, right, top and isometric views are generated from CAD geometry.</p></li><li><strong>Review and dimension</strong><p>Automatic suggestions cover overall sizes, recognized circular features and orthogonal steps. Add missing dimensions using the tools. Click to place a new dimension, then drag its label or line to move it. Wheel zooms under the cursor; Space + drag or the hand tool pans the sheet. Select a group with the list checkboxes or Shift/Ctrl-click; use the side buttons to align or cascade it. Below the sheet, toggle Grid (G) and Snap (S), and enter a step in paper millimetres. Hold Alt while dragging for free placement.</p></li><li><strong>Complete the specification</strong><p>Set material, tolerances and technical notes. STEP geometry does not define manufacturing intent: threads, fits, surface finish, datum systems and sections require engineering review.</p></li><li><strong>Export vector PDF</strong><p>Each checked part is a separate page. Print at 100% / actual size to preserve the indicated scale. Save a project to keep editable work.</p></li></ol><p class="guide-footnote">ESKD frames use GOST 2.104-68 Form 1. Other ESKD requirements, including manufacturing specifications and approvals, must be completed for the drawing. Imported curves are displayed with a controlled approximation; dimensions use CAD geometry. No model files leave this browser.</p>${button('close-help', 'Start drawing', 'arrow', 'primary')}</section></div>`;
  }

  return { renderParts, renderEmpty, renderInspector, renderHelp };
}
