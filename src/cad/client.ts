import type { ImportResult } from '../model';
import { MAX_SOURCE_BYTES } from '../io/source-repository';

export interface CadClient {
  importStep(buffer: ArrayBuffer, name: string): Promise<ImportResult>;
  demo(): Promise<ImportResult & { sourceBytes: Uint8Array }>;
  reset(): void;
  dispose(): void;
}

/** Terminating the worker is the only reliable interruption of synchronous WASM. */
export function createCadClient(onProgress: (message: string) => void = () => {}): CadClient {
  let worker: Worker | undefined;
  let sequence = 0;
  let generation = 0;
  let exampleFetch: { controller: AbortController; message: string } | undefined;
  const requests = new Map<
    number,
    {
      resolve(value: ImportResult): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  const stop = (message: string) => {
    generation++;
    if (exampleFetch) {
      exampleFetch.message = message;
      exampleFetch.controller.abort();
      exampleFetch = undefined;
    }
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
    }
    worker = undefined;
    requests.forEach((request) => {
      clearTimeout(request.timer);
      request.reject(new Error(message));
    });
    requests.clear();
  };
  const getWorker = () => {
    if (!worker) {
      const created = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      worker = created;
      created.onmessage = (event) => {
        if (worker !== created) return;
        const { id, type, message, result } = event.data;
        const request = requests.get(id);
        if (!request) return;
        if (type === 'progress') {
          onProgress(message);
          return;
        }
        clearTimeout(request.timer);
        requests.delete(id);
        if (type === 'result') request.resolve(result);
        else request.reject(new Error(message));
      };
      created.onerror = () => {
        if (worker === created)
          stop('The CAD engine stopped unexpectedly. Try a smaller STEP file or reload the page.');
      };
      created.onmessageerror = () => {
        if (worker === created)
          stop('The CAD engine returned unreadable data. Try importing the STEP file again.');
      };
    }
    return worker;
  };
  const request = (buffer: ArrayBuffer, name: string): Promise<ImportResult> => {
    if (requests.size || exampleFetch)
      return Promise.reject(
        new Error('Wait for the current import or cancel it before starting another.'),
      );
    if (
      !(buffer instanceof ArrayBuffer) ||
      !buffer.byteLength ||
      buffer.byteLength > MAX_SOURCE_BYTES
    )
      return Promise.reject(new Error('Choose a nonempty STEP file no larger than 64 MB.'));
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      let active: Worker;
      try {
        active = getWorker();
      } catch {
        reject(new Error('The CAD engine could not start. Reload the page and try again.'));
        return;
      }
      const timer = setTimeout(
        () =>
          stop(
            'The import exceeded five minutes. Export a smaller assembly selection and try again.',
          ),
        300000,
      );
      requests.set(id, { resolve, reject, timer });
      try {
        active.postMessage({ id, buffer, name }, [buffer]);
      } catch {
        stop('The CAD engine could not receive this file. Try importing it again.');
      }
    });
  };
  const demo = async (): Promise<ImportResult & { sourceBytes: Uint8Array }> => {
    if (requests.size || exampleFetch)
      throw new Error('Wait for the current import or cancel it before starting another.');
    const operation = { controller: new AbortController(), message: 'Import cancelled.' };
    const started = generation;
    exampleFetch = operation;
    onProgress('Loading example STEP file');
    let buffer: ArrayBuffer;
    try {
      // Resolve against the document, because a bundled worker lives under assets/.
      const url = new URL(
        `${import.meta.env.BASE_URL}examples/mounting-kit.step`,
        document.baseURI,
      );
      const response = await fetch(url, { signal: operation.controller.signal });
      if (!response.ok)
        throw new Error(
          'The example STEP file could not be loaded. Try importing a local STEP file.',
        );
      buffer = await response.arrayBuffer();
      if (
        operation.controller.signal.aborted ||
        started !== generation ||
        exampleFetch !== operation
      )
        throw new Error(operation.message);
    } catch (error) {
      if (operation.controller.signal.aborted || started !== generation)
        throw new Error(operation.message);
      throw error;
    } finally {
      if (exampleFetch === operation) exampleFetch = undefined;
    }
    // Examples and user files share one worker import protocol and geometry path.
    const sourceBytes = new Uint8Array(buffer).slice();
    return { ...(await request(buffer, 'mounting-kit.step')), sourceBytes };
  };
  return {
    importStep: request,
    demo,
    reset: () => stop('Import cancelled.'),
    dispose: () => stop('CAD engine closed.'),
  };
}
