import { ukMessages } from './i18n-uk';
import { icon } from './icons';
import { escapeHtml } from './utils';

export type UiLanguage = 'en' | 'uk';
export const LANGUAGE_STORAGE_KEY = 'techdraw:language';
export const LANGUAGE_EVENT = 'techdraw:language';
let language: UiLanguage = 'en';
const originals = new WeakMap<Node, { source: string; rendered: string }>();
const attributes = new WeakMap<Element, Map<string, { source: string; rendered: string }>>();
const canonical = new Map<string, string>();
const reverse = new Map(
  Object.entries(ukMessages).map(([source, translated]) => [translated, source]),
);

export function getLanguage(): UiLanguage {
  return language;
}
export function readLanguage(storage?: Pick<Storage, 'getItem'>): UiLanguage {
  try {
    return storage?.getItem(LANGUAGE_STORAGE_KEY) === 'uk' ? 'uk' : 'en';
  } catch {
    return 'en';
  }
}
export function setLanguage(next: UiLanguage, storage?: Pick<Storage, 'setItem'>): UiLanguage {
  if (next !== 'en' && next !== 'uk') throw new RangeError('Unsupported interface language.');
  language = next;
  try {
    storage?.setItem(LANGUAGE_STORAGE_KEY, next);
  } catch {
    /* Editing works without storage. */
  }
  if (typeof document !== 'undefined') {
    document.documentElement.lang = next;
    document.dispatchEvent(new CustomEvent(LANGUAGE_EVENT, { detail: { language: next } }));
  }
  return next;
}

function translated(text: string): string {
  if (Object.hasOwn(ukMessages, text)) return ukMessages[text];
  const rules: [RegExp, (...values: string[]) => string][] = [
    [/^(.+\.(?:step|stp|dxf)): (.+)$/is, (file, reason) => `${file}: ${translated(reason)}`],
    [/^Cannot import DXF: (.*)$/s, (reason) => `Не вдалося імпортувати DXF: ${translated(reason)}`],
    [
      /^Gear manufacturing data is incomplete: (.+)\. Specify these values before manufacture\.$/,
      (labels) =>
        `Параметри виготовлення шестерні неповні: ${labels.split(/,\s*/).map(translated).join(', ')}. Укажіть ці значення перед виготовленням.`,
    ],
    [
      /^Gear tooth count conflicts with measured geometry: specified (\d+), measured (\d+)\. Resolve the mismatch before manufacture\.$/,
      (specified, measured) =>
        `Кількість зубців не відповідає виміряній геометрії: задано ${specified}, виміряно ${measured}. Усуньте невідповідність перед виготовленням.`,
    ],
    [
      /^([0-9]+) DXF text entities were preserved as source notes; their original formatting and placement remain in the original file\.$/,
      (count) =>
        `${count} текстових об’єктів DXF збережено як примітки джерела; оригінальне форматування та положення залишаються у вихідному файлі.`,
    ],
    [
      /^(\d+) paper-space, invisible or hidden-layer entities were omitted\.$/,
      (count) => `Пропущено об’єктів простору аркуша, невидимих або прихованих шарів: ${count}.`,
    ],
    [
      /^DXF source units were explicitly set to (.+)\.$/,
      (unit) => `Одиниці джерела DXF задано явно: ${unit}.`,
    ],
    [
      /^The planar source elevation (.+) was retained in the original file; the 2D drawing uses its XY coordinates\.$/,
      (elevation) =>
        `Вихідну висоту площини ${elevation} збережено в оригінальному файлі; двовимірне креслення використовує координати XY.`,
    ],
    [/^Reading (.+)$/, (name) => `Читання ${name}`],
    [
      /^Projecting (.+) · (front|top|right|isometric) view$/,
      (name, view) => `Проєктування ${name} · ${translated(view)}`,
    ],
    [/^(Anchor X|Anchor Y|Width|Height) \(mm\)$/, (label) => `${translated(label)} (мм)`],
    [
      /^(Symmetric magnitude|Upper deviation|Lower deviation) must be decimal text with at most 9 decimal places and an absolute value no greater than 1000000\.$/,
      (label) =>
        `${label === 'Symmetric magnitude' ? 'Симетричне відхилення' : translated(label)} має бути десятковим числом до 9 знаків після коми та модулем не більше 1000000.`,
    ],
    [
      /^GOST 2\.104-68 requires A4.*$/s,
      () =>
        'ГОСТ 2.104-68 вимагає книжкової орієнтації A4. Виберіть іншу орієнтацію або інший шаблон рамки.',
    ],

    [
      /^Add (horizontal|vertical|aligned|diameter|radius|angle) dimension$/i,
      (kind) => `Додати розмір: ${translated(kind.toLowerCase())}`,
    ],
    [
      /^(Drawn by|Checked by|Technical control|Standard control|Approved by) — (name|signature|date)$/,
      (role, field) => `${translated(role)} — ${translated(field)}`,
    ],
    [
      /^(Deviation|Symmetric deviation|Upper deviation|Lower deviation) \((mm|degrees)\)$/,
      (label, unit) =>
        `${label === 'Deviation' ? 'Відхилення' : label === 'Symmetric deviation' ? 'Симетричне відхилення' : translated(label)} (${translated(unit)})`,
    ],
    [
      /^(Upper deviation|Lower deviation) sign$/,
      (label) => `Знак: ${translated(label).toLowerCase()}`,
    ],
    [
      /^Make (upper|lower) deviation (positive|negative)$/,
      (side, sign) =>
        `${side === 'upper' ? 'Верхнє' : 'Нижнє'} відхилення: ${sign === 'positive' ? 'додатне' : 'від’ємне'}`,
    ],
    [
      /^(\d+) of (\d+) dimensions(?: · (\d+) selected)?$/,
      (visible, total, selected) =>
        `${visible} із ${total} розмірів${selected ? ` · вибрано ${selected}` : ''}`,
    ],
    [
      /^(\d+) selected dimensions? (?:is|are) hidden by filters\. Group actions include them\.$/,
      (count) =>
        `${count} вибраних розмірів приховано фільтрами. Групові дії застосовуються і до них.`,
    ],
    [/^(\d+) dimensions selected$/, (count) => `Вибрано розмірів: ${count}`],
    [/^(\d+) selected$/, (count) => `Вибрано: ${count}`],
    [/^(\d+) locked$/, (count) => `Заблоковано: ${count}`],
    [/^Parameter (\d+)$/, (number) => `Параметр ${number}`],
    [/^Remove parameter (\d+)$/, (number) => `Видалити параметр ${number}`],
    [/^Automatic currently uses (.+)\.$/, (type) => `Автоматично вибрано: ${translated(type)}.`],
    [/^(\d+) locked$/, (count) => `Заблоковано: ${count}`],
    [/^(\d+) more messages?$/, (count) => `Ще повідомлень: ${count}`],
    [/^(\d+) commands? available\.$/, (count) => `Доступно команд: ${count}.`],
    [/^Preview: (.*)$/s, (label) => `Попередній вигляд: ${label}`],
    [/^Include (.*) in PDF$/s, (name) => `Додати ${name} до PDF`],
    [/^Remove (.+)$/s, (name) => `Видалити ${name}`],
    [
      /^Select (.+) (front|top|right) (horizontal|vertical|aligned|diameter|radius|angle)$/s,
      (label, view, kind) => `Вибрати ${label} · ${translated(view)} · ${translated(kind)}`,
    ],
    [
      /^Move selected dimensions (left|right|top|bottom)$/,
      (side) =>
        `Розмістити вибрані розміри ${side === 'left' ? 'зліва' : side === 'right' ? 'справа' : side === 'top' ? 'зверху' : 'знизу'}`,
    ],
    [/^Export PDF · (\d+)$/, (count) => `Експортувати PDF · ${count}`],
    [/^Export · (\d+)$/, (count) => `Експорт · ${count}`],
    [
      /^(\d+) dimensions (aligned|cascaded) (left|right|top|bottom)\.(.*) Undo restores their positions\.$/,
      (count, mode, side, tail) =>
        `${count} розмірів ${mode === 'aligned' ? 'вирівняно' : 'розташовано каскадом'} ${side === 'left' ? 'зліва' : side === 'right' ? 'справа' : side === 'top' ? 'зверху' : 'знизу'}.${tail ? translated(tail.trim()) + ' ' : ' '}Скасування відновлює положення.`,
    ],
    [
      /^(\d+) are incompatible with this side; angles keep their position\.$/,
      (count) => `${count} несумісні з цим боком; кути зберігають положення.`,
    ],
    [
      /^(A[1-4]) · (portrait|landscape) · mm$/,
      (format, orientation) => `${format} · ${translated(orientation)} · мм`,
    ],
    [/^(\d+(?:\.\d+)?) mm shown$/, (spacing) => `Показано ${spacing} мм`],
    [
      /^Zoom in for finer grid lines\. Snapping still uses (.+) mm\.$/,
      (spacing) =>
        `Збільште масштаб для дрібнішої сітки. Прив’язка використовує крок ${spacing} мм.`,
    ],
    [/^Reading (.+)…$/s, (name) => `Читання ${name}…`],
    [
      /^Creating (\d+) vector PDF pages?…$/,
      (count) => `Створення сторінок векторного PDF: ${count}…`,
    ],
    [
      /^Preparing drawing (\d+) of (\d+)…$/,
      (current, total) => `Підготовка креслення ${current} із ${total}…`,
    ],
    [
      /^(\d+) parts? imported\. Review the dimensions before export\.$/,
      (count) => `Імпортовано деталей: ${count}. Перевірте розміри перед експортом.`,
    ],
    [
      /^(\d+) dimensions? deleted\. Undo restores them\.$/,
      (count) => `Видалено розмірів: ${count}. Скасування відновлює їх.`,
    ],
    [/^PDF export failed: (.*)$/s, (reason) => `Помилка експорту PDF: ${translated(reason)}`],
    [
      /^Cannot save project: (.*)$/s,
      (reason) => `Не вдалося зберегти проєкт: ${translated(reason)}`,
    ],
    [
      /^Cannot open project: (.*)$/s,
      (reason) => `Не вдалося відкрити проєкт: ${translated(reason)}`,
    ],
    [
      /^(\d+) technical note lines do not fit on this sheet\. Shorten the notes or choose a wider sheet\.$/,
      (count) =>
        `${count} рядків технічних приміток не вміщуються на аркуші. Скоротіть примітки або виберіть ширший аркуш.`,
    ],
    [
      /^(.+) is shortened in the title block\. Reduce its length to include the full text\.$/,
      (field) =>
        `${translated(field)} скорочено в основному написі. Скоротіть значення, щоб умістити повний текст.`,
    ],
    [
      /^(\d+) profile coordinates are omitted from the balanced suggestions\. Choose All baseline coordinates to inspect them, then keep the dimensions needed for manufacture\.$/,
      (count) =>
        `Збалансований набір не містить ${count} координат профілю. Виберіть усі базові координати для перевірки, а потім залиште потрібні для виготовлення розміри.`,
    ],
    [
      /^(\d+) additional source-circle stations need dimensions\. Use the full dimension set or add them manually\.$/,
      (count) =>
        `${count} додаткових перерізів вихідних кіл потребують розмірів. Використайте повний набір або додайте їх вручну.`,
    ],
    [
      /^Invalid dimension tolerance: (.*)$/s,
      (reason) => `Некоректний допуск розміру: ${translated(reason)}`,
    ],
    [
      /^Invalid manufacturing data: (.*)$/s,
      (reason) => `Некоректні дані виготовлення: ${translated(reason)}`,
    ],
  ];
  for (const [pattern, render] of rules) {
    const match = pattern.exec(text);
    if (match) return render(...match.slice(1));
  }
  if (text.includes(' · ')) return text.split(' · ').map(translated).join(' · ');
  return text;
}

/** Return plain interface text. Callers escape it when inserting it into HTML. */
export function translate(text: string, params: Record<string, string | number> = {}): string {
  const interpolate = (value: string) =>
    value.replace(/\{(\w+)\}/g, (token, key: string) =>
      Object.hasOwn(params, key) ? String(params[key]) : token,
    );
  const source = interpolate(text);
  if (language === 'en') return source;
  const content = source.trim();
  const template = translated(text.trim());
  const result = source.replace(
    content,
    template !== text.trim() ? interpolate(template) : translated(content),
  );
  if (result !== source) {
    if (canonical.size >= 4096) canonical.clear();
    canonical.set(result, source);
  }
  return result;
}
export const t = translate;

const protectedContent =
  'svg,script,style,[contenteditable],[data-user-content],[data-i18n-ignore],.brand,.part-select strong,.source-name,.assembly-branch > summary,.title-block-group > summary > span';
const sourceOf = (value: string) => canonical.get(value) ?? reverse.get(value.trim()) ?? value;

/** Localize interface nodes only. Values, model names and drawing SVG remain untouched. */
export function localizeUi(root: ParentNode): void {
  const visit = (node: Node) => {
    if (node.nodeType === 3) {
      if (node.parentElement?.closest(`${protectedContent},textarea`)) return;
      const value = node.nodeValue ?? '';
      const previous = originals.get(node);
      const source = previous?.rendered === value ? previous.source : sourceOf(value);
      const rendered = translate(source);
      originals.set(node, { source, rendered });
      if (value !== rendered) node.nodeValue = rendered;
      return;
    }
    if (node.nodeType === 1) {
      const element = node as Element;
      if (
        !element.matches('input,textarea') &&
        (element.matches(protectedContent) ||
          element.closest('[data-user-content],[data-i18n-ignore],svg'))
      )
        return;
      const saved = attributes.get(element) ?? new Map();
      for (const name of ['aria-label', 'aria-description', 'title', 'placeholder', 'alt']) {
        if (name === 'placeholder' && element.hasAttribute('data-user-placeholder')) continue;
        const value = element.getAttribute(name);
        if (value === null) continue;
        const previous = saved.get(name);
        const source = previous?.rendered === value ? previous.source : sourceOf(value);
        const rendered = translate(source);
        saved.set(name, { source, rendered });
        if (rendered !== value) element.setAttribute(name, rendered);
      }
      attributes.set(element, saved);
    }
    for (const child of node.childNodes ?? []) visit(child);
  };
  visit(root as Node);
}

export function renderLanguageControl(): string {
  return `<div class="language-control" role="group" aria-label="${escapeHtml(t('Interface language'))}">${(['en', 'uk'] as const).map((value) => `<button type="button" data-action="language:${value}" lang="${value}" aria-label="${escapeHtml(t(value === 'en' ? 'English' : 'Ukrainian'))}" aria-pressed="${language === value}" class="language-button${language === value ? ' active' : ''}">${value === 'en' ? 'EN' : 'UA'}</button>`).join('')}</div>`;
}

export function renderProjectLink(): string {
  return `<a class="github-project" href="https://github.com/defencore/TechDraw" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(t('Project on GitHub'))}" title="${escapeHtml(t('Project on GitHub'))}">${icon('github')}<span>GitHub</span></a>`;
}
