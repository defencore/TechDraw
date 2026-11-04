import assert from 'node:assert/strict';
import test from 'node:test';
import { createCadClient, type CadClient } from '../src/cad/client';
import type { ImportResult } from '../src/model';

class FakeWorker {
  static instances: FakeWorker[] = [];
  static failConstruction = false;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  terminated = false;
  failPost = false;
  messages: { id: number; buffer: ArrayBuffer; name: string }[] = [];
  constructor() {
    if (FakeWorker.failConstruction) throw new Error('Worker unavailable');
    FakeWorker.instances.push(this);
  }
  postMessage(data: { id: number; buffer: ArrayBuffer; name: string }, transfer: Transferable[]) {
    if (this.failPost) throw new DOMException('Transfer failed', 'DataCloneError');
    this.messages.push(structuredClone(data, { transfer }));
  }
  terminate() {
    this.terminated = true;
  }
  result(result: ImportResult) {
    this.onmessage?.({
      data: { id: this.messages.at(-1)!.id, type: 'result', result },
    } as MessageEvent);
  }
}

function fixture() {
  const original = globalThis.Worker;
  FakeWorker.instances = [];
  FakeWorker.failConstruction = false;
  globalThis.Worker = FakeWorker as unknown as typeof Worker;
  const progress: string[] = [];
  const client = createCadClient((message) => progress.push(message));
  const close = () => {
    client.dispose();
    globalThis.Worker = original;
  };
  return { client, progress, close };
}
const input = () => new Uint8Array([1, 2, 3]).buffer;
const result: ImportResult = { sourceName: 'test.step', parts: [], warnings: [] };
const latest = () => FakeWorker.instances.at(-1)!;

test('CAD requests transfer bytes, reject concurrent work and recover after cancellation', async () => {
  const { client, progress, close } = fixture();
  try {
    const bytes = input(),
      first = client.importStep(bytes, 'test.step');
    assert.equal(bytes.byteLength, 0);
    await assert.rejects(client.importStep(input(), 'other.step'), /current import/);
    const worker = latest(),
      id = worker.messages[0].id;
    worker.onmessage?.({ data: { id, type: 'progress', message: 'Projecting' } } as MessageEvent);
    assert.deepEqual(progress, ['Projecting']);
    client.reset();
    await assert.rejects(first, /cancelled/);
    assert.equal(worker.terminated, true);
    const next = client.importStep(input(), 'test.step');
    latest().result(result);
    assert.deepEqual(await next, result);
  } finally {
    close();
  }
});

test('a failed buffer transfer clears the pending request and timer instead of stranding the client as busy', async () => {
  const { client, close } = fixture();
  try {
    const warmup = client.importStep(input(), 'test.step');
    latest().result(result);
    await warmup;
    const failed = latest();
    failed.failPost = true;
    await assert.rejects(client.importStep(input(), 'test.step'), /could not receive/);
    assert.equal(failed.terminated, true);
    const retry = client.importStep(input(), 'test.step');
    latest().result(result);
    assert.deepEqual(await retry, result);
  } finally {
    close();
  }
});

test('worker creation failures reject asynchronously and permit a later retry', async () => {
  const { client, close } = fixture();
  try {
    FakeWorker.failConstruction = true;
    let pending: ReturnType<CadClient['importStep']> | undefined;
    assert.doesNotThrow(() => {
      pending = client.importStep(input(), 'test.step');
    });
    await assert.rejects(pending!, /could not start/);
    FakeWorker.failConstruction = false;
    const retry = client.importStep(input(), 'test.step');
    latest().result(result);
    await retry;
  } finally {
    close();
  }
});

test('stale worker failures cannot cancel a replacement import and unreadable messages can be retried', async () => {
  const { client, close } = fixture();
  try {
    const first = client.importStep(input(), 'first.step');
    const staleError = latest().onerror!;
    client.reset();
    await assert.rejects(first, /cancelled/);
    const second = client.importStep(input(), 'second.step');
    const active = latest();
    staleError({} as ErrorEvent);
    assert.equal(active.terminated, false);
    active.onmessageerror?.({} as MessageEvent);
    await assert.rejects(second, /unreadable data/);
    const third = client.importStep(input(), 'third.step');
    latest().result(result);
    await third;
  } finally {
    close();
  }
});

test('empty, detached and oversized inputs fail before a worker is started', async () => {
  const { client, close } = fixture();
  try {
    const detached = input();
    structuredClone(detached, { transfer: [detached] });
    for (const bytes of [new ArrayBuffer(0), detached, new ArrayBuffer(64 * 1024 * 1024 + 1)])
      await assert.rejects(client.importStep(bytes, 'bad.step'), /nonempty STEP file/);
    assert.equal(FakeWorker.instances.length, 0);
  } finally {
    close();
  }
});
