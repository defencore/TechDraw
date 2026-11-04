import assert from 'node:assert/strict';
import test from 'node:test';
import type { Part } from '../src/model';
import {
  manufacturingParameterSections,
  manufacturingProfileDefinition,
} from '../src/manufacturing/catalog';
import { autoDimensions } from '../src/drawing/dimensions';
import { gearDatumReference, gearReferenceCircles } from '../src/drawing/gear-dimensions';
import { initializeDrawing } from '../src/drawing/layout';
import {
  automaticDrawingScales,
  drawingPage,
  STANDARD_DRAWING_SCALES,
} from '../src/drawing/page-layout';
import { parameterTableLayout, renderParameterTable } from '../src/drawing/parameter-table';
import { renderDrawing } from '../src/drawing/render';
import { defaultSettings } from '../src/state';

function samplePart(): Part {
  return {
    id: 'fixture',
    name: 'Public fixture',
    sourceName: 'public.step',
    unit: 'mm',
    path: ['Fixture'],
    bounds: { min: [0, -12, -12], max: [8, 12, 12] },
    warnings: [],
    views: (['front', 'top', 'right', 'iso'] as const).map((id) => ({
      id,
      name: id,
      bounds: { minX: 0, minY: 0, maxX: 24, maxY: 24 },
      edges: [
        {
          id: `${id}-contour`,
          kind: 'line',
          hidden: false,
          points: [
            [0, 0],
            [24, 24],
          ],
        },
      ],
    })),
  };
}
function measuredGear(): Part {
  const part = samplePart();
  part.features = {
    circles: [0, 8].map((x) => ({
      id: `circle-${x}`,
      center: [x, 0, 0],
      normal: [1, 0, 0],
      radius: 2,
      closed: true,
    })),
    gear: {
      axis: { origin: [6, 0, 0], direction: [1, 0, 0] },
      toothDatumDirection: [0, 1, 0],
      toothCount: 20,
      outsideDiameter: 24,
      rootDiameter: 20,
      faceWidth: 4,
      overallLength: 8,
      boreDiameter: 4,
      hubDiameter: 10,
      profile: 'unverified',
      evidence: 'repeated-tip-root-arcs',
    },
  };
  return part;
}

const nonGearPresets = [
  'shaft',
  'bushing',
  'nut',
  'screw',
  'linear-nut',
  'bearing',
  'plate',
  'flange',
  'frame',
  'custom',
] as const;

test('empty General and Automatic profiles leave ordinary drawings free of a parameter table', () => {
  const part = samplePart(),
    normal = drawingPage(defaultSettings);
  assert.equal(drawingPage(defaultSettings, part).parameterTable, undefined);
  part.manufacturing = { type: 'general', profiles: {} };
  assert.equal(drawingPage(defaultSettings, part).parameterTable, undefined);
  assert.deepEqual(drawingPage(defaultSettings, part).content, normal.content);
  part.manufacturing.type = 'auto';
  assert.equal(drawingPage(defaultSettings, part).parameterTable, undefined);
});

test('each non-gear profile prints entered catalog fields and additional rows without inventing requirements', () => {
  for (const type of nonGearPresets) {
    const part = samplePart(),
      definition = manufacturingProfileDefinition(type);
    const field = definition.fields[0];
    part.manufacturing = {
      type,
      profiles: {
        [type]: {
          fields: { [field.key]: 'Engineer-entered value' },
          parameters: [
            { id: 'specific', label: 'Specific parameter', symbol: 'S', value: '12.345 H7' },
          ],
        },
      },
    };
    const source = structuredClone(part),
      page = drawingPage(defaultSettings, part),
      table = page.parameterTable!;
    assert.equal(table.kind, type);
    assert.equal(page.content.maxX + 8, table.bounds.minX);
    assert.equal(
      table.rows.length,
      3,
      'unused catalog requirements do not become blank required rows',
    );
    assert.equal(table.rows[1].label.join(' '), field.label);
    assert.equal(table.rows[1].value.join(' '), 'Engineer-entered value');
    assert.equal(table.rows[2].value.join(' '), '12.345 H7');
    assert.ok(!renderParameterTable(table).includes('Specify'));
    const uk = drawingPage({ ...defaultSettings, template: 'eskd-uk' }, part).parameterTable!;
    assert.equal(uk.rows[1].label.join(' '), field.labelUk);
    assert.equal(
      uk.rows[2].label.join(' '),
      'Specific parameter',
      'custom document labels stay verbatim',
    );
    const ready = initializeDrawing(part, autoDimensions(part), defaultSettings, { arrange: true });
    const rendered = renderDrawing(
      part,
      ready.dimensions,
      defaultSettings,
      undefined,
      ready.layout,
    );
    assert.ok(rendered.svg.includes(`data-parameter-table="${type}"`));
    assert.equal((rendered.svg.match(/data-projection=/g) ?? []).length, 4);
    assert.deepEqual(part, source);
  }
});

test('an empty selected profile has an explicit draft placeholder and General prints only requested data', () => {
  const part = samplePart();
  for (const type of nonGearPresets) {
    part.manufacturing = { type, profiles: {} };
    const table = drawingPage(defaultSettings, part).parameterTable!;
    assert.ok(table.rows[0].label.join(' ').endsWith('DRAFT'));
    assert.equal(table.rows[1].value.join(' '), 'Specify manufacturing requirements');
  }
  part.manufacturing = {
    type: 'general',
    profiles: { general: { fields: { surfaceFinish: 'Ra 1.6' }, parameters: [] } },
  };
  const table = drawingPage(defaultSettings, part).parameterTable!;
  assert.equal(table.kind, 'general');
  assert.equal(table.rows[1].value.join(' '), 'Ra 1.6');
});

test('changing the active profile hides dormant requirements while retaining their exact entered values', () => {
  const part = samplePart();
  part.manufacturing = {
    type: 'shaft',
    profiles: {
      shaft: { fields: { journalFits: 'Ø12 g6' }, parameters: [] },
      plate: { fields: { flatness: '0.02 relative to A' }, parameters: [] },
    },
  };
  const original = structuredClone(part.manufacturing.profiles);
  assert.ok(
    renderParameterTable(drawingPage(defaultSettings, part).parameterTable!).includes('Ø12 g6'),
  );
  part.manufacturing.type = 'plate';
  const markup = renderParameterTable(drawingPage(defaultSettings, part).parameterTable!);
  assert.ok(!markup.includes('Ø12 g6'));
  assert.ok(markup.includes('0.02 relative to A'));
  assert.deepEqual(part.manufacturing.profiles, original);
});

test('an explicit General override disables gear tables, references, auto suggestions and readability rules', () => {
  const part = measuredGear(),
    evidence = structuredClone(part.features);
  assert.equal(drawingPage(defaultSettings, part).parameterTable?.kind, 'gear');
  assert.ok(autoDimensions(part).some((dimension) => dimension.id.includes('-auto-gear-')));
  part.manufacturing = { type: 'general', profiles: {} };
  assert.equal(drawingPage(defaultSettings, part).parameterTable, undefined);
  assert.deepEqual(gearReferenceCircles(part, 'right'), []);
  assert.equal(gearDatumReference(part, 'right'), undefined);
  assert.ok(autoDimensions(part).every((dimension) => !dimension.id.includes('-auto-gear-')));
  assert.deepEqual(automaticDrawingScales(part), STANDARD_DRAWING_SCALES);
  const rendered = renderDrawing(part, [], defaultSettings);
  assert.ok(!rendered.svg.includes('data-gear-reference='));
  assert.ok(!rendered.warnings.some((warning) => warning.startsWith('Gear manufacturing data')));
  assert.deepEqual(part.features, evidence);
  part.manufacturing.type = 'auto';
  assert.equal(drawingPage(defaultSettings, part).parameterTable?.kind, 'gear');
});

test('selecting Gear without detected geometry prints the full draft data table without fabricated reference circles', () => {
  const part = samplePart();
  part.manufacturing = { type: 'gear', profiles: {} };
  const table = drawingPage(defaultSettings, part).parameterTable!;
  assert.equal(table.kind, 'gear');
  assert.ok(table.rows[0].label.join(' ').includes('DRAFT'));
  assert.deepEqual(table.rows.find((row) => row.key === 'module')?.value, ['Specify']);
  assert.deepEqual(gearReferenceCircles(part, 'right'), []);
});

test('custom labels, values and symbols wrap safely and disclose overflow for export', () => {
  const part = samplePart(),
    symbol = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  part.manufacturing = {
    type: 'custom',
    profiles: {
      custom: {
        customName: '<Fixture> & notes',
        fields: {},
        parameters: [
          { id: 'safe"id', label: '<Critical> & condition', symbol, value: 'Entered requirement' },
        ],
      },
    },
  };
  const available = { minX: 20, minY: 25, maxX: 414, maxY: 224 };
  const table = parameterTableLayout(part, defaultSettings, available)!;
  assert.equal(table.rows[1].symbol.join(''), symbol);
  assert.ok(table.rows[1].symbol.length > 1, 'long symbols fit inside their own column');
  const markup = renderParameterTable(table);
  assert.ok(markup.includes('&lt;Fixture&gt; &amp; notes'));
  assert.ok(markup.includes('data-parameter-row="custom-safe&quot;id"'));
  assert.ok(!markup.includes('<Critical>'));
  part.manufacturing.profiles.custom!.parameters = Array.from({ length: 20 }, (_, i) => ({
    id: `row-${i}`,
    label: `Requirement ${i}`,
    value: 'A long entered manufacturing condition '.repeat(10),
  }));
  const overflow = drawingPage(defaultSettings, part).parameterTable!;
  assert.ok(
    overflow.warnings.some((warning) =>
      warning.startsWith('Manufacturing parameter table exceeds'),
    ),
  );
  assert.ok(
    renderDrawing(part, [], defaultSettings).warnings.some((warning) =>
      warning.startsWith('Manufacturing parameter table exceeds'),
    ),
  );
});

test('a cached layout is validated against a new profile table without moving locked or manual geometry', () => {
  const part = samplePart(),
    source = initializeDrawing(part, [], defaultSettings, { arrange: false });
  const saved = structuredClone(source.layout);
  saved.viewTransforms.front.x = drawingPage(defaultSettings).content.maxX - 20;
  part.manufacturing = { type: 'plate', profiles: {} };
  const rendered = renderDrawing(part, [], defaultSettings, undefined, saved);
  assert.deepEqual(rendered.viewTransforms, saved.viewTransforms);
  assert.equal(rendered.scale, saved.scale);
  assert.ok(rendered.warnings.some((warning) => warning.startsWith('Dimensions exceed')));
});

test('frame and nut profiles can print entered bearing and angled-hole requirements with localized section headings', () => {
  for (const type of ['frame', 'nut'] as const) {
    const part = samplePart();
    part.manufacturing = {
      type,
      profiles: {
        [type]: {
          fields: {
            holeIntersections: 'Drill 30° to datum A; break through into channel B.',
            bearingSeats: 'Shaft Ø12 k6; housing Ø28 H7.',
            bearingPreload: 'Engineer-defined preload.',
            driveLead: '4 mm per revolution.',
          },
          parameters: [],
        },
      },
    };
    const original = structuredClone(part);
    for (const template of ['eskd', 'eskd-uk'] as const) {
      const table = drawingPage({ ...defaultSettings, template }, part).parameterTable!;
      for (const id of ['holes-axes', 'linear-drives', 'bearings']) {
        const section = manufacturingParameterSections().find((entry) => entry.id === id)!;
        assert.equal(
          table.rows.find((row) => row.key === `section-${id}`)!.label.join(' '),
          template === 'eskd-uk' ? section.labelUk : section.label,
        );
      }
      assert.equal(
        table.rows.some((row) => row.key === 'section-threads'),
        false,
      );
      assert.equal(
        table.rows.find((row) => row.key === 'field-bearingSeats')!.value.join(' '),
        'Shaft Ø12 k6; housing Ø28 H7.',
      );
      assert.equal(
        table.rows.find((row) => row.key === 'field-holeIntersections')!.value.join(' '),
        'Drill 30° to datum A; break through into channel B.',
      );
      assert.ok(!renderParameterTable(table).includes('Specify'));
    }
    assert.deepEqual(part, original);
  }
});

test('preset fields print once even when their reusable sections contain the same keys', () => {
  const part = samplePart();
  part.manufacturing = {
    type: 'screw',
    profiles: {
      screw: {
        fields: {
          thread: 'Tr10 × 2',
          driveLead: '2 mm',
          threadHand: 'Right',
          surfaceFinish: 'Ra 1.6',
          coating: 'Engineer-entered coating',
        },
        parameters: [],
      },
    },
  };
  const table = drawingPage(defaultSettings, part).parameterTable!;
  for (const key of ['thread', 'driveLead', 'threadHand', 'surfaceFinish', 'coating'])
    assert.equal(table.rows.filter((row) => row.key === `field-${key}`).length, 1);
  const threadIndex = table.rows.findIndex((row) => row.key === 'field-thread');
  const threadsSectionIndex = table.rows.findIndex((row) => row.key === 'section-threads');
  assert.ok(
    threadIndex < threadsSectionIndex,
    'preset thread is printed before supplementary thread-hand data',
  );
  assert.equal(
    table.rows.some((row) => row.key === 'section-linear-drives'),
    false,
    'a section consumed entirely by preset fields stays absent',
  );
});

test('Gear supplemental requirements append to the same table without changing its specialized rows or inactive data', () => {
  const part = measuredGear(),
    available = { minX: 20, minY: 25, maxX: 414, maxY: 224 };
  const baseline = parameterTableLayout(part, defaultSettings, available)!;
  part.manufacturing = {
    type: 'gear',
    profiles: {
      gear: {
        fields: {
          bearingSeats: 'Housing seat Ø28 H7',
          holeIntersections: 'Cross-hole 30° to A',
          thread: 'M5 × 0.8',
        },
        parameters: [
          {
            id: 'inspection-extra',
            label: 'Custom inspection',
            symbol: 'Q',
            value: 'Engineer supplied',
          },
        ],
      },
    },
  };
  const stored = structuredClone(part.manufacturing);
  const combined = parameterTableLayout(part, defaultSettings, available)!;
  assert.deepEqual(combined.rows.slice(0, baseline.rows.length), baseline.rows);
  assert.ok(combined.bounds.maxY > baseline.bounds.maxY);
  assert.equal(combined.bounds.minX, baseline.bounds.minX);
  assert.ok(combined.rows.some((row) => row.key === 'supplemental'));
  assert.equal(
    combined.rows.find((row) => row.key === 'field-thread')!.value.join(' '),
    'M5 × 0.8',
  );
  assert.equal(combined.rows.at(-1)!.key, 'custom-inspection-extra');
  part.manufacturing.type = 'general';
  assert.equal(parameterTableLayout(part, defaultSettings, available), undefined);
  part.manufacturing.type = 'gear';
  assert.deepEqual(part.manufacturing, stored);
  assert.deepEqual(parameterTableLayout(part, defaultSettings, available), combined);
});

test('supplemental Gear text participates in the shared page reservation and overflow validation', () => {
  const part = measuredGear(),
    baseline = drawingPage(defaultSettings, part).parameterTable!;
  assert.ok(
    !baseline.warnings.some((warning) => warning.startsWith('Gear parameter table exceeds')),
  );
  part.manufacturing = {
    type: 'gear',
    profiles: {
      gear: {
        fields: {
          inspection: 'Entered acceptance and inspection requirement. '.repeat(20),
        },
        parameters: [],
      },
    },
  };
  const combined = drawingPage(defaultSettings, part).parameterTable!;
  assert.ok(combined.bounds.maxY > baseline.bounds.maxY);
  assert.ok(
    combined.warnings.some((warning) => warning.startsWith('Gear parameter table exceeds')),
  );
  assert.ok(
    renderDrawing(part, [], defaultSettings).warnings.some((warning) =>
      warning.startsWith('Gear parameter table exceeds'),
    ),
  );
});
