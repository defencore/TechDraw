import type { Dimension, DimensionKind } from '../model';
import { formatDimensionLabel } from '../drawing/dimension-label';
import { button, option } from './components';
import { escapeHtml } from './utils';

export interface DimensionFilter {
  query: string;
  view: 'all' | 'front' | 'top' | 'right';
  kind: 'all' | DimensionKind;
}
export const defaultDimensionFilter: DimensionFilter = { query: '', view: 'all', kind: 'all' };

function searchable(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ø⌀∅φϕ]/gu, ' diameter ')
    .replace(/\bdia(?:meter)?\.?(?=\s|\d|$)/gu, 'diameter ')
    .replace(/−/gu, '-')
    .replace(/(?<=\d),(?=\d)/gu, '.')
    .replace(/\s+/gu, ' ')
    .trim();
}

/** Filtering changes list visibility only; it never modifies dimensions or selection. */
export function filterDimensions(
  dimensions: readonly Dimension[],
  filter: DimensionFilter,
  precision = 2,
): Dimension[] {
  const terms = searchable(filter.query).split(' ').filter(Boolean);
  return dimensions.filter((dimension) => {
    if (filter.view !== 'all' && dimension.viewId !== filter.view) return false;
    if (filter.kind !== 'all' && dimension.kind !== filter.kind) return false;
    const label = searchable(
      [
        formatDimensionLabel(dimension, precision).plainText,
        dimension.value,
        dimension.viewId,
        dimension.kind,
        dimension.automatic ? 'automatic' : 'manual',
      ].join(' '),
    );
    return terms.every((term) => label.includes(term));
  });
}

export function renderDimensionResults(
  dimensions: readonly Dimension[],
  selected: ReadonlySet<string>,
  focused: string | undefined,
  filter: DimensionFilter,
  precision: number,
): string {
  const visible = filterDimensions(dimensions, filter, precision);
  const visibleIds = new Set(visible.map((dimension) => dimension.id));
  const selectedCount = dimensions.filter((dimension) => selected.has(dimension.id)).length;
  const hiddenSelected = dimensions.filter(
    (dimension) => selected.has(dimension.id) && !visibleIds.has(dimension.id),
  ).length;
  const filtered = filter.query.trim() || filter.view !== 'all' || filter.kind !== 'all';
  return `<div class="dimension-browser-status" role="status"><span>${visible.length} of ${dimensions.length} dimensions${selectedCount ? ` · ${selectedCount} selected` : ''}</span>${filtered ? button('reset-dimension-filters', 'Clear filters', undefined, 'text-button') : ''}</div>
    ${hiddenSelected ? `<p class="dimension-filter-hidden">${hiddenSelected} selected ${hiddenSelected === 1 ? 'dimension is' : 'dimensions are'} hidden by filters. Group actions include them. ${button('reset-dimension-filters', 'Show all', undefined, 'text-button')}</p>` : ''}
    ${
      visible.length
        ? `<div class="dimension-list">${visible
            .map((dimension) => {
              const label = formatDimensionLabel(dimension, precision).plainText;
              return `<div class="dimension-list-item${selected.has(dimension.id) ? ' selected' : ''}${dimension.id === focused ? ' focused' : ''}"><input type="checkbox" data-dimension-check="${escapeHtml(dimension.id)}" aria-label="Select ${escapeHtml(label)} ${dimension.viewId} ${dimension.kind}" ${selected.has(dimension.id) ? 'checked' : ''}/><button class="dimension-row${dimension.id === focused ? ' active' : ''}" data-dimension-select="${escapeHtml(dimension.id)}" aria-pressed="${selected.has(dimension.id)}"><span>${escapeHtml(label)}<small>${dimension.viewId} · ${dimension.kind}</small></span><span class="dimension-origin" title="${dimension.automatic ? 'Automatic suggestion' : 'Manual dimension'}">${dimension.automatic ? 'A' : 'M'}</span></button></div>`;
            })
            .join('')}</div>`
        : `<div class="dimension-browser-empty"><strong>${dimensions.length ? 'No matching dimensions' : 'No dimensions yet'}</strong><p>${dimensions.length ? 'Change the search, view or type, or clear filters to show the full list.' : 'Choose a dimension tool in the drawing dock to add one.'}</p></div>`
    }`;
}

/** The result region can refresh while the search field and its caret remain mounted. */
export function renderDimensionBrowser(
  dimensions: readonly Dimension[],
  selected: ReadonlySet<string>,
  focused: string | undefined,
  filter: DimensionFilter,
  precision: number,
): string {
  return `<section class="dimension-browser" aria-label="Dimension browser">
    <label class="field dimension-search"><span>Find dimensions</span><input id="dimension-search" type="search" value="${escapeHtml(filter.query)}" maxlength="120" placeholder="Value, tolerance or note" autocomplete="off" aria-controls="dimension-browser-results"/></label>
    <div class="dimension-filters"><label class="field"><span>View</span><select id="dimension-filter-view" aria-controls="dimension-browser-results">${(['all', 'front', 'top', 'right'] as const).map((view) => option(view, view === 'all' ? 'All views' : view[0].toUpperCase() + view.slice(1), filter.view)).join('')}</select></label><label class="field"><span>Type</span><select id="dimension-filter-kind" aria-controls="dimension-browser-results">${(['all', 'horizontal', 'vertical', 'aligned', 'diameter', 'radius', 'angle'] as const).map((kind) => option(kind, kind === 'all' ? 'All types' : kind[0].toUpperCase() + kind.slice(1), filter.kind)).join('')}</select></label></div>
    <div id="dimension-browser-results" class="dimension-browser-results" aria-live="polite">${renderDimensionResults(dimensions, selected, focused, filter, precision)}</div>
  </section>`;
}
