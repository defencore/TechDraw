import type { DrawingSettings, Part, TemplateId } from '../model';

export const GOST_FORM1 = { width: 185, height: 55, leftMargin: 20, otherMargin: 5 } as const;
export const isGostTemplate = (template: TemplateId): boolean =>
  template === 'eskd' || template === 'eskd-uk';

const xml = (value: unknown) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!,
  );
const n = (value: number) => Number(value.toFixed(5));
const glyphWidth = (character: string): number =>
  /[ilI1.,:;!'|]/.test(character)
    ? 0.32
    : /[MW@%ЖЩШЮФМ]/u.test(character)
      ? 1
      : /\s/u.test(character)
        ? 0.35
        : /[0-9]/.test(character)
          ? 0.62
          : /[A-ZА-ЯІЇЄҐ]/u.test(character)
            ? 0.78
            : /[a-z]/.test(character)
              ? 0.63
              : 0.78;
const textWidth = (value: string, size: number) =>
  Array.from(value).reduce((width, character) => width + glyphWidth(character) * size, 0);
const line = (x1: number, y1: number, x2: number, y2: number, thin = false) =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke-width="${thin ? 0.2 : 0.5}"/>`;

interface Cell {
  x: number;
  y: number;
  width: number;
  height: number;
}
interface Result {
  svg: string;
  warnings: string[];
}

function wrapped(value: string, width: number, size: number): string[] {
  const lines: string[] = [];
  for (const paragraph of value.replace(/\r\n?/g, '\n').split('\n')) {
    let current = '';
    for (const word of paragraph
      .trim()
      .split(/[\t ]+/u)
      .filter(Boolean)) {
      if (current && textWidth(`${current} ${word}`, size) <= width) {
        current += ` ${word}`;
        continue;
      }
      if (current) {
        lines.push(current);
        current = '';
      }
      for (const character of word) {
        if (current && textWidth(current + character, size) > width) {
          lines.push(current);
          current = '';
        }
        current += character;
      }
    }
    lines.push(current);
  }
  return lines;
}
function shortened(value: string, width: number, size: number): string {
  let output = '';
  for (const character of value) {
    if (textWidth(output + character + '...', size) > width) break;
    output += character;
  }
  return `${output}...`;
}
function standardDate(value: string): string {
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[3]}.${iso[2]}.${iso[1].slice(-2)}`;
  return value.replace(/^(\d{2}\.\d{2}\.)\d{2}(\d{2})$/, '$1$2');
}

/** GOST 2.104-68 Form 1 geometry; localized captions do not alter cell dimensions. */
export function renderGostForm1(
  part: Part,
  settings: DrawingSettings,
  width: number,
  height: number,
  scale: number,
): Result {
  const uk = settings.template === 'eskd-uk',
    warnings: string[] = [];
  const words = uk
    ? {
        changes: ['Зм.', 'Арк.', '№ докум.', 'Підп.', 'Дата'],
        roles: ['Розроб.', 'Перев.', 'Т.контр.', '', 'Н.контр.', 'Затв.'],
        litera: 'Літ.',
        mass: 'Маса',
        scale: 'Масштаб',
        sheet: 'Арк.',
        sheets: 'Аркушів',
        inventory: ['Інв. № ориг.', 'Підп. і дата', 'Зам. інв. №', 'Інв. № дубл.', 'Підп. і дата'],
        copied: 'Копіював',
        format: 'Формат',
      }
    : {
        changes: ['Rev.', 'Sheet', 'Document No.', 'Sign.', 'Date'],
        roles: ['Drawn', 'Checked', 'Tech. ctrl.', '', 'Std. ctrl.', 'Approved'],
        litera: 'Lit.',
        mass: 'Mass',
        scale: 'Scale',
        sheet: 'Sheet',
        sheets: 'Sheets',
        inventory: [
          'Original Inv. No.',
          'Signature / date',
          'Replaces Inv. No.',
          'Duplicate Inv. No.',
          'Signature / date',
        ],
        copied: 'Copied by',
        format: 'Format',
      };
  const text = (
    value: string,
    cell: Cell,
    field: string,
    size = 3,
    multiline = false,
    left = false,
    caption = false,
  ): string => {
    if (!value) return '';
    const padding = Math.min(cell.height <= 7 ? 0.5 : 1.8, cell.width * 0.1);
    const available = cell.width - padding * 2;
    let fontSize = size;
    let lines: string[];
    if (multiline) {
      lines = wrapped(value, available, fontSize);
      let limit = Math.max(1, Math.floor((cell.height - padding * 2) / (fontSize * 1.3)));
      if (lines.length > limit) {
        fontSize = Math.min(size, 2.8);
        lines = wrapped(value, available, fontSize);
        limit = Math.max(1, Math.floor((cell.height - padding * 2) / (fontSize * 1.3)));
      }
      if (lines.length > limit) {
        if (!caption)
          warnings.push(
            `${field} is shortened in the title block. Reduce its length to include the full text.`,
          );
        lines = lines.slice(0, limit);
        lines[limit - 1] = shortened(lines[limit - 1], available, fontSize);
      }
    } else {
      const normalized = value.replace(/\s+/gu, ' ');
      fontSize = Math.min(
        size,
        Math.max(caption ? 1.8 : 2, available / Math.max(textWidth(normalized, 1), 1)),
      );
      if (textWidth(normalized, fontSize) > available) {
        if (!caption)
          warnings.push(
            `${field} is shortened in the title block. Reduce its length to include the full text.`,
          );
        lines = [shortened(normalized, available, fontSize)];
      } else lines = [normalized];
    }
    const lineHeight = fontSize * 1.3;
    const firstY =
      cell.y + cell.height / 2 - ((lines.length - 1) * lineHeight) / 2 + fontSize * 0.35;
    return lines
      .map(
        (value, index) =>
          `<text data-field="${xml(field.toLowerCase().replace(/ /g, '-'))}" x="${n(left ? cell.x + padding : cell.x + cell.width / 2)}" y="${n(firstY + index * lineHeight)}" font-size="${n(fontSize)}" text-anchor="${left ? 'start' : 'middle'}" fill="#20262b" stroke="none">${xml(value)}</text>`,
      )
      .join('');
  };
  const cell = (
    field: string,
    x: number,
    y: number,
    cellWidth: number,
    cellHeight: number,
    markup: string,
  ): string =>
    `<g data-gost-field="${field}"><rect x="${x}" y="${y}" width="${cellWidth}" height="${cellHeight}" fill="none" stroke="none"/>${markup}</g>`;
  const bx = width - 5 - 185,
    by = height - 5 - 55;
  const scaleText = scale >= 1 ? `${n(scale)}:1` : `1:${n(1 / scale)}`;
  const sheetCount = settings.sheetCount?.trim() || '1';
  const sheetNumber = Number(sheetCount) === 1 ? '' : settings.sheetNumber?.trim() || '1';
  const laterSheet = Number(sheetNumber || 1) > 1;
  const total = laterSheet ? '' : sheetCount;
  let body = '<rect x="0" y="0" width="185" height="55" fill="none" stroke-width=".5"/>';
  for (const x of [17, 40, 55, 65]) body += line(x, 0, x, 55);
  body += line(7, 0, 7, 25);
  for (let y = 5; y < 55; y += 5) body += line(0, y, 65, y, y !== 25);
  body += line(65, 15, 185, 15) + line(65, 40, 185, 40) + line(135, 15, 135, 55);
  body +=
    line(135, 20, 185, 20) +
    line(135, 35, 185, 35) +
    line(150, 15, 150, 35) +
    line(167, 15, 167, 35) +
    line(140, 20, 140, 35, true) +
    line(145, 20, 145, 35, true) +
    line(155, 35, 155, 40);
  const revisionBounds = [0, 7, 17, 40, 55, 65];
  const changeValues = [
    settings.revision,
    settings.changeSheet,
    settings.changeDocument,
    settings.changeSignature,
    standardDate(settings.changeDate),
  ];
  for (let index = 0; index < 5; index++) {
    const x = revisionBounds[index],
      w = revisionBounds[index + 1] - x;
    body += text(
      words.changes[index],
      { x, y: 20, width: w, height: 5 },
      `Change header ${index}`,
      2.5,
      false,
      false,
      true,
    );
    body += text(
      changeValues[index],
      { x, y: 15, width: w, height: 5 },
      ['Revision', 'Change sheet', 'Change document', 'Change signature', 'Change date'][index],
      2.3,
    );
  }
  const approvals = [
    [settings.author, settings.signature, settings.date, 'Author'],
    [settings.checkedBy, settings.checkedSignature, settings.checkedDate, 'Checked by'],
    [
      settings.technicalControl,
      settings.technicalControlSignature,
      settings.technicalControlDate,
      'Technical control',
    ],
    ['', '', '', 'Reserved role'],
    [
      settings.standardControl,
      settings.standardControlSignature,
      settings.standardControlDate,
      'Standard control',
    ],
    [settings.approvedBy, settings.approvedSignature, settings.approvedDate, 'Approved by'],
  ];
  for (const [index, values] of approvals.entries()) {
    const y = 25 + index * 5;
    body += text(
      words.roles[index],
      { x: 0, y, width: 17, height: 5 },
      `Approval role ${index}`,
      2.5,
      false,
      true,
      true,
    );
    body += text(values[0], { x: 17, y, width: 23, height: 5 }, values[3], 2.5, false, true);
    body += text(values[1], { x: 40, y, width: 15, height: 5 }, `${values[3]} signature`, 2.3);
    body += text(
      standardDate(values[2]),
      { x: 55, y, width: 10, height: 5 },
      `${values[3]} date`,
      2.2,
    );
  }
  const designation = { x: 65, y: 0, width: 120, height: 15 };
  body += cell('2', 65, 0, 120, 15, text(settings.number, designation, 'Drawing number', 5.5));
  body += cell(
    '1',
    65,
    15,
    70,
    25,
    laterSheet
      ? ''
      : text(
          settings.title || part.name,
          { x: 65, y: 15, width: 70, height: 25 },
          'Drawing title',
          4,
          true,
        ),
  );
  body += cell(
    '3',
    65,
    40,
    70,
    15,
    laterSheet
      ? ''
      : text(settings.material, { x: 65, y: 40, width: 70, height: 15 }, 'Material', 3, true),
  );
  body +=
    text(
      words.litera,
      { x: 135, y: 15, width: 15, height: 5 },
      'Litera header',
      2.5,
      false,
      false,
      true,
    ) +
    text(
      words.mass,
      { x: 150, y: 15, width: 17, height: 5 },
      'Mass header',
      2.5,
      false,
      false,
      true,
    ) +
    text(
      words.scale,
      { x: 167, y: 15, width: 18, height: 5 },
      'Scale header',
      2.5,
      false,
      false,
      true,
    );
  const letters = laterSheet ? [] : Array.from(settings.litera || '');
  if (letters.length > 3)
    warnings.push('Litera is shortened in the title block. Use at most three characters.');
  body += cell(
    '4',
    135,
    20,
    15,
    15,
    letters
      .slice(0, 3)
      .map((letter, index) =>
        text(letter, { x: 135 + index * 5, y: 20, width: 5, height: 15 }, 'Litera', 4),
      )
      .join(''),
  );
  body += cell(
    '5',
    150,
    20,
    17,
    15,
    laterSheet ? '' : text(settings.mass, { x: 150, y: 20, width: 17, height: 15 }, 'Mass', 3.5),
  );
  body += cell(
    '6',
    167,
    20,
    18,
    15,
    laterSheet ? '' : text(scaleText, { x: 167, y: 20, width: 18, height: 15 }, 'Scale', 3.5),
  );
  body += cell(
    '7',
    135,
    35,
    20,
    5,
    text(
      `${words.sheet}${sheetNumber ? ` ${sheetNumber}` : ''}`,
      { x: 135, y: 35, width: 20, height: 5 },
      'Sheet number',
      2.5,
    ),
  );
  body += cell(
    '8',
    155,
    35,
    30,
    5,
    text(
      `${words.sheets}${total ? ` ${total}` : ''}`,
      { x: 155, y: 35, width: 30, height: 5 },
      'Sheet count',
      2.5,
    ),
  );
  body += cell(
    '9',
    135,
    40,
    50,
    15,
    laterSheet
      ? ''
      : text(
          settings.organization,
          { x: 135, y: 40, width: 50, height: 15 },
          'Organization',
          3.5,
          true,
        ),
  );
  let svg = `<g data-gost-form="1" data-width="185" data-height="55" transform="translate(${bx} ${by})" fill="none" stroke="#20262b">${body}</g>`;

  const inventoryLengths = [25, 35, 25, 25, 35];
  const inventoryValues = [
    [settings.inventoryNumber],
    [settings.inventorySignature, standardDate(settings.inventoryDate)],
    [settings.replacedInventoryNumber],
    [settings.duplicateInventoryNumber],
    [settings.duplicateSignature, standardDate(settings.duplicateDate)],
  ];
  let inventory =
    '<rect x="0" y="0" width="145" height="12" fill="none" stroke-width=".5"/>' +
    line(0, 5, 145, 5);
  let position = 0;
  for (const [index, length] of inventoryLengths.entries()) {
    if (index) inventory += line(position, 0, position, 12);
    inventory += text(
      words.inventory[index],
      { x: position, y: 0, width: length, height: 5 },
      `Inventory caption ${index}`,
      2.3,
      false,
      false,
      true,
    );
    inventory += cell(
      String(19 + index),
      position,
      5,
      length,
      7,
      text(
        inventoryValues[index].filter(Boolean).join('\n'),
        { x: position, y: 5, width: length, height: 7 },
        `Inventory value ${index}`,
        2.2,
        inventoryValues[index].filter(Boolean).length > 1,
      ),
    );
    position += length;
  }
  svg += `<g data-gost-inventory="19-23" transform="translate(5 ${height - 5}) rotate(-90)" fill="none" stroke="#20262b">${inventory}</g>`;

  const portraitLarge = settings.format !== 'A4' && settings.orientation === 'portrait';
  const designationPosition = portraitLarge
    ? `translate(${width - 5} 5) rotate(90)`
    : 'translate(90 19) rotate(180)';
  svg += `<g data-gost-field="26" transform="${designationPosition}" fill="none" stroke="#20262b"><rect x="0" y="0" width="70" height="14" stroke-width=".5"/>${text(settings.number, { x: 0, y: 0, width: 70, height: 14 }, 'Rotated drawing number', 4.5)}</g>`;
  svg += `<g stroke="none">${text(`${words.copied}${settings.copiedBy ? ` ${settings.copiedBy}` : ''}`, { x: bx + 65, y: height - 5, width: 70, height: 5 }, 'Copied by', 2.4, false, true)}${text(`${words.format} ${settings.format}`, { x: width - 55, y: height - 5, width: 50, height: 5 }, 'Paper format', 2.4)}</g>`;
  if (settings.format === 'A4' && settings.orientation === 'landscape')
    warnings.push(
      'GOST 2.104-68 requires A4 portrait for the standard Form 1 arrangement. Choose portrait or another template.',
    );
  return { svg, warnings };
}
