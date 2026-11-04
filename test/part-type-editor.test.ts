import assert from 'node:assert/strict';
import test from 'node:test';
import type { ManufacturingProfile, ManufacturingProfileType, Part } from '../src/model';
import {
  PART_TYPES,
  manufacturingParameterSections,
  manufacturingProfileDefinition,
  manufacturingProfileFields,
} from '../src/manufacturing/catalog';
import { captureManufacturingProfile, renderPartTypeEditor } from '../src/ui/part-type-editor';
import { renderGearEditor } from '../src/ui/gear-editor';
import { setLanguage, translate } from '../src/ui/i18n';

const part: Part = {
  id: 'part',
  name: 'Example',
  sourceName: 'example.step',
  unit: 'mm',
  path: ['example.step', 'Example'],
  views: [],
  warnings: [],
  bounds: { min: [0, 0, 0], max: [10, 20, 30] },
};
const profileTypes = PART_TYPES.filter((entry) => entry.id !== 'auto').map(
  (entry) => entry.id,
) as ManufacturingProfileType[];

test.afterEach(() => setLanguage('en'));

test('General and Custom collapse empty common requirements but open supplied ones', () => {
  for (const type of ['general', 'custom'] as const) {
    const model: Part = { ...part, manufacturing: { type, profiles: {} } };
    const empty = renderPartTypeEditor(model);
    assert.match(
      empty,
      /class="manufacturing-universal-group manufacturing-general-requirements"><summary>/,
    );
    assert.ok(
      empty.indexOf('id="manufacturing-custom-name"') <
        empty.indexOf('manufacturing-general-requirements'),
    );
    const filled = renderPartTypeEditor(model, {
      fields: { inspection: 'Verify fit' },
      parameters: [],
    });
    assert.match(
      filled,
      /class="manufacturing-universal-group manufacturing-general-requirements" open>/,
    );
    assert.match(filled, /Verify fit/);
  }
  const shaft = renderPartTypeEditor({ ...part, manufacturing: { type: 'shaft', profiles: {} } });
  assert.doesNotMatch(shaft, /manufacturing-general-requirements/);
});

test('every selectable generic type has a working profile and the selector stays outside its form', () => {
  for (const type of profileTypes) {
    const markup = renderPartTypeEditor({ ...part, manufacturing: { type, profiles: {} } });
    assert.ok(markup.indexOf('id="part-type"') < markup.indexOf('<form'));
    assert.match(markup, new RegExp(`data-profile-type="${type}"`));
    assert.match(markup, /data-profile-action="apply"/);
    assert.match(markup, /data-profile-action="add-row"/);
    for (const field of manufacturingProfileDefinition(type).fields)
      assert.match(markup, new RegExp(`data-profile-field="${field.key}"`));
    assert.doesNotMatch(markup, /Coming soon/i);
  }
  const markup = renderPartTypeEditor(part);
  assert.deepEqual(
    [...markup.matchAll(/<option value="([^"]+)"/g)].map((match) => match[1]),
    PART_TYPES.map((entry) => entry.id),
  );
  assert.match(markup, /value="auto" selected/);
});

test('explicit types control the visible profile without mutating inactive profiles or legacy gear data', () => {
  const model: Part = {
    ...part,
    gearSpecification: { type: 'external-spur', teeth: 24 },
    manufacturing: {
      type: 'shaft',
      profiles: {
        shaft: { fields: { journalFits: 'Journal fit H7/g6' }, parameters: [] },
        plate: { fields: { thickness: 'Plate thickness 5±0.1' }, parameters: [] },
      },
    },
  };
  const before = structuredClone(model);
  const shaft = renderPartTypeEditor(model);
  assert.match(shaft, /Journal fit H7\/g6/);
  assert.doesNotMatch(shaft, /Plate thickness 5±0\.1/);
  const autoGear = renderPartTypeEditor({
    ...model,
    manufacturing: { ...model.manufacturing!, type: 'auto' },
  });
  assert.match(autoGear, /data-profile-type="gear"/);
  assert.match(autoGear, /id="part-type"/);
  assert.deepEqual(model, before);
});

test('capture preserves partial raw requirements and custom rows while whitelisting profile fields', () => {
  const fields = [
    { dataset: { profileField: 'thickness' }, value: ' 5 ± ' },
    { dataset: { profileField: 'inspection' }, value: 'Inspect <datum>\nThen verify.' },
    { dataset: { profileField: 'unknownField' }, value: 'not a catalog value' },
  ];
  const row = {
    dataset: { parameterId: 'row-a' },
    querySelector(selector: string) {
      const key = selector.match(/="([^"]+)"/)?.[1];
      return { value: key === 'label' ? ' Special <check> ' : key === 'symbol' ? 'Ø' : '+/-' };
    },
  };
  const form = {
    dataset: { profileType: 'plate' },
    querySelectorAll: (selector: string) => (selector === '[data-profile-field]' ? fields : [row]),
    querySelector: () => null,
  };
  const root = { querySelector: () => form } as unknown as ParentNode;
  assert.deepEqual(captureManufacturingProfile(root), {
    fields: { thickness: ' 5 ± ', inspection: 'Inspect <datum>\nThen verify.' },
    parameters: [{ id: 'row-a', label: ' Special <check> ', symbol: 'Ø', value: '+/-' }],
  });
});

test('custom text stays escaped and partial while disabled forms cannot change type or submit', () => {
  const draft: ManufacturingProfile = {
    customName: 'Material <type>',
    fields: { inspection: 'Keep <this> & verify' },
    parameters: [{ id: 'row-1', label: '<width>', symbol: 'Ø', value: '+0.0' }],
  };
  const markup = renderPartTypeEditor(
    { ...part, manufacturing: { type: 'custom', profiles: {} } },
    draft,
    false,
  );
  assert.match(markup, /id="part-type" data-manufacturing-type disabled/);
  assert.match(markup, /<fieldset class="manufacturing-profile-fields" disabled>/);
  assert.match(markup, /id="manufacturing-custom-name"[^>]*value="Material &lt;type&gt;"/);
  assert.match(markup, /Keep &lt;this&gt; &amp; verify/);
  assert.match(markup, /data-parameter-field="value"[^>]*value="\+0\.0"/);
  assert.doesNotMatch(markup, /<width>|<this>|<type>/);
  assert.equal(draft.parameters[0].value, '+0.0');
});

test('catalog labels localize while entered manufacturing values remain untouched', () => {
  setLanguage('uk');
  for (const type of profileTypes) {
    const definition = manufacturingProfileDefinition(type as ManufacturingProfileType);
    assert.equal(translate(definition.label), definition.labelUk);
    for (const field of definition.fields) assert.equal(translate(field.label), field.labelUk);
  }
  for (const section of manufacturingParameterSections()) {
    assert.equal(translate(section.label), section.labelUk);
    for (const field of section.fields) assert.equal(translate(field.label), field.labelUk);
  }
  const markup = renderPartTypeEditor(
    { ...part, manufacturing: { type: 'custom', profiles: {} } },
    {
      fields: { inspection: 'Inspect Material as written' },
      parameters: [],
      customName: 'Shaft',
    },
  );
  assert.match(markup, /Тип деталі/);
  assert.match(markup, /Вимоги до контролю/);
  assert.match(markup, /Inspect Material as written/);
  assert.match(markup, /value="Shaft"/);
  assert.match(
    translate(
      'Manufacturing parameter table exceeds the drawing area. Shorten the entered data or choose a larger sheet before export.',
    ),
    /більший аркуш/,
  );
});

test('universal groups work on unrelated presets and filled groups open without repeating primary fields', () => {
  const fields = { holeAxes: 'Pin axis at 15° to <datum A>', thread: 'M6×1-6H', driveLead: '5 mm' };
  const model: Part = { ...part, manufacturing: { type: 'bushing', profiles: {} } };
  const markup = renderPartTypeEditor(model, { fields, parameters: [] });
  assert.match(markup, /data-manufacturing-section="holes-axes" open/);
  assert.match(markup, /data-manufacturing-section="threads" open/);
  assert.match(markup, /data-manufacturing-section="linear-drives" open/);
  assert.match(markup, /Pin axis at 15° to &lt;datum A&gt;/);
  assert.match(markup, /data-profile-field="driveLead"[^>]*value="5 mm"/);
  const rendered = [...markup.matchAll(/data-profile-field="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(rendered).size, rendered.length);
  assert.deepEqual(
    [...rendered].sort(),
    manufacturingProfileFields('bushing')
      .map((field) => field.key)
      .sort(),
  );
  const shaft = renderPartTypeEditor({ ...part, manufacturing: { type: 'shaft', profiles: {} } });
  assert.equal((shaft.match(/data-profile-field="thread"/g) ?? []).length, 1);
  assert.match(markup, /Profile name \(optional\)/);
});

test('Gear supplement is a working sibling form and captures universal requirements separately', () => {
  const model: Part = {
    ...part,
    gearSpecification: { type: 'external-spur', teeth: 24 },
    manufacturing: { type: 'gear', profiles: {} },
  };
  const markup = renderPartTypeEditor(
    model,
    { fields: { holeAxes: 'Measured pin-axis relation' }, parameters: [] },
    true,
    renderGearEditor(model),
  );
  assert.match(markup, /id="gear-editor-form"/);
  assert.match(markup, /id="manufacturing-profile-form" data-profile-type="gear"/);
  assert.ok(markup.indexOf('</form>') < markup.indexOf('id="manufacturing-profile-form"'));
  assert.match(markup, /data-manufacturing-section="holes-axes" open/);
  assert.doesNotMatch(markup, /id="manufacturing-custom-name"/);
  const form = {
    dataset: { profileType: 'gear' },
    querySelectorAll: (selector: string) =>
      selector === '[data-profile-field]'
        ? [{ dataset: { profileField: 'holeAxes' }, value: 'Pin axis ±0.05' }]
        : [],
    querySelector: () => null,
  };
  assert.deepEqual(
    captureManufacturingProfile({ querySelector: () => form } as unknown as ParentNode),
    { fields: { holeAxes: 'Pin axis ±0.05' }, parameters: [] },
  );
  assert.equal(model.gearSpecification?.teeth, 24);
});
