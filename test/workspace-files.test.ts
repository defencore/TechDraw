import assert from 'node:assert/strict';
import test from 'node:test';
import type { CadClient } from '../src/cad/client';
import type { ImportResult } from '../src/model';
import { WorkspaceFiles, drawingFileName } from '../src/application/workspace-files';
import { serializeProject } from '../src/project';
import { publicPart, publicWorkspace } from './fixtures/workspace';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
function fixture(cad?: Partial<CadClient>) {
  const document = publicWorkspace();
  let resets = 0,
    downloads = 0,
    checkpoints = 0;
  const messages: string[] = [];
  const files = new WorkspaceFiles({
    document,
    cad: {
      importStep: async () => ({ parts: [publicPart()], warnings: [], sourceName: 'public.step' }),
      demo: async () => ({
        parts: [publicPart()],
        warnings: [],
        sourceName: 'public.step',
        sourceBytes: new Uint8Array([1]),
      }),
      reset() {
        resets++;
      },
      dispose() {},
      ...cad,
    },
    blocked: () => false,
    dxfUnit: () => undefined,
    appearance: () => 'paper',
    changed() {},
    progressChanged() {},
    imported() {},
    opened() {},
    saved() {
      checkpoints++;
    },
    report: (message) => messages.push(message),
    translate: (message) => message,
    download() {
      downloads++;
    },
    exampleUrl: '/public-example.dxf',
    nextFrame: async () => {},
  });
  return {
    document,
    files,
    messages,
    resets: () => resets,
    downloads: () => downloads,
    checkpoints: () => checkpoints,
  };
}

test('cancelled file reads cannot start CAD or clear the busy state of a subsequent import', async () => {
  const oldRead = deferred<ArrayBuffer>(),
    newResult = deferred<ImportResult>();
  let kernelCalls = 0;
  const app = fixture({
    importStep: () => {
      kernelCalls++;
      return newResult.promise;
    },
  });
  const first = app.files.importFiles([
    { name: 'old.step', size: 1, arrayBuffer: () => oldRead.promise } as File,
  ]);
  assert.equal(app.files.busy, true);
  app.files.cancel();
  const second = app.files.importFiles([new File([new Uint8Array([2])], 'new.step')]);
  oldRead.resolve(new ArrayBuffer(1));
  await first;
  assert.equal(app.files.busy, true);
  assert.equal(kernelCalls, 1);
  newResult.resolve({ parts: [publicPart('new')], warnings: [], sourceName: 'new.step' });
  await second;
  assert.equal(app.files.busy, false);
  assert.equal(app.document.state.parts.length, 2);
  assert.equal(app.resets(), 1);
});

test('project saving is exclusive, cannot be cancelled mid-archive and records success only after download', async () => {
  const app = fixture();
  const saving = app.files.save();
  assert.equal(app.files.busy, true);
  assert.equal(app.files.kind, 'save');
  app.files.cancel();
  assert.equal(app.files.busy, true);
  await app.files.importFiles([new File(['x'], 'ignored.step')]);
  await saving;
  assert.equal(app.document.state.parts.length, 1);
  assert.equal(app.files.busy, false);
  assert.equal(app.downloads(), 1);
  assert.equal(app.checkpoints(), 1);
});

test('a cancelled project read never replaces the current document', async () => {
  const app = fixture();
  const reading = deferred<string>();
  const serialized = serializeProject(publicWorkspace([publicPart('replacement')]).state);
  const opening = app.files.open({
    name: 'project.json',
    size: serialized.length,
    text: () => reading.promise,
  } as File);
  app.files.cancel();
  reading.resolve(serialized);
  await opening;
  assert.equal(app.document.active?.id, 'part');
  assert.equal(app.checkpoints(), 0);
  assert.equal(app.messages.includes('Editable project opened.'), false);
});

test('removing parts releases originals only after their final shared reference is removed', () => {
  const app = fixture();
  const source = app.files.sources.add({
    name: 'public.step',
    kind: 'step',
    bytes: new Uint8Array([1, 2]),
  });
  app.document.active!.sourceId = source.id;
  app.document.addPart({ ...publicPart('second'), sourceId: source.id });
  app.files.removePart('part');
  assert.ok(app.files.sources.get(source.id));
  app.files.removePart('second');
  assert.equal(app.files.sources.get(source.id), undefined);
});

test('drawing downloads retain Ukrainian names and remove path/control characters', () => {
  assert.equal(drawingFileName('Шпангоут №1', 'pdf'), 'Шпангоут №1.pdf');
  assert.equal(drawingFileName('../case\\cover\u0000', 'svg'), '-case-cover-.svg');
  assert.equal(drawingFileName('...', 'pdf'), 'drawing.pdf');
});
