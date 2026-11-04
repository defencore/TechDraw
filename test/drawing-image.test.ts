import test from 'node:test';
import assert from 'node:assert/strict';
import { imageRegion, imagePixelSize, copyDrawingImage } from '../src/ui/drawing-image';
test('image crops use paper coordinates and clip at sheet edges', () => {
  assert.deepEqual(
    imageRegion({ minX: -10, minY: 20, maxX: 80.25, maxY: 400 }, { width: 210, height: 297 }),
    { minX: 0, minY: 20, maxX: 80.25, maxY: 297 },
  );
  assert.throws(
    () => imageRegion({ minX: 300, minY: 1, maxX: 400, maxY: 5 }, { width: 210, height: 297 }),
    /does not intersect/,
  );
  assert.throws(() => imageRegion(undefined, { width: 210, height: 297 }, true), /area is empty/);
  assert.equal(imageRegion(undefined, { width: 210, height: 297 }).maxX, 210);
});
test('phone raster sizes preserve ratio within bounded memory', () => {
  assert.deepEqual(imagePixelSize({ minX: 20, minY: 30, maxX: 220, maxY: 130 }), {
    width: 2400,
    height: 1200,
  });
  const large = imagePixelSize({ minX: 0, minY: 0, maxX: 841, maxY: 1189 }, 4096);
  assert.ok(large.width * large.height < 8_005_000);
  assert.throws(() => imagePixelSize({ minX: 0, minY: 0, maxX: Infinity, maxY: 10 }));
});
test('clipboard starts writing before PNG production resolves', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'ClipboardItem');
  let supplied: Promise<Blob> | undefined;
  Object.defineProperty(globalThis, 'ClipboardItem', {
    configurable: true,
    value: class {
      constructor(data: Record<string, Promise<Blob>>) {
        supplied = data['image/png'];
      }
    },
  });
  try {
    let release!: (value: Blob) => void;
    const image = new Promise<Blob>((resolve) => {
      release = resolve;
    });
    let called = false;
    const writing = copyDrawingImage(image, {
      write: async () => {
        called = true;
        await image;
      },
    } as unknown as Clipboard);
    assert.equal(called, true);
    assert.equal(supplied, image);
    release(new Blob(['png'], { type: 'image/png' }));
    await writing;
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'ClipboardItem', descriptor);
    else Reflect.deleteProperty(globalThis, 'ClipboardItem');
  }
});
