import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DrawingAnnotation, Part } from '../src/model';
import {
  annotationBounds,
  renderAnnotation,
  translateAnnotation,
} from '../src/drawing/annotations';
import { applyDrawingAppearance, drawingPalette } from '../src/drawing/appearance';
import { calculateDrawingLayout } from '../src/drawing/page-layout';
import { renderDrawing } from '../src/drawing/render';
import { defaultSettings } from '../src/state';
import {
  createAnnotation,
  defaultAnnotationOptions,
  extendAnnotation,
  pickAnnotation,
} from '../src/ui/annotation-tools';
import { readAnnotationEdit, renderAnnotationEditor } from '../src/ui/annotation-editor';
import { annotationColor, DEFAULT_ANNOTATION_COLOR } from '../src/drawing/annotation-style';

const note: DrawingAnnotation = {
  id: 'note',
  kind: 'text',
  points: [[20, 30]],
  text: 'Check <&> "fit"\n#20262b white',
  fontSize: 3.5,
  strokeWidth: 0.35,
};
const part: Part = {
  id: 'flat',
  name: 'DXF profile',
  sourceName: 'profile.dxf',
  sourceKind: 'dxf',
  path: ['profile'],
  unit: 'mm',
  bounds: { min: [0, 0, 0], max: [100, 0, 50] },
  warnings: [],
  views: [
    {
      id: 'front',
      name: 'Front',
      bounds: { minX: 0, minY: 0, maxX: 100, maxY: 50 },
      edges: [
        {
          id: 'edge',
          kind: 'line',
          hidden: false,
          points: [
            [0, 0],
            [100, 50],
          ],
        },
      ],
    },
  ],
};

test('multiline text annotations are escaped and their full physical bounds move independently of source geometry', () => {
  const markup = renderAnnotation(note),
    bounds = annotationBounds(note);
  assert.match(markup, /Check &lt;&amp;&gt; &quot;fit&quot;/);
  assert.match(markup, /#20262b white/);
  assert.equal((markup.match(/<text /g) ?? []).length, 2);
  assert.ok(bounds.minY < 30 && bounds.maxY > 34);
  const moved = translateAnnotation(note, [12, -7]);
  const next = annotationBounds(moved);
  assert.equal(next.minX - bounds.minX, 12);
  assert.ok(Math.abs(next.maxY - bounds.maxY + 7) < 1e-10);
  assert.deepEqual(note.points, [[20, 30]]);
  assert.equal(moved.text, note.text);
  assert.throws(() => translateAnnotation(note, [NaN, 0]), RangeError);
});

test('review graphics export portable vector primitives with explicit arrowheads and no SVG markers', () => {
  for (const kind of ['arrow', 'rectangle', 'ellipse', 'freehand'] as const) {
    const annotation: DrawingAnnotation = {
      id: kind,
      kind,
      points: [
        [10, 10],
        [40, 30],
      ],
      strokeWidth: 0.5,
    };
    const markup = renderAnnotation(annotation);
    assert.match(markup, new RegExp(`data-annotation-kind="${kind}"`));
    assert.doesNotMatch(markup, /marker|filter|foreignObject/);
    if (kind === 'arrow') assert.match(markup, / Z" fill="#e34d59" stroke="none"/);
    if (kind === 'ellipse') assert.match(markup, /rx="15" ry="10"/);
    const moved = translateAnnotation(annotation, [-3, 6]);
    assert.deepEqual(moved.points, [
      [7, 16],
      [37, 36],
    ]);
    assert.deepEqual(annotation.points, [
      [10, 10],
      [40, 30],
    ]);
  }
});

test('blueprint changes SVG paint attributes without changing document text or geometric coordinates', () => {
  const paper = renderAnnotation(note),
    blue = renderAnnotation(note, false, 'blueprint');
  const palette = drawingPalette('blueprint');
  assert.match(blue, new RegExp(`fill="${palette.background}"`));
  assert.match(blue, new RegExp(`fill="${DEFAULT_ANNOTATION_COLOR}"`));
  assert.match(blue, /#20262b white/);
  assert.equal(applyDrawingAppearance(paper, 'paper'), paper);
  assert.doesNotMatch(blue, /filter/);
  const settings = { ...defaultSettings, scale: 1 };
  const normal = renderDrawing(part, [], settings, undefined, undefined, { annotations: [note] });
  const blueprint = renderDrawing(part, [], settings, undefined, normal, {
    appearance: 'blueprint',
    annotations: [note],
  });
  assert.deepEqual(blueprint.viewTransforms, normal.viewTransforms);
  assert.equal(blueprint.scale, normal.scale);
  assert.match(blueprint.svg, /background:#082c49/);
  assert.match(blueprint.svg, /#20262b white/);
  assert.match(blueprint.svg, /data-review-annotations/);
  for (const tag of blueprint.svg.match(/<[^>]+>/g) ?? []) {
    const attributes = tag.replace(/^<\/?[\w:-]+/, '').replace(/\/?\s*>$/, '');
    const remainder = attributes.replace(/\s+[\w:-]+\s*=\s*(?:"[^"]*"|'[^']*')/g, '');
    assert.equal(remainder.trim(), '', `Standalone SVG attributes must be quoted XML: ${tag}`);
  }
});

test('committed annotation colors survive blueprint conversion even when they equal drawing palette colors', () => {
  for (const color of ['#e34d59', '#20262b', '#ffffff', '#16745e', '#7d858a', '#082c49']) {
    const annotation = { ...note, id: 'custom-color', color };
    for (const appearance of ['paper', 'blueprint'] as const) {
      const output = renderDrawing(part, [], defaultSettings, undefined, undefined, {
        annotations: [annotation],
        appearance,
      });
      const group = output.svg.match(
        /<g data-annotation-id="custom-color"[^>]*>[\s\S]*?<\/g>/,
      )?.[0];
      assert.ok(group);
      assert.match(group, new RegExp(`stroke="${color}"`));
      assert.match(group, new RegExp(`<text[^>]*fill="${color}"`));
      const selected = renderAnnotation(annotation, true, appearance);
      assert.match(selected, new RegExp(`<text[^>]*fill="${color}"`));
      assert.match(selected, /class="annotation-selection"[^>]*stroke="#6ee7ff"/);
    }
    assert.equal(translateAnnotation(annotation, [5, 6]).color, color);
  }
});

test('annotation color controls use strict hex values and preserve selected changes as a draft until Apply', () => {
  assert.equal(annotationColor(), '#e34d59');
  assert.equal(annotationColor('#AABBCC'), '#aabbcc');
  for (const color of ['red', '#fff', '#11223344', 'url(javascript:test)', '#fff" stroke="red']) {
    assert.throws(() => annotationColor(color), RangeError);
    assert.throws(
      () => createAnnotation('arrow', [10, 20], { ...defaultAnnotationOptions, color }),
      RangeError,
    );
  }
  const selected: DrawingAnnotation = {
    id: 'arrow',
    kind: 'arrow',
    points: [
      [10, 20],
      [30, 40],
    ],
    strokeWidth: 0.35,
    color: '#2678d4',
  };
  const root = {
    querySelector(selector: string) {
      return selector === '[data-annotation-setting="color"]' ? { value: '#8B5BD6' } : undefined;
    },
  } as unknown as ParentNode;
  const edited = readAnnotationEdit(root, selected);
  assert.equal(edited.color, '#8b5bd6');
  assert.equal(selected.color, '#2678d4');
  const form = renderAnnotationEditor(selected);
  assert.match(form, /id="annotation-color"[^>]*value="#2678d4"/);
  assert.equal((form.match(/data-annotation-color=/g) ?? []).length, 6);
  assert.match(form, /data-annotation-action="apply"/);
  assert.doesNotMatch(form, /data-annotation-action="place"/);
  const textCue = renderAnnotationEditor(undefined, defaultAnnotationOptions, 'text');
  assert.equal(textCue, '');
  assert.doesNotMatch(
    renderAnnotationEditor(undefined, defaultAnnotationOptions, 'arrow'),
    /annotation-text|data-annotation-action="place"/,
  );
});

test('a flat DXF receives one authoritative front projection and its own largest fitting scale', () => {
  const layout = calculateDrawingLayout(part, [], { ...defaultSettings, scale: 'auto' });
  assert.equal(layout.arrangement, 'single-view');
  assert.ok(layout.fits && layout.scale >= 1);
  const drawing = renderDrawing(part, [], { ...defaultSettings, scale: 'auto' });
  assert.equal((drawing.svg.match(/data-projection=/g) ?? []).length, 1);
  assert.match(drawing.svg, /data-projection="front"/);
  assert.doesNotMatch(drawing.svg, /data-projection="iso"/);
});

test('annotation picking is stable in screen pixels and transparent shapes do not intercept their empty interiors', () => {
  const arrow: DrawingAnnotation = {
    id: 'arrow',
    kind: 'arrow',
    points: [
      [10, 10],
      [50, 10],
    ],
    strokeWidth: 0.35,
  };
  assert.equal(pickAnnotation([arrow], [30, 13], 2), 'arrow');
  assert.equal(pickAnnotation([arrow], [30, 13], 8), undefined);
  const box: DrawingAnnotation = {
    ...arrow,
    id: 'box',
    kind: 'rectangle',
    points: [
      [10, 10],
      [50, 50],
    ],
  };
  assert.equal(pickAnnotation([box], [30, 30], 4), undefined);
  assert.equal(pickAnnotation([box], [10, 30], 4), 'box');
  assert.equal(pickAnnotation([note], [21, 29], 4), 'note');
});

test('freehand drawing is bounded and smooth while blank text cannot become an accidental note', () => {
  assert.throws(
    () => createAnnotation('text', [20, 30], defaultAnnotationOptions),
    /Annotation text cannot be empty/,
  );
  assert.throws(
    () =>
      createAnnotation('text', [20, 30], { ...defaultAnnotationOptions, text: 'Bad\u0001text' }),
    RangeError,
  );
  let path = createAnnotation('freehand', [20, 30], defaultAnnotationOptions);
  assert.equal(extendAnnotation(path, [20.01, 30.01]), path);
  path = { ...path, points: Array.from({ length: 4096 }, (_, index) => [20 + index, 30]) };
  path = extendAnnotation(path, [6000, 30]);
  assert.ok(path.points.length <= 4096);
  assert.deepEqual(path.points.at(-1), [6000, 30]);
  const warning = renderDrawing(part, [], defaultSettings, undefined, undefined, {
    annotations: [{ ...note, points: [[-5, 30]] }],
  }).warnings;
  assert.ok(warning.some((message) => message.startsWith('Review annotations exceed')));
});

test('inline graphic editing changes paper position and size while preserving reversed drawing direction', () => {
  const rectangle: DrawingAnnotation = {
    id: 'box',
    kind: 'rectangle',
    points: [
      [60, 70],
      [20, 30],
    ],
    strokeWidth: 0.35,
  };
  const values: Record<string, string> = {
    x: '80',
    y: '90',
    width: '25',
    height: '15',
    strokeWidth: '.5',
  };
  const root = {
    querySelector(selector: string) {
      const key = selector.match(/="([^"]+)"/)?.[1];
      return key && key in values ? { value: values[key] } : undefined;
    },
  } as unknown as ParentNode;
  const edited = readAnnotationEdit(root, rectangle);
  assert.deepEqual(edited.points, [
    [80, 90],
    [55, 75],
  ]);
  assert.equal(edited.strokeWidth, 0.5);
  assert.deepEqual(rectangle.points, [
    [60, 70],
    [20, 30],
  ]);
  values.width = '-1';
  assert.throws(() => readAnnotationEdit(root, rectangle), /positive graphic size/);
  const html = renderAnnotationEditor(note);
  assert.match(html, /data-annotation-action="edit-text"/);
  assert.doesNotMatch(html, /<textarea|data-annotation-coordinate=|data-annotation-setting=/);
  assert.match(html, /Check &lt;&amp;&gt;/);
  assert.doesNotMatch(html, /window\.prompt|onclick=/);
  const graphic = renderAnnotationEditor(rectangle);
  assert.match(graphic, /data-annotation-action="apply"/);
  assert.match(graphic, /data-annotation-coordinate="x"/);
});
