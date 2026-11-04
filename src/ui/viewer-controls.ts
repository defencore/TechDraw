import type { DrawingAppearance } from '../drawing/appearance';
import type { Part } from '../model';
import { button, option } from './components';
import { escapeHtml as e } from './utils';
import { t } from './i18n';
import { partDisplayLabel } from './part-label';
import type { ScreenAwakeStatus } from './screen-awake';

export interface ViewerControls {
  parts: readonly Part[];
  activeId: string | null;
  appearance: DrawingAppearance;
  keepAwake: boolean;
  wakeStatus: ScreenAwakeStatus;
  wakeLabel: string;
  fullscreenAvailable: boolean;
  fullscreen: boolean;
}

/** Fixed control slots keep asynchronous status changes from moving pointer targets. */
export function renderDrawingViewerControls(options: ViewerControls): string {
  const fullscreenLabel = t(options.fullscreen ? 'Exit system fullscreen' : 'System fullscreen');
  return `<div class="viewer-controls" role="toolbar" aria-label="Drawing viewer">
    ${button('exit-viewer', `<span>${e(t('Back'))}</span>`, 'close', 'secondary viewer-exit', `aria-label="${e(t('Back to workspace'))}" title="${e(t('Back to workspace'))}"`)}
    <label class="viewer-part"><span class="sr-only">Part</span><select id="viewer-part" aria-label="Part">${options.parts.map((part) => `<option value="${e(part.id)}" ${part.id === options.activeId ? 'selected' : ''} data-user-content>${e(partDisplayLabel(part.name))}</option>`).join('')}</select></label>
    <label class="viewer-appearance"><span class="sr-only">Appearance</span><select id="viewer-appearance" aria-label="Appearance">${option('paper', 'Paper', options.appearance)}${option('blueprint', 'Blueprint', options.appearance)}</select></label>
    ${button('toggle-wake-lock', '', 'sun', 'icon-button viewer-wake', `aria-label="Keep screen awake" title="${e(t('Keep screen awake'))}" aria-pressed="${options.keepAwake}"`)}
    <button type="button" class="viewer-awake" id="viewer-awake" data-status="${options.wakeStatus}" aria-live="polite" title="${e(options.wakeLabel)}">${e(options.wakeLabel)}</button>
    ${button('share-drawing', '', 'copy', 'icon-button viewer-copy', `aria-label="Copy image" title="${e(t('Copy image'))}"`)}
    ${options.fullscreenAvailable ? button('toggle-native-fullscreen', '', 'expand', 'icon-button viewer-fullscreen', `aria-label="${e(fullscreenLabel)}" title="${e(fullscreenLabel)}" aria-pressed="${options.fullscreen}"`) : ''}
  </div>`;
}
