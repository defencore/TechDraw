import { icon } from './icons';
import { t } from './i18n';
import { escapeHtml as e } from './utils';
import { button } from './components';

interface MarkupGuideContext {
  tool: string;
  enabled: boolean;
  selected?: boolean;
  selectedKind?: string;
}

const tools = [
  ['text', 'Text', 'Add text', 'text'],
  ['arrow', 'Arrow', 'Add arrow', 'arrow'],
  ['rectangle', 'Rectangle', 'Add rectangle', 'rectangle'],
  ['ellipse', 'Ellipse', 'Add ellipse', 'ellipse'],
  ['freehand', 'Freehand', 'Draw freehand', 'freehand'],
] as const;

/** Tool choices and placement instructions stay visible beside the inline editor. */
export function renderMarkupGuide({
  tool,
  enabled,
  selected = false,
  selectedKind,
}: MarkupGuideContext): string {
  const text = tool === 'text';
  const instructions = text
    ? `<p class="markup-selection-help">${e(t('Click the drawing, then type your note in the editor that opens.'))}</p>`
    : selected && selectedKind === 'text'
      ? `<p class="markup-selection-help">${e(t('Choose Edit text to change the selected note.'))}</p>`
      : selected
        ? `<p class="markup-selection-help">${e(t('Edit the selected mark below and choose Apply changes. Choose a tool to add another.'))}</p>`
        : `<ol class="markup-steps"><li>${e(t('Choose a markup tool.'))}</li><li>${e(t('Choose a color and line width below.'))}</li><li>${e(t(tool === 'freehand' ? 'Draw as many strokes as needed. Lift pen between strokes. Esc or Select finishes.' : 'Drag on the paper from the start to the end.'))}</li></ol>`;
  return `<section class="markup-guide" aria-label="Add markup"><div class="markup-guide-heading"><strong>${e(t('Add markup'))}</strong><span>${e(t('Notes and review marks'))}</span></div><div class="markup-tool-picker" role="group" aria-label="Markup tools">${tools.map(([id, label, actionLabel, glyph]) => `<button type="button" class="markup-tool-card${tool === id ? ' active' : ''}" data-action="tool:${id}" aria-label="${e(t(actionLabel))}" aria-pressed="${tool === id}"${enabled ? '' : ' disabled'}>${icon(glyph)}<span>${e(t(label))}</span></button>`).join('')}</div>${instructions}${tool === 'freehand' ? button('tool:select', 'Finish drawing', 'check', 'secondary markup-finish', enabled ? '' : 'disabled') : ''}</section>`;
}
