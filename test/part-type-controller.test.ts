import assert from 'node:assert/strict';
import test from 'node:test';
import type { ManufacturingData, ManufacturingProfile, Part } from '../src/model';
import { PartTypeEditorController } from '../src/ui/part-type-controller';
import { effectivePartType } from '../src/manufacturing/catalog';

function editor() {
  const part = {
    id: 'part-a',
    name: 'Example',
    manufacturing: { type: 'general', profiles: {} },
  } as Part;
  let raw: ManufacturingProfile = {
    fields: { inspection: 'Unapplied inspection text' },
    parameters: [],
  };
  let commits = 0;
  const controller = new PartTypeEditorController({
    active: () => part,
    busy: () => false,
    commit(_id, data: ManufacturingData) {
      part.manufacturing = structuredClone(data);
      commits++;
      return true;
    },
    render() {},
    report() {},
  });
  const form = {
    get dataset() {
      return { profileType: effectivePartType(part) };
    },
    querySelectorAll(selector: string) {
      if (selector === '[data-profile-field]')
        return Object.entries(raw.fields).map(([key, value]) => ({
          dataset: { profileField: key },
          value,
        }));
      if (selector.startsWith('.manufacturing-parameter-row'))
        return raw.parameters.map((row) => ({
          dataset: { parameterId: row.id },
          querySelector(selector: string) {
            const key = selector.match(/="([^"]+)"/)?.[1];
            return { value: row[key as 'label' | 'symbol' | 'value'] ?? '' };
          },
        }));
      return [];
    },
    querySelector() {
      return undefined;
    },
  };
  const root = { querySelector: () => form } as unknown as ParentNode;
  const input = { closest: () => form } as unknown as HTMLElement;
  return {
    part,
    controller,
    root,
    input,
    setRaw(value: ManufacturingProfile) {
      raw = value;
    },
    get commits() {
      return commits;
    },
  };
}

test('switching types retains unapplied fields and applies only the active profile in one explicit commit', () => {
  const context = editor();
  context.controller.handleInput(context.root, context.input);
  context.controller.handleTypeChange(context.root, 'shaft');
  assert.equal(context.part.manufacturing?.type, 'shaft');
  assert.equal(context.controller.draft(context.part), undefined);
  context.setRaw({ fields: { thread: 'M6×1-6g' }, parameters: [] });
  context.controller.handleInput(context.root, context.input);
  context.controller.handleTypeChange(context.root, 'general');
  assert.equal(
    context.controller.draft(context.part)?.fields.inspection,
    'Unapplied inspection text',
  );
  const pending = context.controller.preparePending([context.part]);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].type, 'general');
  context.controller.commitPending(pending);
  assert.equal(
    context.part.manufacturing?.profiles.general?.fields.inspection,
    'Unapplied inspection text',
  );
  assert.equal(
    context.part.manufacturing?.profiles.shaft,
    undefined,
    'Inactive raw fields do not become applied manufacturing requirements',
  );
  context.setRaw({ fields: { inspection: 'Unapplied inspection text' }, parameters: [] });
  context.controller.handleTypeChange(context.root, 'shaft');
  assert.equal(context.controller.draft(context.part)?.fields.thread, 'M6×1-6g');
});

test('an invalid inactive custom draft cannot block exporting another profile but is still available for correction', () => {
  const context = editor();
  context.controller.handleTypeChange(context.root, 'custom');
  context.setRaw({ fields: {}, parameters: [{ id: 'row', label: '', value: '8' }] });
  context.controller.handleInput(context.root, context.input);
  assert.throws(() => context.controller.preparePending([context.part]), /name/);
  context.controller.handleTypeChange(context.root, 'shaft');
  assert.deepEqual(context.controller.preparePending([context.part]), []);
  context.setRaw({ fields: {}, parameters: [] });
  context.controller.handleTypeChange(context.root, 'custom');
  assert.equal(context.controller.draft(context.part)?.parameters[0].value, '8');
  context.controller.clearPart(context.part.id);
  assert.equal(context.controller.draft(context.part), undefined);
});

test('Undo of a type switch preserves raw text while Undo of applied values cannot be reversed by export', () => {
  const context = editor();
  context.part.manufacturing!.profiles.general = {
    fields: { inspection: 'Previously saved B' },
    parameters: [],
  };
  context.setRaw({ fields: { inspection: 'Applied A' }, parameters: [] });
  context.controller.apply(context.root);
  assert.equal(context.part.manufacturing?.profiles.general?.fields.inspection, 'Applied A');
  context.setRaw({ fields: { inspection: 'Unapplied +-' }, parameters: [] });
  context.controller.handleTypeChange(context.root, 'shaft');
  context.part.manufacturing!.type = 'general'; // Undo the type change, keeping its profile data.
  assert.equal(context.controller.draft(context.part)?.fields.inspection, 'Unapplied +-');
  context.part.manufacturing!.profiles.general = {
    fields: { inspection: 'Previously saved B' },
    parameters: [],
  }; // Undo the earlier Apply.
  assert.equal(context.controller.draft(context.part), undefined);
  assert.deepEqual(context.controller.preparePending([context.part]), []);
  assert.equal(
    context.part.manufacturing?.profiles.general?.fields.inspection,
    'Previously saved B',
  );
});

test('history invalidates an inactive draft even if a later Redo restores its original baseline', () => {
  const context = editor();
  context.part.manufacturing!.profiles.general = { fields: { inspection: 'A' }, parameters: [] };
  context.controller.handleInput(context.root, context.input);
  context.controller.handleTypeChange(context.root, 'gear');
  context.part.manufacturing!.profiles.general = { fields: { inspection: 'B' }, parameters: [] };
  context.controller.draft(context.part); // History rerenders while Gear is selected.
  context.part.manufacturing!.profiles.general = { fields: { inspection: 'A' }, parameters: [] };
  context.part.manufacturing!.type = 'general';
  assert.equal(context.controller.draft(context.part), undefined);
  assert.deepEqual(context.controller.preparePending([context.part]), []);
});

test('export checks baselines independently when a history render has not requested the draft', () => {
  const context = editor();
  context.controller.handleInput(context.root, context.input);
  context.part.manufacturing!.profiles.general = {
    fields: { inspection: 'Restored data' },
    parameters: [],
  };
  assert.deepEqual(context.controller.preparePending([context.part]), []);
});

test('Gear supplemental requirements participate in Apply/export without changing the gear specification', () => {
  const context = editor();
  context.part.gearSpecification = { type: 'external-spur', teeth: 24 };
  context.controller.handleTypeChange(context.root, 'gear');
  context.setRaw({
    fields: { holeAxes: 'Pin axis at 15° to datum A', surfaceFinish: 'Ra 1.6' },
    parameters: [],
  });
  context.controller.handleInput(context.root, context.input);
  assert.equal(
    context.controller.draft(context.part)?.fields.holeAxes,
    'Pin axis at 15° to datum A',
  );
  const pending = context.controller.preparePending([context.part]);
  assert.equal(pending[0].type, 'gear');
  context.controller.commitPending(pending);
  assert.equal(context.part.manufacturing?.profiles.gear?.fields.surfaceFinish, 'Ra 1.6');
  assert.deepEqual(context.part.gearSpecification, { type: 'external-spur', teeth: 24 });
});
