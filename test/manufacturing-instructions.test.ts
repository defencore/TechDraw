import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Dimension, Part } from '../src/model';
import { defaultSettings } from '../src/state';
import { drawingSettingsForInstructions } from '../src/drawing/manufacturing-instructions';
import { drawingPage } from '../src/drawing/page-layout';
import { initializeDrawing } from '../src/drawing/layout';
import { renderDrawing } from '../src/drawing/render';
import { wrapSheetNotes } from '../src/drawing/sheet-notes';
import { renderManufacturingInstructions } from '../src/ui/manufacturing-instructions';

const part: Part = {
  id: 'plate',
  name: 'Precision plate',
  sourceName: 'plate.step',
  path: ['plate'],
  unit: 'mm',
  bounds: { min: [0, 0, 0], max: [80.125, 50, 12] },
  warnings: [],
  views: (['front', 'top', 'right', 'iso'] as const).map((id) => ({
    id,
    name: id,
    bounds: {
      minX: 0,
      minY: 0,
      maxX: id === 'right' ? 50 : 80.125,
      maxY: id === 'front' || id === 'right' ? 12 : 50,
    },
    edges: [
      {
        id: `${id}-edge`,
        kind: 'line',
        hidden: false,
        points: [
          [0, 0],
          [40, 12],
        ],
      },
    ],
  })),
};
const dimensions: Dimension[] = [
  {
    id: 'length',
    viewId: 'front',
    kind: 'horizontal',
    a: [0, 0],
    b: [80.125, 0],
    value: 80.125,
    offset: 10,
    automatic: false,
  },
];
const instructions = Array.from(
  { length: 10 },
  (_, i) => `Perform entered operation ${i + 1}; inspect its result.`,
).join('\n');

test('per-part effective settings number entered steps without changing cached general notes or user text', () => {
  const settings = { ...defaultSettings, notes: 'Dimensions in mm.\nGeneral note.' };
  const effective = drawingSettingsForInstructions(
    settings,
    'Deburr edges.\r\n\r\nInspect <fit> & finish.',
  );
  assert.equal(settings.notes, 'Dimensions in mm.\nGeneral note.');
  assert.equal(
    effective.notes,
    'Dimensions in mm.\nGeneral note.\n\nManufacturing instructions\n1. Deburr edges.\n2. Inspect <fit> & finish.',
  );
  assert.equal(drawingSettingsForInstructions(settings, ' \n'), settings);
  assert.match(
    drawingSettingsForInstructions(settings, '7. Keep this step number.').notes,
    /7\. Keep this step number\./,
  );
  assert.match(
    drawingSettingsForInstructions({ ...settings, template: 'eskd-uk' }, 'Перевірити поверхню.')
      .notes,
    /Вказівки щодо виготовлення\n1\. Перевірити поверхню\./,
  );
});

test('view packing, preview and export reserve exactly the same numbered instruction footprint', () => {
  const settings = { ...defaultSettings, template: 'iso' as const };
  const effective = drawingSettingsForInstructions(settings, instructions);
  const page = drawingPage(effective),
    normal = drawingPage(settings);
  assert.equal(page.notes.placement, 'above-title');
  assert.ok(page.content.maxY < normal.content.maxY);
  const source = structuredClone(dimensions);
  const initialized = initializeDrawing(part, dimensions, effective, { arrange: false });
  const preview = renderDrawing(part, dimensions, settings, undefined, undefined, { instructions });
  const exported = renderDrawing(part, dimensions, settings, undefined, initialized.layout, {
    instructions,
  });
  assert.deepEqual(preview.viewTransforms, initialized.layout.viewTransforms);
  assert.equal(preview.scale, initialized.layout.scale);
  assert.equal(exported.svg, preview.svg);
  assert.deepEqual(dimensions, source);
  assert.match(preview.svg, /80\.13/);
  assert.match(preview.svg, /1\. Perform entered operation 1/);
  assert.match(preview.svg, /10\. Perform entered operation 10/);
  assert.ok(
    !preview.warnings.some((message) =>
      /technical note lines do not fit|Dimensions exceed/.test(message),
    ),
  );
});

test('note panels stay inside every sheet format and preserve frame-language captions', () => {
  for (const format of ['A4', 'A3', 'A2', 'A1'] as const)
    for (const orientation of ['portrait', 'landscape'] as const) {
      const settings = drawingSettingsForInstructions(
        { ...defaultSettings, template: 'iso', format, orientation },
        instructions,
      );
      const page = drawingPage(settings),
        note = page.notes;
      const lastBaseline = note.y + (note.lines.length - 1) * note.lineHeight;
      assert.ok(note.x >= page.left && note.x + note.width < page.width - page.right);
      assert.ok(note.y > page.content.maxY);
      if (note.placement === 'above-title')
        assert.ok(
          lastBaseline + note.fontSize * 0.3 < page.height - page.bottom - page.blockHeight,
        );
      assert.ok(page.fittingArea.maxY > page.fittingArea.minY);
    }
  const uk = renderDrawing(
    part,
    dimensions,
    { ...defaultSettings, template: 'eskd-uk' },
    undefined,
    undefined,
    { instructions: 'Перевірити отвори.' },
  );
  assert.match(uk.svg, /Вказівки щодо виготовлення/);
  assert.doesNotMatch(uk.svg, />Manufacturing instructions</);
});

test('long requirements disclose overflow and larger sheets increase the available instruction capacity', () => {
  const text = Array.from({ length: 100 }, (_, i) => `Required operation ${i + 1}`).join('\n');
  const smallSettings = {
    ...defaultSettings,
    format: 'A4' as const,
    orientation: 'portrait' as const,
  };
  const small = renderDrawing(part, dimensions, smallSettings, undefined, undefined, {
    instructions: text,
  });
  assert.ok(small.warnings.some((message) => message.includes('technical note lines do not fit')));
  assert.match(small.svg, /Required operation \d+\.\.\./);
  const smallPage = drawingPage(drawingSettingsForInstructions(smallSettings, text));
  const largePage = drawingPage(
    drawingSettingsForInstructions({ ...smallSettings, format: 'A1' }, text),
  );
  assert.ok(largePage.notes.lines.length > smallPage.notes.lines.length);
  assert.ok(largePage.notes.omitted < smallPage.notes.omitted);
});

test('frozen locked positions remain unchanged and are reported if new instructions occupy their area', () => {
  const settings = { ...defaultSettings, template: 'iso' as const, scale: 1 };
  const layout = renderDrawing(part, dimensions, settings);
  const next = renderDrawing(part, dimensions, settings, undefined, layout, { instructions });
  assert.deepEqual(next.viewTransforms, layout.viewTransforms);
  assert.equal(next.scale, layout.scale);
  assert.ok(next.warnings.some((message) => message.startsWith('Dimensions exceed')));
});

test('wrapping and the inline editor preserve literal entered instructions and expose explicit Apply/reset', () => {
  assert.deepEqual(wrapSheetNotes('First step.\nSecond step.', 100, 3), [
    'First step.',
    'Second step.',
  ]);
  const text = 'Machine <edge> & inspect.\n</textarea><script>bad()</script>';
  const html = renderManufacturingInstructions(text, true, { dirty: true, locked: true });
  assert.match(html, /id="manufacturing-instructions" data-user-content/);
  assert.match(html, /&lt;\/textarea&gt;&lt;script&gt;/);
  assert.match(html, /data-instructions-action="apply"/);
  assert.match(html, /Locked drawing positions will be kept/);
  assert.doesNotMatch(html, /<script>|window\.prompt/);
  assert.match(
    renderManufacturingInstructions('', false),
    /placeholder="One manufacturing step per line" disabled/,
  );
});
