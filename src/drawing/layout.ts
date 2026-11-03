import type { Dimension, DrawingLayout, DrawingSettings, Part } from '../model';
import { arrangeDimensions } from './dimensions';
import { renderDrawing, type RenderedDrawing } from './render';

export interface InitializedDrawing {
  dimensions: Dimension[];
  layout: DrawingLayout;
}

function initialized(dimensions: Dimension[], sheet: RenderedDrawing): InitializedDrawing {
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
  if (!options.arrange) return initialized(source, renderDrawing(part, source, settings));
  const arrange = (scale: number) =>
    arrangeDimensions(source, { scale, precision: settings.precision, part });

  if (settings.scale !== 'auto') {
    const arranged = arrange(settings.scale);
    return initialized(arranged, renderDrawing(part, arranged, settings));
  }

  let scale = renderDrawing(part, source, settings).scale;
  let smallestScale = scale;
  // Packing uses paper units, so auto scale and annotation placement converge together.
  for (let pass = 0; pass < 3; pass++) {
    const arranged = arrange(scale);
    const sheet = renderDrawing(part, arranged, settings);
    if (sheet.scale === scale) return initialized(arranged, sheet);
    scale = sheet.scale;
    smallestScale = Math.min(smallestScale, scale);
  }

  // A bounded conservative fallback keeps packing and the saved scale consistent.
  const arranged = arrange(smallestScale);
  return initialized(
    arranged,
    renderDrawing(part, arranged, { ...settings, scale: smallestScale }),
  );
}
