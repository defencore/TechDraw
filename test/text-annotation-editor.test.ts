import assert from 'node:assert/strict';
import test from 'node:test';
import type { DrawingAnnotation } from '../src/model';
import { renderTextAnnotationEditor } from '../src/ui/text-annotation-editor';
import { defaultAnnotationOptions } from '../src/ui/annotation-tools';
import { readAnnotationEdit, renderAnnotationEditor } from '../src/ui/annotation-editor';
import { renderMarkupGuide } from '../src/ui/markup-guide';

test('one accessible native form creates a note without exposing a separate line-width setting', () => {
  const markup = renderTextAnnotationEditor({
    options: { ...defaultAnnotationOptions, text: '<inspect> & verify', color: '#2678D4' },
  });
  assert.match(markup, /<form id="text-note-form"[^>]*aria-labelledby="text-note-title"/);
  assert.match(markup, /id="text-note-content" data-user-content/);
  assert.equal((markup.match(/id="text-note-content"/g) ?? []).length, 1);
  assert.match(markup, /&lt;inspect&gt; &amp; verify/);
  assert.doesNotMatch(markup, /<inspect>|stroke-width|strokeWidth|Line width/);
  assert.match(markup, /id="text-note-color"[^>]*value="#2678d4"/);
  assert.match(markup, /id="text-note-preview" data-user-content/);
  assert.match(markup, /type="submit"[^>]*>Add note</);
  assert.equal((markup.match(/data-text-note-color=/g) ?? []).length, 6);
});

test('editing starts from the selected note and leaves its physical properties untouched', () => {
  const annotation: DrawingAnnotation = {
    id: 'note',
    kind: 'text',
    points: [[12, 34]],
    text: 'Keep this note',
    color: '#8b5bd6',
    fontSize: 3.37,
    strokeWidth: 0.8,
  };
  const before = structuredClone(annotation);
  const markup = renderTextAnnotationEditor({ annotation, options: defaultAnnotationOptions });
  assert.match(markup, /id="text-note-font-size"[^>]*step="any"[^>]*value="3\.37"/);
  assert.match(markup, /id="text-note-color"[^>]*value="#8b5bd6"/);
  assert.match(markup, /data-user-content[^>]*>Keep this note</);
  assert.match(markup, /type="submit"[^>]*>Save changes</);
  assert.deepEqual(annotation, before);
  assert.throws(() => readAnnotationEdit({} as ParentNode, annotation), /text annotation editor/);
  assert.throws(
    () =>
      renderTextAnnotationEditor({ options: { ...defaultAnnotationOptions, color: 'url(test)' } }),
    /hexadecimal/,
  );
});

test('scrollable fields stay between the fixed title and native form actions', () => {
  const markup = renderTextAnnotationEditor({ options: defaultAnnotationOptions });
  const body = markup.match(
    /<div class="text-note-body">([\s\S]*)<\/div><footer class="text-note-actions">/,
  )?.[1];
  assert.ok(body);
  for (const id of [
    'text-note-content',
    'text-note-color',
    'text-note-font-size',
    'text-note-preview',
    'text-note-error',
  ])
    assert.match(body, new RegExp(`id="${id}"`));
  assert.doesNotMatch(body, /text-note-title|type="submit"|data-text-note-action="cancel"/);
  assert.ok(markup.indexOf('text-note-heading') < markup.indexOf('text-note-body'));
  assert.match(markup, /<footer class="text-note-actions">[\s\S]*type="submit"/);
});

test('sidebar creation and selection both lead to the composer rather than duplicate text fields', () => {
  const cue = renderAnnotationEditor(undefined, defaultAnnotationOptions, 'text');
  const guide = renderMarkupGuide({ tool: 'text', enabled: true });
  assert.equal(cue, '');
  assert.match(guide, /Click the drawing, then type your note in the editor that opens/);
  assert.doesNotMatch(guide, /Place text|<textarea|data-annotation-setting=/);
  const selected = renderAnnotationEditor({
    id: 'locked',
    kind: 'text',
    points: [[1, 2]],
    text: '<Keep>',
    fontSize: 3.5,
    strokeWidth: 0.35,
    locked: true,
  });
  assert.match(selected, /data-annotation-action="edit-text"/);
  assert.match(selected, /<fieldset[^>]* disabled>/);
  assert.ok(selected.indexOf('data-annotation-action="lock"') < selected.indexOf('<fieldset'));
  assert.match(selected, /data-user-content>&lt;Keep&gt;</);
  assert.doesNotMatch(selected, /<textarea|data-annotation-setting=/);
  const selectedGuide = renderMarkupGuide({
    tool: 'select',
    enabled: true,
    selected: true,
    selectedKind: 'text',
  });
  assert.match(selectedGuide, /Choose Edit text to change the selected note/);
  assert.doesNotMatch(selectedGuide, /Apply changes/);
});
