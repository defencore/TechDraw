import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DrawingAnnotation } from '../src/model';
import { defaultAnnotationOptions } from '../src/ui/annotation-tools';
import {
  textAnnotationFromDraft,
  textEditorPosition,
  type TextAnnotationSession,
} from '../src/ui/text-annotation-controller';

const session: TextAnnotationSession = {
  partId: 'part-a',
  point: [30, 45],
  options: { ...defaultAnnotationOptions, strokeWidth: 0.5 },
};
const draft = { text: 'Check the bore\nConfirm before machining', color: '#2678d4', fontSize: 4 };

test('new note drafts create one independent physical annotation without changing tool defaults', () => {
  const note = textAnnotationFromDraft(session, draft);
  assert.equal(note.kind, 'text');
  assert.ok(note.id);
  assert.deepEqual(note.points, [[30, 45]]);
  assert.equal(note.text, draft.text);
  assert.equal(note.fontSize, 4);
  assert.equal(note.color, '#2678d4');
  assert.equal(note.strokeWidth, 0.5);
  note.points[0][0] = 99;
  assert.deepEqual(session.point, [30, 45]);
  assert.equal(session.options.text, '');
});

const original: DrawingAnnotation = {
  id: 'note-a',
  kind: 'text',
  points: [[71.2, 52.5]],
  text: 'Original',
  color: '#e34d59',
  fontSize: 3.5,
  strokeWidth: 0.25,
};

test('the same composer edits text and style while retaining identity, exact placement and stroke width', () => {
  const edited = textAnnotationFromDraft({ ...session, annotation: original }, draft);
  assert.equal(edited.id, original.id);
  assert.deepEqual(edited.points, original.points);
  assert.equal(edited.strokeWidth, original.strokeWidth);
  assert.equal(edited.text, draft.text);
  assert.equal(edited.color, draft.color);
  assert.equal(original.text, 'Original');
  edited.points[0][0] = 0;
  assert.equal(original.points[0][0], 71.2);
});

test('invalid or locked text drafts cannot change the existing note', () => {
  for (const values of [
    { ...draft, text: ' \n ' },
    { ...draft, text: 'Bad\u0001text' },
    { ...draft, text: 'x'.repeat(10001) },
    { ...draft, fontSize: NaN },
    { ...draft, fontSize: 0 },
    { ...draft, color: 'red' },
  ])
    assert.throws(() => textAnnotationFromDraft({ ...session, annotation: original }, values));
  assert.throws(
    () => textAnnotationFromDraft({ ...session, annotation: { ...original, locked: true } }, draft),
    /Unlock/,
  );
  assert.throws(() =>
    textAnnotationFromDraft({ ...session, annotation: { ...original, kind: 'arrow' } }, draft),
  );
  assert.equal(original.text, 'Original');
  assert.equal(original.color, '#e34d59');
});

test('desktop editor stays next to the note and moves inside the screen near its edges', () => {
  const viewport = { left: 0, top: 0, width: 1200, height: 800 };
  const normal = textEditorPosition(viewport, { width: 360, height: 500 }, [300, 200]);
  assert.deepEqual(normal, { left: 316, top: 152, maxHeight: 776 });
  const edge = textEditorPosition(viewport, { width: 360, height: 500 }, [1190, 790]);
  assert.equal(edge.left, 814);
  assert.equal(edge.top, 288);
});

test('phone editor remains within the visual viewport above an open keyboard', () => {
  const viewport = { left: 5, top: 100, width: 390, height: 320 };
  const position = textEditorPosition(viewport, { width: 366, height: 600 }, [200, 750]);
  assert.deepEqual(position, { left: 17, top: 112, maxHeight: 296 });
  const landscape = textEditorPosition(
    { left: 0, top: 0, width: 844, height: 260 },
    { width: 360, height: 500 },
    [800, 250],
  );
  assert.equal(landscape.top, 12);
  assert.equal(landscape.maxHeight, 236);
  assert.ok(landscape.left >= 12 && landscape.left + 360 <= 832);
});
