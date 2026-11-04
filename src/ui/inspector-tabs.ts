import { t } from './i18n';
import { escapeHtml } from './utils';

export const INSPECTOR_TABS = [
  { id: 'dimensions', label: 'Dimensions' },
  { id: 'annotations', label: 'Markup' },
  { id: 'instructions', label: 'Instructions' },
  { id: 'manufacturing', label: 'Part type' },
  { id: 'sheet', label: 'Sheet' },
  { id: 'details', label: 'Title block' },
] as const;
export type InspectorTab = (typeof INSPECTOR_TABS)[number]['id'];

export function renderInspectorTabs(selected: string): string {
  return INSPECTOR_TABS.map(
    ({ id, label }) =>
      `<button type="button" id="inspector-tab-${id}" role="tab" aria-controls="inspector-panel" aria-selected="${selected === id}" tabindex="${selected === id ? 0 : -1}" data-action="tab:${id}" class="${selected === id ? 'active' : ''}">${escapeHtml(t(label))}</button>`,
  ).join('');
}

export function nextInspectorTab(current: string, key: string): InspectorTab | undefined {
  const index = INSPECTOR_TABS.findIndex((tab) => tab.id === current);
  if (index < 0) return;
  if (key === 'Home') return INSPECTOR_TABS[0].id;
  if (key === 'End') return INSPECTOR_TABS.at(-1)!.id;
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return;
  return INSPECTOR_TABS[
    (index + (key === 'ArrowLeft' ? -1 : 1) + INSPECTOR_TABS.length) % INSPECTOR_TABS.length
  ].id;
}
