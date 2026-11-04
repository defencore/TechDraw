import type { Bounds2, DrawingSettings, Part } from '../model';
import { gearReferenceDiameter, missingGearFields } from '../gears/specification';
import { wrapSheetNotes } from './sheet-notes';
import { measuredPinHoleAngle } from './gear-dimensions';

export interface GearTableRow {
  key: string;
  section: boolean;
  label: string[];
  symbol: string;
  value: string[];
  y: number;
  height: number;
}
export interface GearTableLayout {
  bounds: Bounds2;
  rows: GearTableRow[];
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

/** Three groups follow GOST 2.403; row heights expand to retain entered engineering data. */
export function gearTableLayout(
  part: Part,
  settings: DrawingSettings,
  available: Bounds2,
): GearTableLayout | undefined {
  const measured = part.features?.gear;
  const spec = part.gearSpecification;
  if (!measured && !spec) return;
  const missing = missingGearFields(part);
  const countMismatch = measured && spec?.teeth !== undefined && spec.teeth !== measured.toothCount;
  const draft = missing.length > 0 || countMismatch;
  const uk = settings.template === 'eskd-uk';
  const words = (en: string, ua: string) => (uk ? ua : en);
  const specify = words('Specify', 'Задати');
  const numeric = (value: number | undefined, unit = '') =>
    value === undefined
      ? specify
      : `${Number(value.toFixed(Math.max(4, settings.precision)))}${unit}`;
  const text = (value: string | undefined) => value?.trim() || specify;
  const rows: GearTableRow[] = [];
  let y = available.minY;
  const add = (key: string, label: string, symbol: string, value = '', section = false) => {
    const labels = wrapSheetNotes(label, section ? WIDTH - 4 : LABEL_WIDTH - 4, FONT_SIZE);
    const values = section ? [] : wrapSheetNotes(value, VALUE_WIDTH - 4, FONT_SIZE);
    const height = Math.max(
      section ? 6.5 : 6,
      Math.max(labels.length, values.length) * LINE_HEIGHT + 2.2,
    );
    rows.push({ key, section, label: labels, symbol, value: values, y, height });
    y += height;
  };
  add(
    'basic',
    draft
      ? words('BASIC GEAR DATA — DRAFT', 'ОСНОВНІ ДАНІ — ЧЕРНЕТКА')
      : words('BASIC GEAR DATA', 'ОСНОВНІ ДАНІ ЗАЧЕПЛЕННЯ'),
    '',
    '',
    true,
  );
  add(
    'type',
    words('Gear type', 'Тип колеса'),
    '',
    spec
      ? spec.type === 'external-spur'
        ? words('External spur', 'Прямозубе зовнішнє')
        : words('External helical', 'Косозубе зовнішнє')
      : specify,
  );
  add(
    'module',
    words('Normal module, mm', 'Нормальний модуль, мм'),
    'mn',
    numeric(spec?.normalModule),
  );
  add(
    'teeth',
    words('Number of teeth', 'Кількість зубців'),
    'z',
    numeric(spec?.teeth ?? measured?.toothCount),
  );
  if (countMismatch)
    add(
      'measured-teeth',
      words('Measured teeth: CHECK MISMATCH', 'Виміряні зубці: ПЕРЕВІРИТИ'),
      'z',
      numeric(measured.toothCount),
    );
  add(
    'pressure-angle',
    words('Normal pressure angle', 'Нормальний кут профілю'),
    'αn',
    numeric(spec?.normalPressureAngle, '°'),
  );
  add(
    'profile-shift',
    words('Profile shift coefficient', 'Коефіцієнт зміщення'),
    'x',
    numeric(spec?.profileShift),
  );
  if (spec?.type === 'external-helical') {
    add(
      'helix-angle',
      words('Reference helix angle', 'Кут нахилу зубців'),
      'β',
      numeric(spec.helixAngle, '°'),
    );
    add(
      'helix-hand',
      words('Helix hand', 'Напрямок зубців'),
      '',
      spec.helixHand
        ? spec.helixHand === 'left'
          ? words('Left', 'Лівий')
          : words('Right', 'Правий')
        : specify,
    );
  }
  add(
    'profile-reference',
    words('Basic rack / tooth profile', 'Вихідний контур / профіль зуба'),
    '',
    text(spec?.profileReference),
  );
  add(
    'accuracy',
    words('Accuracy / backlash and standard', 'Точність / бічний зазор і стандарт'),
    '',
    text(spec?.accuracy),
  );
  add(
    'finish',
    words('Tooth flank finish', 'Шорсткість бокових поверхонь зубців'),
    '',
    text(spec?.toothSurfaceFinish),
  );
  add(
    'tooth-edge',
    words('Tooth edge treatment', 'Обробка кромок зубців'),
    '',
    text(spec?.toothEdge),
  );
  if (spec?.heatTreatment)
    add(
      'heat-treatment',
      words('Heat treatment / hardness', 'Термообробка / твердість'),
      '',
      spec.heatTreatment,
    );
  add('inspection', words('INSPECTION DATA', 'КОНТРОЛЬНІ ДАНІ'), '', '', true);
  add(
    'inspection-dimensions',
    words('Method, dimensions and tolerances', 'Метод, розміри та допуски'),
    '',
    text(spec?.inspection),
  );
  add('reference', words('REFERENCE DATA', 'ДОВІДКОВІ ДАНІ'), '', '', true);
  add(
    'reference-diameter',
    words('Reference diameter, mm', 'Ділильний діаметр, мм'),
    'd',
    numeric(gearReferenceDiameter(spec, measured?.toothCount)),
  );
  if (measured) {
    if (measured.toothDatumDirection)
      add(
        'tooth-datum',
        words('Datum A', 'База A'),
        'A',
        words('Selected tooth-tip center', 'Середина вибраної вершини зуба'),
      );
    add(
      'outside-diameter',
      words('Measured tip diameter, mm', 'Виміряний діаметр вершин, мм'),
      'da',
      numeric(measured.outsideDiameter),
    );
    add(
      'root-diameter',
      words('Measured root diameter, mm', 'Виміряний діаметр западин, мм'),
      'df',
      numeric(measured.rootDiameter),
    );
    add(
      'face-width',
      words('Measured face width, mm', 'Виміряна ширина вінця, мм'),
      'b',
      numeric(measured.faceWidth),
    );
    for (const [index, hole] of (measured.pinHoles ?? []).entries()) {
      const suffix = (measured.pinHoles?.length ?? 0) > 1 ? ` ${index + 1}` : '';
      add(
        `pin-${index}-diameter`,
        words(`Measured radial hole${suffix}, mm`, `Виміряний радіальний отвір${suffix}, мм`),
        '',
        `Ø${numeric(hole.diameter)}`,
      );
      add(
        `pin-${index}-axis`,
        words(`Hole${suffix} axis, model XYZ`, `Вісь отвору${suffix}, XYZ моделі`),
        '',
        hole.axis.direction.map((value) => numeric(value)).join('; '),
      );
      const angle = measuredPinHoleAngle(part, index);
      if (angle !== undefined)
        add(
          `pin-${index}-angle`,
          words(`Measured hole${suffix} angle to A`, `Виміряний кут отвору${suffix} до A`),
          '',
          numeric(angle, '°'),
        );
    }
  }
  const warnings: string[] = [];
  if (countMismatch)
    warnings.push(
      `Gear tooth count conflicts with measured geometry: specified ${spec!.teeth}, measured ${measured.toothCount}. Resolve the mismatch before manufacture.`,
    );
  if (missing.length)
    warnings.push(
      `Gear manufacturing data is incomplete: ${missing.join(', ')}. Specify these values before manufacture.`,
    );
  if (measured?.pinHoles?.some((_, index) => measuredPinHoleAngle(part, index) === undefined))
    warnings.push(
      'Radial pin-hole orientation needs a tooth datum and an inspection requirement before manufacture. The table reports its measured model-axis direction.',
    );
  if (y > available.maxY)
    warnings.push(
      'Gear parameter table exceeds the drawing area. Shorten the entered data or choose a larger sheet before export.',
    );
  return {
    bounds: { minX: available.maxX - WIDTH, minY: available.minY, maxX: available.maxX, maxY: y },
    rows,
    warnings,
  };
}

/** Portable SVG primitives preserve the same table in preview, SVG and vector PDF. */
export function renderGearTable(table: GearTableLayout): string {
  const { minX: x, minY: y, maxY } = table.bounds;
  const path = (x1: number, y1: number, x2: number, y2: number, width: number) =>
    `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke-width="${width}"/>`;
  const text = (value: string, tx: number, ty: number, attrs = '') =>
    `<text x="${n(tx)}" y="${n(ty)}" stroke="none" font-size="${FONT_SIZE}" ${attrs}>${xml(value)}</text>`;
  let svg = `<g data-gear-table="" fill="#20262b" stroke="#20262b"><rect x="${n(x)}" y="${n(y)}" width="${WIDTH}" height="${n(maxY - y)}" fill="white" stroke-width=".5"/>`;
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
    svg += `<g data-gear-row="${row.key}">`;
    for (const [index, line] of row.label.entries())
      svg += text(line, x + 2, row.y + 3.8 + index * LINE_HEIGHT);
    if (row.symbol)
      svg += text(
        row.symbol,
        x + LABEL_WIDTH + SYMBOL_WIDTH / 2,
        row.y + 3.8,
        'text-anchor="middle"',
      );
    for (const [index, line] of row.value.entries())
      svg += text(line, x + WIDTH - VALUE_WIDTH + 2, row.y + 3.8 + index * LINE_HEIGHT);
    svg += '</g>';
  }
  return `${svg}</g>`;
}
