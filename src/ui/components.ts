import type { DrawingSettings } from '../model';
import { icon } from './icons';
import { escapeHtml as e } from './utils';
import { t } from './i18n';
export const button = (action: string, label: string, ico?: string, cls = '', extra = '') =>
  `<button type="button" class="${cls}" data-action="${action}" ${extra}>${ico ? icon(ico) : ''}${t(label)}</button>`;
export const field = (
  label: string,
  key: keyof DrawingSettings,
  value: string | number,
  placeholder = '',
  userPlaceholder = false,
) =>
  `<label class="field"><span>${e(t(label))}</span><input maxlength="1024" data-setting="${key}" value="${e(value)}" placeholder="${e(userPlaceholder ? placeholder : t(placeholder))}"${userPlaceholder ? ' data-user-placeholder' : ''} /></label>`;
export const option = (value: string | number, label: string, current: unknown) =>
  `<option value="${value}" ${String(current) === String(value) ? 'selected' : ''}>${e(t(label))}</option>`;
