import type { Bounds2 } from '../model';

export interface ImageRegion extends Bounds2 {}
export interface ImageSize {
  width: number;
  height: number;
}

/** Intersect a paper-space crop with the actual sheet, retaining numeric precision. */
export function imageRegion(
  region: Bounds2 | undefined,
  sheet: ImageSize,
  requireRegion = false,
): ImageRegion {
  if (requireRegion && !region)
    throw new Error('This area is empty. Choose Whole sheet or move the drawing into view.');
  const bounds = region ?? { minX: 0, minY: 0, maxX: sheet.width, maxY: sheet.height };
  if (
    ![sheet.width, sheet.height, ...Object.values(bounds)].every(Number.isFinite) ||
    sheet.width <= 0 ||
    sheet.height <= 0
  )
    throw new Error('The image area is invalid.');
  const result = {
    minX: Math.max(0, bounds.minX),
    minY: Math.max(0, bounds.minY),
    maxX: Math.min(sheet.width, bounds.maxX),
    maxY: Math.min(sheet.height, bounds.maxY),
  };
  if (result.maxX - result.minX < 0.01 || result.maxY - result.minY < 0.01)
    throw new Error('The selected area does not intersect the drawing sheet.');
  return result;
}

/** Bound memory on phones while keeping even a small crop legible. */
export function imagePixelSize(region: Bounds2, longestSide = 2400): ImageSize {
  const width = region.maxX - region.minX,
    height = region.maxY - region.minY;
  if (
    ![width, height, longestSide].every(Number.isFinite) ||
    width <= 0 ||
    height <= 0 ||
    longestSide < 64 ||
    longestSide > 4096
  )
    throw new Error('The image resolution is invalid.');
  const scale = Math.min(
    longestSide / Math.max(width, height),
    Math.sqrt(8_000_000 / (width * height)),
  );
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export async function drawingPng(svg: string, region: Bounds2, longestSide = 2400): Promise<Blob> {
  const size = imagePixelSize(region, longestSide);
  const document = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = document.documentElement;
  if (root.localName !== 'svg' || document.querySelector('parsererror'))
    throw new Error('The drawing could not be prepared for an image.');
  root.setAttribute(
    'viewBox',
    `${region.minX} ${region.minY} ${region.maxX - region.minX} ${region.maxY - region.minY}`,
  );
  root.setAttribute('width', String(size.width));
  root.setAttribute('height', String(size.height));
  root.setAttribute('style', 'font-family:Arial,Helvetica,sans-serif');
  const url = URL.createObjectURL(
    new Blob([new XMLSerializer().serializeToString(root)], {
      type: 'image/svg+xml;charset=utf-8',
    }),
  );
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('The drawing image could not be rendered.'));
      image.src = url;
    });
    const canvas = window.document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image rendering is unavailable in this browser.');
    context.drawImage(image, 0, 0);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('The PNG image could not be created.'))),
        'image/png',
      ),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Call this synchronously from the user's click; Safari consumes activation before awaits. */
export function copyDrawingImage(
  blob: Promise<Blob>,
  clipboard = navigator.clipboard,
): Promise<void> {
  if (!clipboard?.write || typeof ClipboardItem === 'undefined')
    return Promise.reject(
      new Error('Image copying is unavailable. Save the PNG or use Share instead.'),
    );
  return clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}
