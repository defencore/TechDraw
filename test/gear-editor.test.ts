import assert from 'node:assert/strict';
import test from 'node:test';
import type { Part } from '../src/model';
import {
  captureGearEditor,
  handleGearEditorClick,
  parseGearEditorDraft,
  readGearEditor,
  renderGearEditor,
  syncGearEditorType,
  type GearEditorDraft,
} from '../src/ui/gear-editor';
import { setLanguage, translate } from '../src/ui/i18n';

const part: Part = {
  id: 'gear',
  name: '24-tooth module 1 gear',
  sourceName: 'example.step',
  unit: 'mm',
  path: ['example.step', 'gear'],
  views: [],
  warnings: [],
  bounds: { min: [0, -13, -13], max: [9, 13, 13] },
  features: {
    circles: [],
    gear: {
      axis: { origin: [0, 0, 0], direction: [1, 0, 0] },
      toothCount: 24,
      outsideDiameter: 26,
      rootDiameter: 21.5,
      faceWidth: 5,
      boreDiameter: 6.02,
      hubDiameter: 12,
      overallLength: 9,
      profile: 'unverified',
      evidence: 'repeated-tip-root-arcs',
    },
  },
};
const rootWith = (values: GearEditorDraft) =>
  ({
    querySelectorAll: () =>
      Object.entries(values).map(([key, value]) => ({
        dataset: { gearField: key },
        value,
      })),
  }) as unknown as ParentNode;

test.afterEach(() => setLanguage('en'));

test('geometry can supply tooth count while the source name never supplies a module or gear type', () => {
  const before = structuredClone(part);
  const markup = renderGearEditor(part);
  assert.match(markup, /data-gear-field="teeth"[^>]*value="24"/);
  for (const key of ['normalModule', 'normalPressureAngle', 'profileShift'])
    assert.match(markup, new RegExp(`data-gear-field="${key}"[^>]*value=""`));
  assert.match(markup, /<option value="" selected>Choose gear type</);
  assert.match(markup, /Unverified source-name hints/);
  assert.match(markup, /Names are labels, not manufacturing data/);
  assert.match(markup, /class="gear-helical-fields" disabled/);
  assert.deepEqual(part, before);
});

test('raw drafts preserve partial signed input and inactive helix values without inventing zero', () => {
  const raw: GearEditorDraft = {
    type: 'external-helical',
    teeth: '24',
    normalModule: '1,25',
    normalPressureAngle: '',
    profileShift: '-',
    helixAngle: '17,5',
    helixHand: 'left',
  };
  assert.deepEqual(captureGearEditor(rootWith(raw)), raw);
  assert.match(renderGearEditor(part, raw), /data-gear-field="profileShift"[^>]*value="-"/);
  assert.throws(() => parseGearEditorDraft(raw), /decimal value/);
  const helical = readGearEditor(rootWith({ ...raw, profileShift: '0' }));
  assert.equal(helical.normalModule, 1.25);
  assert.equal(helical.helixAngle, 17.5);
  assert.equal(helical.normalPressureAngle, undefined);
  assert.equal(helical.profileShift, 0);
  const spur = parseGearEditorDraft({
    ...raw,
    type: 'external-spur',
    profileShift: '',
    helixAngle: '-',
  });
  assert.equal(spur.profileShift, undefined);
  assert.equal(spur.helixAngle, undefined);
  assert.equal(spur.helixHand, undefined);
  assert.equal(raw.profileShift, '-');
});

test('UI parsing retains the shared specification limits and rejects control text and misleading numeric syntax', () => {
  for (const value of ['1e2', '0x10', 'Infinity', '1,2,3', '+'])
    assert.throws(() => parseGearEditorDraft({ type: 'external-spur', normalModule: value }));
  assert.throws(() => parseGearEditorDraft({ type: 'external-spur', teeth: '24.5' }), /integer/);
  assert.throws(
    () => parseGearEditorDraft({ type: 'external-spur', inspection: 'bad\u0001note' }),
    /plain text/,
  );
  assert.throws(
    () => parseGearEditorDraft({ type: 'external-spur', accuracy: 'a'.repeat(401) }),
    /plain text/,
  );
  assert.throws(() => parseGearEditorDraft({ type: '' }), /choose an external/);
  const html = renderGearEditor(part, { type: 'external-spur', inspection: '<check> & verify' });
  assert.match(html, /&lt;check&gt; &amp; verify/);
  assert.doesNotMatch(html, /<check>/);
});

test('switching the helix controls only changes availability and leaves their draft intact', () => {
  const helical = { disabled: true };
  const type = { value: 'external-helical' };
  const form = { dataset: { enabled: 'true' } };
  const root = {
    querySelector: (selector: string) =>
      selector === '#gear-type' ? type : selector === '#gear-editor-form' ? form : helical,
  } as unknown as ParentNode;
  syncGearEditorType(root);
  assert.equal(helical.disabled, false);
  type.value = 'external-spur';
  syncGearEditorType(root);
  assert.equal(helical.disabled, true);
  type.value = 'external-helical';
  form.dataset.enabled = 'false';
  syncGearEditorType(root);
  assert.equal(helical.disabled, true);
});

test('symbol insertion replaces the selected range and emits the normal draft input event', () => {
  let selection: unknown[] = [],
    focused = false,
    event: Event | undefined;
  const field = {
    value: 'M=12 +0.05',
    selectionStart: 5,
    selectionEnd: 6,
    disabled: false,
    setRangeText(...args: unknown[]) {
      selection = args;
    },
    focus() {
      focused = true;
    },
    dispatchEvent(next: Event) {
      event = next;
    },
  };
  const control = {
    dataset: { gearSymbol: '±', gearSymbolTarget: 'inspection' },
    disabled: false,
    closest: () => null,
  };
  const target = { closest: () => control } as unknown as Element;
  const root = { querySelector: () => field } as unknown as ParentNode;
  assert.equal(handleGearEditorClick(root, target), true);
  assert.deepEqual(selection, ['±', 5, 6, 'end']);
  assert.equal(focused, true);
  assert.equal(event?.type, 'input');
  assert.equal(event?.bubbles, true);
  field.disabled = true;
  selection = [];
  handleGearEditorClick(root, target);
  assert.deepEqual(selection, []);
});

test('gear labels and parser guidance localize without rewriting engineering text', () => {
  setLanguage('uk');
  const markup = renderGearEditor(part, { type: 'external-spur', inspection: 'Check W ±0.05' });
  assert.match(markup, /Параметри шестерні/);
  assert.match(markup, /Нормальний модуль \(мм\)/);
  assert.match(markup, /Check W ±0.05/);
  assert.throws(
    () => parseGearEditorDraft({ type: 'external-spur', profileShift: '-' }),
    /десяткове число/,
  );
  assert.match(
    translate('Invalid gear data: normal module is outside the supported range.'),
    /нормальний модуль/,
  );
});
