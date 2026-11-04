import type { Bounds2, PartType } from '../model';
import { wrapSheetNotes } from './sheet-notes';

export interface ParameterTableRow {
  key: string;
  section: boolean;
  label: string[];
  symbol: string[];
  value: string[];
  y: number;
  height: number;
}
export interface ParameterTableLayout {
  kind: Exclude<PartType, 'auto'>;
  bounds: Bounds2;
  rows: ParameterTableRow[];
  warnings: string[];
}

const WIDTH = 110;
const VALUE_WIDTH = 35;
const SYMBOL_WIDTH = 13;
const LABEL_WIDTH = WIDTH - VALUE_WIDTH - SYMBOL_WIDTH;
const FONT_SIZE = 2.6;
const LINE_HEIGHT = 3.8;
const xml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[ch]!,
  );
const n = (value: number) => Number(value.toFixed(5));

/** Every manufacturing profile shares physical text metrics, wrapping and table construction. */
export function parameterTableBuilder(kind: ParameterTableLayout['kind'], available: Bounds2) {
  const rows: ParameterTableRow[] = [];
  let y = available.minY;
  return {
    add(key: string, label: string, symbol: string, value = '', section = false): void {
      const labels = wrapSheetNotes(label, section ? WIDTH - 4 : LABEL_WIDTH - 4, FONT_SIZE);
      const values = section ? [] : wrapSheetNotes(value, VALUE_WIDTH - 4, FONT_SIZE);
      const symbols = section || !symbol ? [] : wrapSheetNotes(symbol, SYMBOL_WIDTH - 2, FONT_SIZE);
      const height = Math.max(
        section ? 6.5 : 6,
        Math.max(labels.length, values.length, symbols.length) * LINE_HEIGHT + 2.2,
      );
      rows.push({ key, section, label: labels, symbol: symbols, value: values, y, height });
      y += height;
    },
    finish(warnings: string[], overflowMessage: string): ParameterTableLayout {
      return {
        kind,
        bounds: {
          minX: available.maxX - WIDTH,
          minY: available.minY,
          maxX: available.maxX,
          maxY: y,
        },
        rows,
        warnings: y > available.maxY ? [...warnings, overflowMessage] : [...warnings],
      };
    },
  };
}

/** Portable SVG primitives preserve the same table in preview, SVG and vector PDF. */
export function renderParameterTable(table: ParameterTableLayout): string {
  const { minX: x, minY: y, maxY } = table.bounds;
  const path = (x1: number, y1: number, x2: number, y2: number, width: number) =>
    `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke-width="${width}"/>`;
  const text = (value: string, tx: number, ty: number, attrs = '') =>
    `<text x="${n(tx)}" y="${n(ty)}" stroke="none" font-size="${FONT_SIZE}" ${attrs}>${xml(value)}</text>`;
  let svg = `<g data-parameter-table="${table.kind}"${table.kind === 'gear' ? ' data-gear-table=""' : ''} fill="#20262b" stroke="#20262b"><rect x="${n(x)}" y="${n(y)}" width="${WIDTH}" height="${n(maxY - y)}" fill="white" stroke-width=".5"/>`;
  for (const row of table.rows) {
    svg += path(x, row.y, x + WIDTH, row.y, row.section ? 0.5 : 0.18);
    if (!row.section) {
      svg += path(x + LABEL_WIDTH, row.y, x + LABEL_WIDTH, row.y + row.height, 0.18);
      svg += path(
        x + WIDTH - VALUE_WIDTH,
        row.y,
        x + WIDTH - VALUE_WIDTH,
        row.y + row.height,
        0.18,
      );
    }
    svg += `<g data-parameter-row="${xml(row.key)}"${table.kind === 'gear' ? ` data-gear-row="${xml(row.key)}"` : ''}>`;
    for (const [index, line] of row.label.entries())
      svg += text(line, x + 2, row.y + 3.8 + index * LINE_HEIGHT);
    for (const [index, symbol] of row.symbol.entries())
      svg += text(
        symbol,
        x + LABEL_WIDTH + SYMBOL_WIDTH / 2,
        row.y + 3.8 + index * LINE_HEIGHT,
        'text-anchor="middle"',
      );
    for (const [index, line] of row.value.entries())
      svg += text(line, x + WIDTH - VALUE_WIDTH + 2, row.y + 3.8 + index * LINE_HEIGHT);
    svg += '</g>';
  }
  return `${svg}</g>`;
}
