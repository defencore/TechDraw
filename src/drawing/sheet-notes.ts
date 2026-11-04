import type { DrawingSettings } from '../model';
import { measureDimensionText } from './dimension-label';
import { isGostTemplate } from './gost-form1';

interface NotePage {
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  blockHeight: number;
}
export interface SheetNotes {
  x: number;
  y: number;
  width: number;
  fontSize: number;
  lineHeight: number;
  lines: string[];
  omitted: number;
  contentBottom: number;
  placement: 'beside-title' | 'above-title';
}

/** Linear-time wrapping keeps entered line breaks and splits only words wider than the panel. */
export function wrapSheetNotes(value: string, width: number, size: number): string[] {
  const output: string[] = [],
    gap = measureDimensionText(' ', size);
  for (const paragraph of value.replace(/\r\n?/g, '\n').split('\n')) {
    let current = '',
      used = 0;
    for (const word of paragraph
      .trim()
      .split(/[\t ]+/)
      .filter(Boolean)) {
      const measured = measureDimensionText(word, size);
      if (current && used + gap + measured <= width) {
        current += ` ${word}`;
        used += gap + measured;
        continue;
      }
      if (current) {
        output.push(current);
        current = '';
        used = 0;
      }
      if (measured <= width) {
        current = word;
        used = measured;
        continue;
      }
      for (const character of word) {
        const advance = measureDimensionText(character, size);
        if (current && used + advance > width) {
          output.push(current);
          current = '';
          used = 0;
        }
        current += character;
        used += advance;
      }
    }
    output.push(current);
  }
  return output;
}

/** Rendering and view packing share the exact same text footprint and reserved area. */
export function sheetNotes(settings: DrawingSettings, page: NotePage): SheetNotes {
  const { width, height, left, right, top, bottom, blockHeight } = page;
  const by = height - bottom - blockHeight;
  const bx = Math.max(left, width - right - 185);
  const sideWidth = Math.max(0, bx - left - 8),
    fullWidth = width - left - right - 6;
  const value = isGostTemplate(settings.template)
    ? [
        settings.tolerance
          ? `${settings.template === 'eskd-uk' ? 'Загальні допуски' : 'General tolerance'}: ${settings.tolerance}`
          : '',
        settings.notes,
      ]
        .filter(Boolean)
        .join('\n')
    : settings.notes ||
      'Review geometry, tolerances and manufacturing requirements before release.';
  const compactWidth = sideWidth > 50 ? sideWidth : fullWidth;
  const compact = wrapSheetNotes(value, compactWidth, 2.6);
  if (compact.length <= (sideWidth > 50 ? 8 : 2))
    return {
      x: left + 3,
      y: sideWidth > 50 ? by + 4 : by - 10,
      width: compactWidth,
      fontSize: 2.6,
      lineHeight: 3.7,
      lines: compact,
      omitted: 0,
      contentBottom: by - 13,
      placement: sideWidth > 50 ? 'beside-title' : 'above-title',
    };
  const fontSize = 3,
    lineHeight = 4.5;
  const wrapped = wrapSheetNotes(value, fullWidth, fontSize);
  const availableHeight = by - (top + 20);
  const maximumHeight = Math.max(12, Math.min(availableHeight * 0.55, availableHeight - 60));
  const capacity = Math.max(1, Math.floor((maximumHeight - 6) / lineHeight));
  const omitted = Math.max(0, wrapped.length - capacity),
    lines = wrapped.slice(0, capacity);
  if (omitted) {
    let last = lines.at(-1)!;
    while (last && measureDimensionText(`${last}...`, fontSize) > fullWidth)
      last = last.slice(0, -1);
    lines[lines.length - 1] = `${last}...`;
  }
  const panelHeight = 6 + lines.length * lineHeight;
  const panelTop = by - 4 - panelHeight;
  return {
    x: left + 3,
    y: panelTop + 4,
    width: fullWidth,
    fontSize,
    lineHeight,
    lines,
    omitted,
    contentBottom: Math.min(by - 13, panelTop - 4),
    placement: 'above-title',
  };
}
