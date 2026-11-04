import assert from 'node:assert/strict';
import test from 'node:test';
import type { Part } from '../src/model';
import {
  effectivePartType,
  activeManufacturingProfile,
  hasManufacturingData,
  manufacturingProfileDefinition,
  manufacturingProfileFields,
  manufacturingParameterSections,
  parseManufacturingData,
  parseManufacturingProfile,
  PART_TYPES,
} from '../src/manufacturing/catalog';

const part = { name: 'Reference model' } as Part;
test('automatic classification preserves existing gear recognition while an explicit type takes precedence', () => {
  const gear = { ...part, gearSpecification: { type: 'external-spur' as const, teeth: 16 } };
  assert.equal(effectivePartType(part), 'general');
  assert.equal(effectivePartType(gear), 'gear');
  assert.equal(
    effectivePartType({ ...gear, manufacturing: { type: 'auto', profiles: {} } }),
    'gear',
  );
  const general = { ...gear, manufacturing: { type: 'general' as const, profiles: {} } };
  assert.equal(effectivePartType(general), 'general');
  assert.equal(hasManufacturingData(general), false);
  assert.equal(gear.gearSpecification.teeth, 16);
});

test('profile values remain namespaced, normalised and independent rather than leaking into another type', () => {
  const data = parseManufacturingData({
    type: 'shaft',
    profiles: {
      shaft: {
        fields: { thread: ' M10×1-6g ', inspection: 'Inspect after finishing' },
        parameters: [],
      },
      plate: { fields: { thickness: ' 4 ±0.1 mm ' }, parameters: [] },
    },
  });
  const model = { ...part, manufacturing: data };
  assert.equal(activeManufacturingProfile(model)?.fields.thread, 'M10×1-6g');
  data.type = 'plate';
  assert.equal(activeManufacturingProfile(model)?.fields.thickness, '4 ±0.1 mm');
  assert.equal(activeManufacturingProfile(model)?.fields.thread, undefined);
  assert.equal(data.profiles.shaft?.fields.thread, 'M10×1-6g');
  assert.equal(hasManufacturingData(model), true);
});

test('all selectable profiles have working fields; custom rows keep user labels and units verbatim', () => {
  for (const entry of PART_TYPES) {
    if (entry.id === 'auto') continue;
    const definition = manufacturingProfileDefinition(entry.id);
    assert.ok(definition.label && definition.labelUk);
    assert.ok(manufacturingProfileFields(entry.id).length);
    assert.ok(definition.fields.every((field) => field.label && field.labelUk));
  }
  const custom = parseManufacturingProfile('custom', {
    customName: 'Fixture datum',
    fields: {},
    parameters: [
      { id: 'row-a', label: 'Clamping allowance', symbol: 'a', value: '2.5 mm' },
      { id: 'empty', label: '', symbol: '', value: '' },
    ],
  });
  assert.deepEqual(custom.parameters, [
    { id: 'row-a', label: 'Clamping allowance', symbol: 'a', value: '2.5 mm' },
  ]);
  assert.equal(custom.customName, 'Fixture datum');
});

test('profile validation rejects unknown or unrelated preset fields, unsafe text, ambiguous rows and unbounded data', () => {
  const profile = { fields: {}, parameters: [] };
  for (const data of [
    { type: 'unknown', profiles: {} },
    { type: 'plate', profiles: { unknown: profile } },
    { type: 'plate', profiles: { plate: { ...profile, fields: { nutHeight: 'M4' } } } },
    { type: 'plate', profiles: { plate: { ...profile, fields: { inventedField: 'M4' } } } },
    { type: 'plate', profiles: { plate: { ...profile, fields: { thickness: 4 } } } },
    { type: 'plate', profiles: { plate: { ...profile, fields: { thickness: 'Bad\u0001text' } } } },
    {
      type: 'custom',
      profiles: { custom: { ...profile, parameters: [{ id: 'a', label: '', value: '5' }] } },
    },
    {
      type: 'custom',
      profiles: {
        custom: {
          ...profile,
          parameters: Array.from({ length: 21 }, (_, i) => ({
            id: String(i),
            label: 'x',
            value: '1',
          })),
        },
      },
    },
  ])
    assert.throws(() => parseManufacturingData(data), /Invalid manufacturing data/);
  assert.throws(
    () =>
      parseManufacturingProfile('custom', {
        ...profile,
        parameters: [
          { id: 'same', label: 'A', value: '1' },
          { id: 'same', label: 'B', value: '2' },
        ],
      }),
    /unique/,
  );
});

test('nuts, screws, linear nuts, bearings, frames and standoffs expose useful explicit presets without inventing defaults', () => {
  for (const type of ['nut', 'screw', 'linear-nut', 'bearing', 'frame'] as const)
    assert.ok(PART_TYPES.some((entry) => entry.id === type));
  assert.equal(manufacturingProfileDefinition('frame').label, 'Frame / bulkhead');
  assert.equal(manufacturingProfileDefinition('frame').labelUk, 'Рама / шпангоут');
  const inputs = {
    nut: { thread: 'M6 × 1-6H', acrossFlats: '10 ±0.1' },
    screw: { thread: 'Tr8×2', driveLead: 'Lead 8 mm / pitch 2 mm / 4 starts' },
    'linear-nut': {
      driveDesignation: 'Engineer-selected ball screw',
      drivePreload: 'Specified by designer',
      recirculation: 'External return, per referenced model',
    },
    bearing: {
      bearingDesignation: 'Engineer-selected bearing',
      bearingSeats: 'Shaft k6 / housing H7',
    },
    frame: {
      joiningRequirements: 'Weld sequence per assembly drawing',
      frameAlignment: 'Datum A/B/C, perpendicularity 0.1',
    },
    bushing: { standoffInterfaces: 'M3 ends, length defined by the drawing' },
  };
  for (const [type, fields] of Object.entries(inputs)) {
    const data = parseManufacturingData({ type, profiles: { [type]: { fields, parameters: [] } } });
    assert.deepEqual(data.profiles[type as keyof typeof data.profiles]?.fields, fields);
    assert.deepEqual(
      parseManufacturingData({ type, profiles: { [type]: { fields: {}, parameters: [] } } })
        .profiles[type as keyof typeof data.profiles]?.fields,
      {},
    );
  }
});

test('universal sections cover complex hole axes and mechanical requirements on every profile, including gears', () => {
  const sections = manufacturingParameterSections();
  assert.deepEqual(
    sections.map((section) => section.id),
    ['holes-axes', 'threads', 'fits-datums', 'linear-drives', 'bearings', 'material-process'],
  );
  const all = sections.flatMap((section) => section.fields);
  assert.equal(new Set(all.map((field) => field.key)).size, all.length);
  assert.ok(
    sections.every(
      (section) =>
        section.label &&
        section.labelUk &&
        section.fields.every((field) => field.label && field.labelUk),
    ),
  );
  const fields = {
    holeAxes: 'Axis H1: from datum A origin, 30° to B; intersect channel H2',
    holeDepths: 'Blind depth 12 ±0.1, drill point per drawing',
    threadDiameter: 'M8',
    threadPitch: '1.25 mm',
    threadStarts: '1',
    threadHand: 'Right',
    threadClass: '6H',
    driveLead: '4 mm / rev',
    drivePreload: 'Engineer supplied',
    bearingSeats: 'Fits per designer',
    stockMaterial: 'Material per part specification',
    manufacturingProcess: 'Finish critical datums after joining',
  };
  for (const type of PART_TYPES.filter((entry) => entry.id !== 'auto').map((entry) => entry.id)) {
    const parsed = parseManufacturingData({
      type,
      profiles: { [type]: { fields, parameters: [] } },
    });
    assert.deepEqual(parsed.profiles[type as keyof typeof parsed.profiles]?.fields, fields);
  }
  const gear = {
    ...part,
    gearSpecification: { type: 'external-spur' as const, teeth: 24 },
    manufacturing: parseManufacturingData({
      type: 'gear',
      profiles: {
        gear: {
          fields,
          parameters: [
            {
              id: 'gear-extra',
              label: 'Cross hole',
              symbol: 'Ø',
              value: 'M4 thread; locate from tooth datum A',
            },
          ],
        },
      },
    }),
  };
  assert.equal(activeManufacturingProfile(gear)?.fields.threadClass, '6H');
  assert.equal(gear.gearSpecification.teeth, 24);
  assert.equal(manufacturingProfileDefinition('gear').fields.length, 0);
});

test('preset and universal field unions retain stable preset order and validate shared field limits consistently', () => {
  for (const type of PART_TYPES.filter((entry) => entry.id !== 'auto').map((entry) => entry.id)) {
    const preset = manufacturingProfileDefinition(type as Exclude<typeof type, 'auto'>).fields;
    const union = manufacturingProfileFields(type as Exclude<typeof type, 'auto'>);
    assert.deepEqual(union.slice(0, preset.length), preset);
    assert.equal(new Set(union.map((field) => field.key)).size, union.length);
  }
  const long = 'x'.repeat(1000);
  assert.equal(
    parseManufacturingProfile('gear', { fields: { holeAxes: long }, parameters: [] }).fields
      .holeAxes,
    long,
  );
  assert.throws(
    () =>
      parseManufacturingProfile('plate', {
        fields: { threadClass: 'x'.repeat(401) },
        parameters: [],
      }),
    /bounded plain text/,
  );
  assert.throws(
    () =>
      parseManufacturingProfile('nut', { fields: { holeAxes: 'x'.repeat(1001) }, parameters: [] }),
    /bounded plain text/,
  );
  assert.throws(
    () =>
      parseManufacturingProfile('bearing', { fields: { holeAxes: 'bad\uD800' }, parameters: [] }),
    /bounded plain text/,
  );
});
