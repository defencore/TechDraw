import type { Dimension, DrawingLayout, DrawingSettings, Part } from '../model';
import { arrangeDimensions } from './dimensions';
import {
  calculateDrawingLayout,
  STANDARD_DRAWING_SCALES,
  type CalculatedDrawingLayout,
} from './page-layout';

export interface InitializedDrawing {
  dimensions: Dimension[];
  layout: DrawingLayout;
}

function initialized(dimensions: Dimension[], sheet: CalculatedDrawingLayout): InitializedDrawing {
  return { dimensions, layout: { scale: sheet.scale, viewTransforms: sheet.viewTransforms } };
}

/** Initialize annotations and their physical sheet layout as one persistent operation. */
export function initializeDrawing(
  part: Part,
  dimensions: Dimension[],
  settings: DrawingSettings,
  options: { arrange: boolean },
): InitializedDrawing {
  const source = structuredClone(dimensions);
  if (!options.arrange) return initialized(source, calculateDrawingLayout(part, source, settings));
  const arrange = (scale: number) =>
    arrangeDimensions(source, { scale, precision: settings.precision, part });

  if (settings.scale !== 'auto') {
    const arranged = arrange(settings.scale);
    return initialized(arranged, calculateDrawingLayout(part, arranged, settings));
  }

  // Evaluate each standard scale with its own paper-space annotation packing.
  // SVG serialization happens only after a physical layout has been selected.
  for (const scale of STANDARD_DRAWING_SCALES) {
    const arranged = arrange(scale);
    const sheet = calculateDrawingLayout(part, arranged, { ...settings, scale });
    if (sheet.fits) return initialized(arranged, sheet);
  }

  // Preserve a valid standard scale and let the renderer report that a larger sheet is needed.
  const smallestScale = STANDARD_DRAWING_SCALES.at(-1)!;
  const arranged = arrange(smallestScale);
  return initialized(
    arranged,
    calculateDrawingLayout(part, arranged, { ...settings, scale: smallestScale }),
  );
}
