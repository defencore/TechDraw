import { icon } from './icons';
import { t } from './i18n';
import { escapeHtml as e } from './utils';
import { button } from './components';

interface MarkupGuideContext {
  tool: string;
  enabled: boolean;
  selected?: boolean;
}

const tools = [
  ['text', 'Text', 'Add text', 'text'],
  ['arrow', 'Arrow', 'Add arrow', 'arrow'],
  ['rectangle', 'Rectangle', 'Add rectangle', 'rectangle'],
  ['ellipse', 'Ellipse', 'Add ellipse', 'ellipse'],
  ['freehand', 'Freehand', 'Draw freehand', 'freehand'],
] as const;

/** Tool choices and placement instructions stay visible beside the inline editor. */
export function renderMarkupGuide({ tool, enabled, selected = false }: MarkupGuideContext): string {
  const text = tool === 'text';
  const instructions = selected
    ? `<p class="markup-selection-help">${e(t('Edit the selected mark below and choose Apply changes. Choose a tool to add another.'))}</p>`
    : `<ol class="markup-steps"><li>${e(t('Choose a markup tool.'))}</li><li>${e(t(text ? 'Enter your note and choose a color below.' : 'Choose a color and line width below.'))}</li><li>${e(t(text ? 'Choose Place text, then click the paper.' : tool === 'freehand' ? 'Draw as many strokes as needed. Lift pen between strokes. Esc or Select finishes.' : 'Drag on the paper from the start to the end.'))}</li></ol>`;
  return `<section class="markup-guide" aria-label="Add markup"><div class="markup-guide-heading"><strong>${e(t('Add markup'))}</strong><span>${e(t('Notes and review marks'))}</span></div><div class="markup-tool-picker" role="group" aria-label="Markup tools">${tools.map(([id, label, actionLabel, glyph]) => `<button type="button" class="markup-tool-card${tool === id ? ' active' : ''}" data-action="tool:${id}" aria-label="${e(t(actionLabel))}" aria-pressed="${tool === id}"${enabled ? '' : ' disabled'}>${icon(glyph)}<span>${e(t(label))}</span></button>`).join('')}</div>${instructions}${tool === 'freehand' ? button('tool:select', 'Finish drawing', 'check', 'secondary markup-finish', enabled ? '' : 'disabled') : ''}</section>`;
}
