import initOpenCascade from 'replicad-opencascadejs';
import wasmUrl from 'replicad-opencascadejs/wasm?url';
import { setOC } from 'replicad';
import { importStep } from './engine';

const initialized = initOpenCascade({ locateFile: () => wasmUrl }).then(setOC);

self.onmessage = async (event: MessageEvent) => {
  const { id, buffer, name } = event.data;
  const progress = (message: string) => self.postMessage({ id, type: 'progress', message });
  try {
    progress('Loading local CAD engine');
    await initialized;
    const result = await importStep(buffer, name, progress);
    self.postMessage({ id, type: 'result', result });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'The CAD kernel could not process this model. Check the STEP geometry or try a smaller file.';
    self.postMessage({ id, type: 'error', message });
  }
};
