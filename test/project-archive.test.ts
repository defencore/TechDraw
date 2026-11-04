import assert from 'node:assert/strict';
import test from 'node:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createProjectArchive, openProjectArchive } from '../src/io/project-archive';
import { SourceRepository } from '../src/io/source-repository';
import { importDxf } from '../src/io/dxf-import';
import type { DrawingAnnotation } from '../src/model';
import { defaultSettings } from '../src/state';

function workspace() {
  const bytes = strToU8(
    '0\nSECTION\n2\nENTITIES\n0\nLINE\n10\n0\n20\n0\n11\n20\n21\n10\n0\nENDSEC\n0\nEOF\n',
  );
  const sources = new SourceRepository();
  const source = sources.add({ name: 'original drawing.dxf', kind: 'dxf', bytes });
  const part = importDxf(bytes, source.name).parts[0];
  part.sourceId = source.id;
  const annotations: DrawingAnnotation[] = [
    {
      id: 'note',
      kind: 'text',
      points: [[30, 40]],
      text: 'Перевірити посадку',
      strokeWidth: 0.3,
      fontSize: 4,
    },
    {
      id: 'arrow',
      kind: 'arrow',
      points: [
        [30, 40],
        [60, 70],
      ],
      strokeWidth: 0.3,
    },
  ];
  const state = {
    parts: [part],
    activeId: part.id,
    selected: new Set([part.id]),
    settings: { ...defaultSettings, title: 'Manufacturing drawing' },
    layouts: {},
    annotations: { [part.id]: annotations },
    dimensions: {
      [part.id]: [
        {
          id: 'size',
          viewId: 'front' as const,
          kind: 'horizontal' as const,
          a: [0, 0] as [number, number],
          b: [20, 0] as [number, number],
          value: 20,
          offset: 15,
          automatic: false,
          tolerance: { kind: 'symmetric' as const, magnitude: '0.050' },
        },
      ],
    },
    description: 'Inspect the fit before assembly.',
  };
  return { state, source, sources, bytes };
}

test('ZIP reopens original bytes, exact tolerances, annotations, description and source associations', async () => {
  const { state, sources, bytes } = workspace();
  const before = structuredClone(state);
  const archive = await createProjectArchive(state, sources.all());
  const files = unzipSync(archive);
  const manifest = JSON.parse(strFromU8(files['manifest.json']));
  assert.ok(files['project.json']);
  assert.match(strFromU8(files['README.txt']), /Inspect the fit/);
  assert.deepEqual(files[manifest.sources[0].path], bytes);
  const opened = await openProjectArchive(archive);
  assert.deepEqual(opened.sources[0].bytes, bytes);
  assert.equal(opened.project.parts[0].sourceId, sources.all()[0].id);
  assert.deepEqual(
    opened.project.annotations,
    Object.assign(Object.create(null), state.annotations),
  );
  assert.equal(opened.project.dimensions[state.parts[0].id][0].tolerance?.kind, 'symmetric');
  assert.equal(opened.description, state.description);
  assert.deepEqual(opened.missingSources, []);
  assert.deepEqual(state, before);
});

test('original source bytes are isolated from caller mutations and transferred CAD input buffers', () => {
  const repository = new SourceRepository();
  const bytes = new Uint8Array([0, 1, 255, 3]);
  const added = repository.add({ id: 'source-id', name: 'part.step', kind: 'step', bytes });
  structuredClone(bytes.buffer, { transfer: [bytes.buffer] });
  added.bytes[0] = 7;
  assert.deepEqual(repository.get('source-id')?.bytes, new Uint8Array([0, 1, 255, 3]));
  const copy = repository.all();
  copy[0].bytes[1] = 9;
  assert.equal(repository.get('source-id')?.bytes[1], 1);
  assert.throws(
    () =>
      repository.add({
        id: 'source-id',
        name: 'other.step',
        kind: 'step',
        bytes: new Uint8Array([1]),
      }),
    /already exists/,
  );
});

test('missing originals are explicitly recorded and never fabricated from projected geometry', async () => {
  const { state } = workspace();
  const opened = await openProjectArchive(await createProjectArchive(state, []));
  assert.equal(opened.sources.length, 0);
  assert.equal(opened.missingSources.length, 1);
  assert.equal(opened.missingSources[0].partId, state.parts[0].id);
});

test('tampered source and project contents fail SHA-256 verification', async () => {
  const { state, sources } = workspace();
  const archive = await createProjectArchive(state, sources.all());
  for (const target of ['source', 'project']) {
    const files = unzipSync(archive);
    const manifest = JSON.parse(strFromU8(files['manifest.json']));
    const path = target === 'source' ? manifest.sources[0].path : 'project.json';
    files[path][0] ^= 1;
    await assert.rejects(openProjectArchive(zipSync(files)), /SHA-256/);
  }
});

test('unsafe, oversized and unexpected archive entries reject before workspace replacement', async () => {
  const { state, sources } = workspace();
  const archive = await createProjectArchive(state, sources.all());
  const unsafe = { ...unzipSync(archive), '../outside.txt': strToU8('bad') };
  await assert.rejects(openProjectArchive(zipSync(unsafe)), /unsafe ZIP entry/);
  const extra = { ...unzipSync(archive), 'script.js': strToU8('bad') };
  await assert.rejects(openProjectArchive(zipSync(extra)), /unrecognized files/);
  const oversized = zipSync({ 'project.json': strToU8('x'), 'manifest.json': strToU8('{}') });
  const view = new DataView(oversized.buffer);
  for (let offset = 0; offset < oversized.length - 46; offset++)
    if (view.getUint32(offset, true) === 0x02014b50) {
      view.setUint32(offset + 24, 0xffffffff, true);
      break;
    }
  await assert.rejects(openProjectArchive(oversized), /size limits/);
});
