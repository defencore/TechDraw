import test from 'node:test';
import assert from 'node:assert/strict';
import type { DrawingSettings, Part, Projection } from '../src/model';
import { GOST_FORM1, renderGostForm1 } from '../src/drawing/gost-form1';
import { renderDrawing, paperSize } from '../src/drawing/render';
import { defaultSettings } from '../src/state';

const views: Projection[] = (['front', 'top', 'right', 'iso'] as const).map((id) => ({
  id,
  name: id,
  bounds: { minX: 0, minY: 0, maxX: 30, maxY: 20 },
  edges: [
    {
      id: `${id}-edge`,
      kind: 'line',
      hidden: false,
      points: [
        [0, 0],
        [30, 20],
      ],
    },
  ],
}));
const part: Part = {
  id: 'part',
  name: 'Example part',
  sourceName: 'example.step',
  path: ['Part'],
  unit: 'mm',
  bounds: { min: [0, 0, 0], max: [30, 20, 20] },
  views,
  warnings: [],
};
function field(svg: string, id: string): { geometry: number[]; content: string } {
  const match = svg.match(
    new RegExp(
      `<g data-gost-field="${id}"><rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"[^>]*>([\\s\\S]*?)<\\/g>`,
    ),
  );
  assert.ok(match, `missing field ${id}`);
  return { geometry: match.slice(1, 5).map(Number), content: match[5] };
}

test('Form 1 has exact 185 by 55 mm geometry and standard field subdivisions', () => {
  const result = renderGostForm1(part, defaultSettings, 420, 297, 1);
  assert.deepEqual(GOST_FORM1, { width: 185, height: 55, leftMargin: 20, otherMargin: 5 });
  assert.match(
    result.svg,
    /data-gost-form="1" data-width="185" data-height="55" transform="translate\(230 237\)"/,
  );
  for (const [id, bounds] of Object.entries({
    '1': [65, 15, 70, 25],
    '2': [65, 0, 120, 15],
    '3': [65, 40, 70, 15],
    '4': [135, 20, 15, 15],
    '5': [150, 20, 17, 15],
    '6': [167, 20, 18, 15],
    '7': [135, 35, 20, 5],
    '8': [155, 35, 30, 5],
    '9': [135, 40, 50, 15],
  }))
    assert.deepEqual(field(result.svg, id).geometry, bounds);
  assert.match(result.svg, /<line x1="7" y1="0" x2="7" y2="25"/);
  for (const x of [17, 40, 55, 65])
    assert.match(result.svg, new RegExp(`<line x1="${x}" y1="0" x2="${x}" y2="55"`));
  for (const y of [5, 10, 15, 20, 25, 30, 35, 40, 45, 50])
    assert.match(result.svg, new RegExp(`<line x1="0" y1="${y}" x2="65" y2="${y}"`));
});

test('litera is independent of revision and occupies three individual 5 mm cells', () => {
  const result = renderGostForm1(
    part,
    { ...defaultSettings, litera: 'АБВ', revision: 'R2' },
    420,
    297,
    1,
  );
  const litera = field(result.svg, '4').content;
  assert.match(litera, />А<\/text>/);
  assert.match(litera, />Б<\/text>/);
  assert.match(litera, />В<\/text>/);
  assert.doesNotMatch(litera, /R2|\.\.\./);
  assert.match(result.svg, /data-field="revision"[^>]*>R2<\/text>/);
});

test('Ukrainian captions and entered names are preserved while XML text stays escaped', () => {
  const settings: DrawingSettings = {
    ...defaultSettings,
    template: 'eskd-uk',
    title: 'Вал <контрольний>',
    number: 'КР.001',
    material: 'Сталь 45',
    organization: 'ТОВ «Приклад»',
    author: 'О. Петренко',
    date: '2026-11-04',
    checkedBy: 'І. Коваленко',
    checkedDate: '05.11.2026',
    copiedBy: 'М. Іваненко',
  };
  const result = renderGostForm1(part, settings, 420, 297, 0.2);
  for (const caption of [
    'Розроб.',
    'Перев.',
    'Т.контр.',
    'Н.контр.',
    'Затв.',
    'Зм.',
    'Арк.',
    '№ докум.',
    'Підп.',
    'Дата',
    'Літ.',
    'Маса',
    'Масштаб',
    'Аркушів',
    'Копіював',
    'Формат',
  ])
    assert.ok(result.svg.includes(`>${caption}<`) || result.svg.includes(caption));
  assert.match(result.svg, /Вал &lt;контрольний&gt;/);
  assert.match(result.svg, /О\. Петренко/);
  assert.match(result.svg, /04\.11\.26/);
  assert.match(result.svg, /05\.11\.26/);
  assert.doesNotMatch(result.svg, /<контрольний>|2026-11-04|05\.11\.2026/);
  assert.match(field(result.svg, '6').content, />1:5<\/text>/);
});

test('single sheets omit the ordinal, and subsequent sheets omit the required first-sheet fields', () => {
  const single = renderGostForm1(
    part,
    { ...defaultSettings, number: 'TD-001', sheetNumber: '1', sheetCount: '1' },
    420,
    297,
    1,
  );
  assert.match(field(single.svg, '7').content, />Sheet<\/text>/);
  assert.match(field(single.svg, '8').content, />Sheets 1<\/text>/);
  const subsequent = renderGostForm1(
    part,
    {
      ...defaultSettings,
      title: 'Title',
      number: 'TD-001',
      material: 'Steel',
      mass: '1.2',
      litera: 'A',
      organization: 'Factory',
      sheetNumber: '2',
      sheetCount: '3',
    },
    420,
    297,
    1,
  );
  for (const id of ['1', '3', '4', '5', '6', '9'])
    assert.doesNotMatch(field(subsequent.svg, id).content, /<text/);
  assert.match(field(subsequent.svg, '2').content, /TD-001/);
  assert.match(field(subsequent.svg, '7').content, />Sheet 2<\/text>/);
  assert.match(field(subsequent.svg, '8').content, />Sheets<\/text>/);
});

test('inventory fields retain exact bottom-up lengths and combine signatures and dates', () => {
  const result = renderGostForm1(
    part,
    {
      ...defaultSettings,
      inventoryNumber: 'INV-001',
      inventorySignature: 'О.П.',
      inventoryDate: '2026-11-04',
      replacedInventoryNumber: 'OLD-1',
      duplicateInventoryNumber: 'DUP-1',
      duplicateSignature: 'І.К.',
      duplicateDate: '05.11.2026',
    },
    210,
    297,
    1,
  );
  assert.match(
    result.svg,
    /data-gost-inventory="19-23" transform="translate\(5 292\) rotate\(-90\)"/,
  );
  for (const [id, geometry] of Object.entries({
    '19': [0, 5, 25, 7],
    '20': [25, 5, 35, 7],
    '21': [60, 5, 25, 7],
    '22': [85, 5, 25, 7],
    '23': [110, 5, 35, 7],
  }))
    assert.deepEqual(field(result.svg, id).geometry, geometry);
  assert.match(field(result.svg, '20').content, /О\.П\./);
  assert.match(field(result.svg, '20').content, /04\.11\.26/);
  assert.match(field(result.svg, '23').content, /І\.К\./);
  assert.match(field(result.svg, '23').content, /05\.11\.26/);
  assert.deepEqual(result.warnings, []);
});

test('designation field rotates according to paper orientation and reserves drawing space', () => {
  const landscape = renderDrawing(part, [], {
    ...defaultSettings,
    template: 'eskd-uk',
    format: 'A3',
    orientation: 'landscape',
  });
  assert.match(landscape.svg, /data-gost-field="26" transform="translate\(90 19\) rotate\(180\)"/);
  const portrait = renderDrawing(part, [], {
    ...defaultSettings,
    template: 'eskd-uk',
    format: 'A3',
    orientation: 'portrait',
  });
  assert.match(portrait.svg, /data-gost-field="26" transform="translate\(292 5\) rotate\(90\)"/);
  const clip = portrait.svg.match(
    /<clipPath id="sheet-content"><rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/,
  )!;
  assert.equal(Number(clip[2]), 20);
  assert.equal(Number(clip[1]) + Number(clip[3]), 277);
  assert.doesNotMatch(portrait.svg, /ESKD-INSPIRED|GEOMETRIC DRAFT/);
  assert.match(portrait.svg, /СПЕРЕДУ/);
});

test('both GOST languages use 20/5 mm frame margins on all supported standard arrangements', () => {
  for (const template of ['eskd', 'eskd-uk'] as const)
    for (const format of ['A4', 'A3', 'A2', 'A1'] as const)
      for (const orientation of ['portrait', 'landscape'] as const) {
        const settings = { ...defaultSettings, template, format, orientation };
        const [width, height] = paperSize(settings);
        const rendered = renderDrawing(part, [], settings);
        assert.match(
          rendered.svg,
          new RegExp(
            `<rect x="20" y="5" width="${width - 25}" height="${height - 10}" fill="none" stroke-width=".5"`,
          ),
        );
        assert.match(
          rendered.svg,
          new RegExp(
            `data-gost-form="1" data-width="185" data-height="55" transform="translate\\(${width - 190} ${height - 60}\\)"`,
          ),
        );
        assert.equal(Object.keys(rendered.viewTransforms).length, 4);
        assert.doesNotMatch(rendered.svg, /NaN|Infinity/);
        assert.equal(
          rendered.warnings.some((warning) => warning.startsWith('GOST 2.104-68 requires A4')),
          format === 'A4' && orientation === 'landscape',
        );
      }
});
