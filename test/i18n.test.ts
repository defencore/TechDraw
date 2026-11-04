import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getLanguage,
  readLanguage,
  setLanguage,
  translate,
  localizeUi,
  LANGUAGE_STORAGE_KEY,
  renderLanguageControl,
  renderProjectLink,
} from '../src/ui/i18n';
import { getCommands, type CommandContext } from '../src/ui/command-registry';
import { field } from '../src/ui/components';

test.afterEach(() => setLanguage('en'));

test('language is strictly restored and storage failures do not prevent a session change', () => {
  assert.equal(readLanguage(), 'en');
  for (const value of ['ua', 'UK', '"uk"', '', 'false'])
    assert.equal(readLanguage({ getItem: () => value }), 'en');
  assert.equal(readLanguage({ getItem: () => 'uk' }), 'uk');
  const values = new Map<string, string>();
  setLanguage('uk', {
    setItem: (key, value) => {
      values.set(key, value);
    },
  });
  assert.equal(values.get(LANGUAGE_STORAGE_KEY), 'uk');
  assert.equal(getLanguage(), 'uk');
  setLanguage('en', {
    setItem() {
      throw new Error('denied');
    },
  });
  assert.equal(getLanguage(), 'en');
  assert.equal(
    readLanguage({
      getItem() {
        throw new Error('denied');
      },
    }),
    'en',
  );
});

test('static and parameterized interface copy translate without translating supplied drawing text', () => {
  setLanguage('uk');
  assert.equal(translate('Material'), 'Матеріал');
  assert.equal(translate('Reading {file}…', { file: 'Material.step' }), 'Читання Material.step…');
  assert.equal(
    translate('Preview: {label}', { label: 'Ø6 H7 Material' }),
    'Попередній вигляд: Ø6 H7 Material',
  );
  assert.equal(translate('Include Front in PDF'), 'Додати Front до PDF');
  assert.equal(
    translate('Some custom engineering instruction'),
    'Some custom engineering instruction',
  );
  for (const inherited of ['constructor', 'toString', '__proto__'])
    assert.equal(translate(inherited), inherited);
  assert.equal(translate('{constructor}'), '{constructor}');
  assert.equal(translate('6 of 20 dimensions · 2 selected'), '6 із 20 розмірів · вибрано 2');
});

class TextNode {
  nodeType = 3;
  childNodes: never[] = [];
  constructor(
    public nodeValue: string,
    public parentElement?: ElementNode,
  ) {}
}
class ElementNode {
  nodeType = 1;
  childNodes: (ElementNode | TextNode)[] = [];
  parentElement?: ElementNode;
  constructor(
    readonly tag: string,
    readonly attrs: Record<string, string> = {},
  ) {}
  append(...children: (ElementNode | TextNode)[]) {
    for (const child of children) {
      child.parentElement = this;
      this.childNodes.push(child);
    }
    return this;
  }
  getAttribute(name: string) {
    return this.attrs[name] ?? null;
  }
  setAttribute(name: string, value: string) {
    this.attrs[name] = value;
  }
  hasAttribute(name: string) {
    return Object.hasOwn(this.attrs, name);
  }
  matches(selector: string): boolean {
    return selector.split(',').some((rule) => {
      rule = rule.trim();
      if (rule.startsWith('[') && rule.endsWith(']')) return this.hasAttribute(rule.slice(1, -1));
      if (rule.startsWith('.'))
        return this.attrs.class?.split(' ').includes(rule.slice(1)) ?? false;
      return rule === this.tag;
    });
  }
  closest(selector: string): ElementNode | null {
    return this.matches(selector) ? this : (this.parentElement?.closest(selector) ?? null);
  }
}

test('DOM localization preserves user fields and drawing SVG through repeated language changes', () => {
  const copy = new TextNode('Material');
  const name = new TextNode('Material');
  const note = new TextNode('Material');
  const drawing = new TextNode('Material');
  const input = new ElementNode('input', { value: 'Material', placeholder: 'Optional' });
  const textarea = new ElementNode('textarea', {
    'data-user-content': '',
    placeholder: 'Notes for the engineer or customer',
  }).append(note);
  const root = new ElementNode('div').append(
    new ElementNode('span').append(copy),
    new ElementNode('h1', { 'data-user-content': '' }).append(name),
    input,
    textarea,
    new ElementNode('svg').append(new ElementNode('text').append(drawing)),
  );
  for (let pass = 0; pass < 5; pass++) {
    setLanguage('uk');
    localizeUi(root as unknown as ParentNode);
    assert.equal(copy.nodeValue, 'Матеріал');
    assert.equal(input.attrs.placeholder, 'Необов’язково');
    assert.equal(textarea.attrs.placeholder, 'Примітки для інженера або замовника');
    setLanguage('en');
    localizeUi(root as unknown as ParentNode);
    assert.equal(copy.nodeValue, 'Material');
    assert.equal(input.attrs.placeholder, 'Optional');
    for (const node of [name, note, drawing]) assert.equal(node.nodeValue, 'Material');
    assert.equal(input.attrs.value, 'Material');
  }
});

test('localized field labels and header controls preserve document values and user placeholders', () => {
  setLanguage('uk');
  const markup = field('Drawing title', 'title', 'Front', 'Material', true);
  assert.match(markup, /Назва креслення/);
  assert.match(markup, /value="Front"/);
  assert.match(markup, /placeholder="Material" data-user-placeholder/);
  assert.match(renderLanguageControl(), /data-action="language:uk"[^>]*aria-pressed="true"/);
  assert.match(renderProjectLink(), /https:\/\/github.com\/defencore\/TechDraw/);
});

test('commands use localized labels and readonly viewer availability without changing their IDs', () => {
  const ready: CommandContext = {
    busy: false,
    partCount: 1,
    hasActivePart: true,
    selectedPartCount: 1,
    selectionCount: 2,
    dimensionCount: 8,
    canUndo: true,
    canRedo: true,
  };
  const english = getCommands(ready);
  setLanguage('uk');
  const ukrainian = getCommands(ready);
  assert.deepEqual(
    ukrainian.map((command) => command.id),
    english.map((command) => command.id),
  );
  assert.equal(
    ukrainian.find((command) => command.id === 'save-project')?.label,
    'Зберегти проєкт креслення',
  );
  const viewer = getCommands({ ...ready, viewerMode: true });
  assert.equal(viewer.find((command) => command.id === 'tool:rectangle')?.enabled, false);
  assert.equal(viewer.find((command) => command.id === 'share-drawing')?.enabled, true);
  assert.equal(viewer.find((command) => command.id === 'exit-viewer')?.hidden, false);
  assert.match(viewer.find((command) => command.id === 'undo')?.disabledReason ?? '', /Вийдіть/);
  const annotation = getCommands({ ...ready, selectionCount: 0, annotationSelection: true });
  for (const [id, label] of [
    ['delete-selected-dimensions', 'Видалити позначку'],
    ['fit-selection', 'Вписати вибрану позначку'],
    ['edit-dimension', 'Редагувати позначку'],
  ]) {
    assert.equal(annotation.find((command) => command.id === id)?.enabled, true);
    assert.equal(annotation.find((command) => command.id === id)?.label, label);
  }
  assert.equal(
    annotation.find((command) => command.id === 'place-dimensions:left')?.enabled,
    false,
  );
});
