import { button } from './components';
import { icon } from './icons';
import { escapeHtml } from './utils';

const overflows = (message: string) => /^(Dimensions exceed|The selected scale)/.test(message);
const needsLayout = (message: string) =>
  overflows(message) || message.startsWith('Some dimension labels overlap');

/** Keep actual sheet warnings visible while the inspector selection changes. */
export function renderDrawingFeedback(warnings: string[]): string {
  const messages = [...new Set(warnings.map((message) => message.trim()).filter(Boolean))];
  if (!messages.length) return '';
  messages.sort((a, b) => Number(overflows(b)) - Number(overflows(a)));
  const [first, ...remaining] = messages;
  const layout = messages.some(needsLayout);
  return `<section class="drawing-feedback${messages.some(overflows) ? ' drawing-feedback-overflow' : ''}" aria-label="Drawing review">
    <div class="drawing-feedback-content"><div class="drawing-feedback-message">${icon('info')}<p>${escapeHtml(first)}</p></div>${remaining.length ? `<details class="drawing-feedback-details"><summary>${remaining.length} more ${remaining.length === 1 ? 'message' : 'messages'}</summary><ul>${remaining.map((message) => `<li>${escapeHtml(message)}</li>`).join('')}</ul></details>` : ''}</div>
    <div class="drawing-feedback-actions">${layout ? button('arrange-dimensions', 'Auto layout', 'layers', 'drawing-feedback-action') : ''}${button('tab:sheet', 'Page setup', undefined, 'drawing-feedback-action')}</div>
  </section>`;
}
