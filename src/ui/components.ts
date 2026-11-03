import type { DrawingSettings } from '../model';
import { icon } from './icons';
import { escapeHtml as e } from './utils';
export const button = (action: string, label: string, ico?: string, cls = '', extra = '') =>
  `<button type="button" class="${cls}" data-action="${action}" ${extra}>${ico ? icon(ico) : ''}${label}</button>`;
export const field = (
  label: string,
  key: keyof DrawingSettings,
  value: string | number,
  placeholder = '',
) =>
  `<label class="field"><span>${label}</span><input maxlength="1024" data-setting="${key}" value="${e(value)}" placeholder="${e(placeholder)}" /></label>`;
export const option = (value: string | number, label: string, current: unknown) =>
  `<option value="${value}" ${String(current) === String(value) ? 'selected' : ''}>${label}</option>`;
