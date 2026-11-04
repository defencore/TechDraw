import type {
  Bounds2,
  Dimension,
  DrawingLayout,
  DrawingSettings,
  Part,
  Point2,
  Projection,
  ViewId,
} from '../model';
import { dimensionGeometry, type ViewTransform } from './dimension-geometry';
import { measureDimensionText } from './dimension-label';
import { isGostTemplate } from './gost-form1';
import { sheetNotes, type SheetNotes } from './sheet-notes';
import { parameterTableLayout, type ParameterTableLayout } from './parameter-table';
import { gearDatumPaperGeometry, gearReferenceCircles } from './gear-dimensions';
import { effectivePartType } from '../manufacturing/catalog';

/** GOST 2.302-68 clause 2, ordered from the largest to the smallest part-drawing scale. */
export const STANDARD_DRAWING_SCALES = [
  100,
  50,
  40,
  20,
  10,
  5,
  4,
  2.5,
  2,
  1,
  1 / 2,
  1 / 2.5,
  1 / 4,
  1 / 5,
  1 / 10,
  1 / 15,
  1 / 20,
  1 / 25,
  1 / 40,
  1 / 50,
  1 / 75,
  1 / 100,
  1 / 200,
  1 / 400,
  1 / 500,
  1 / 800,
  1 / 1000,
] as const;

/** Automatic gear fitting retains a readable tooth envelope; explicit scales remain unrestricted. */
export function automaticDrawingScales(part: Part): readonly number[] {
  const diameter =
    effectivePartType(part) === 'gear' ? part.features?.gear?.outsideDiameter : undefined;
  if (!diameter) return STANDARD_DRAWING_SCALES;
  const readable = STANDARD_DRAWING_SCALES.filter((scale) => diameter * scale >= 10 - 1e-9);
  return readable.length ? readable : [STANDARD_DRAWING_SCALES[0]];
}
export interface DrawingPage {
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  blockHeight: number;
  content: Bounds2;
  fittingArea: Bounds2;
  notes: SheetNotes;
  parameterTable?: ParameterTableLayout;
}
export interface ProjectionMetrics {
  model: Bounds2;
  occupied: Bounds2;
  caption: { text: string; origin: Point2 };
}
export interface CalculatedDrawingLayout extends DrawingLayout {
  arrangement: 'four-view-grid' | 'isometric-outboard' | 'single-view';
  fits: boolean;
  page: DrawingPage;
  metrics: Record<ViewId, ProjectionMetrics>;
  requiredWidth: number;
  requiredHeight: number;
}

export function paperSize(
  settings: Pick<DrawingSettings, 'format' | 'orientation'>,
): [number, number] {
  const formats = { A4: [210, 297], A3: [297, 420], A2: [420, 594], A1: [594, 841] } as const;
  const [short, long] = formats[settings.format];
  return settings.orientation === 'landscape' ? [long, short] : [short, long];
}
export function drawingPage(settings: DrawingSettings, part?: Part): DrawingPage {
  const [width, height] = paperSize(settings),
    gost = isGostTemplate(settings.template);
  const left = gost ? 20 : 10,
    right = 5,
    top = 5,
    bottom = 5,
    blockHeight = settings.template === 'minimal' ? 35 : 55;
  const designationReserve =
    gost && settings.format !== 'A4' && settings.orientation === 'portrait' ? 14 : 0;
  const notes = sheetNotes(settings, { width, height, left, right, top, bottom, blockHeight });
  const content: Bounds2 = {
    minX: left + 1,
    minY: top + (gost ? 15 : 1),
    maxX: width - right - 1 - designationReserve,
    maxY: notes.contentBottom,
  };
  const parameterTable = part
    ? parameterTableLayout(part, settings, {
        ...content,
        minY: top + (gost ? 20 : 10),
      })
    : undefined;
  if (parameterTable) {
    // A narrow portrait sheet cannot hold fixed-size annotation text in a slim side column.
    // Keep its table in the upper right and use the full-width area below it instead.
    if (parameterTable.bounds.minX - 8 - content.minX < 100)
      content.minY = parameterTable.bounds.maxY + 8;
    else content.maxX = parameterTable.bounds.minX - 8;
  }
  return {
    width,
    height,
    left,
    right,
    top,
    bottom,
    blockHeight,
    notes,
    parameterTable,
    content,
    fittingArea: {
      minX: left + 5,
      minY: Math.max(top + (gost ? 20 : 10), content.minY + 4),
      maxX: content.maxX - 4,
      maxY: content.maxY - 4,
    },
  };
}
function union(target: Bounds2, bounds: Bounds2): void {
  target.minX = Math.min(target.minX, bounds.minX);
  target.minY = Math.min(target.minY, bounds.minY);
  target.maxX = Math.max(target.maxX, bounds.maxX);
  target.maxY = Math.max(target.maxY, bounds.maxY);
}
const widthOf = (bounds: Bounds2) => bounds.maxX - bounds.minX;
const heightOf = (bounds: Bounds2) => bounds.maxY - bounds.minY;

/** Gear captions clear their surrounding callouts; other captions follow the model contour. */
export function projectionMetrics(
  view: Projection,
  dimensions: Dimension[],
  scale: number,
  settings: DrawingSettings,
  part?: Part,
): ProjectionMetrics {
  const model: Bounds2 = {
    minX: view.bounds.minX * scale,
    maxX: view.bounds.maxX * scale,
    minY: -view.bounds.maxY * scale,
    maxY: -view.bounds.minY * scale,
  };
  const occupied = { ...model };
  if (part)
    for (const circle of gearReferenceCircles(part, view.id)) {
      const [x, y] = [circle.center[0] * scale, -circle.center[1] * scale];
      const radius = circle.radius * scale + 0.1;
      union(occupied, { minX: x - radius, maxX: x + radius, minY: y - radius, maxY: y + radius });
    }
  const datum = part ? gearDatumPaperGeometry(part, view.id, { x: 0, y: 0, scale }) : undefined;
  if (datum) union(occupied, datum.bounds);
  if (settings.centerLines)
    for (const edge of view.edges) {
      if (
        edge.kind !== 'circle' ||
        edge.closed === false ||
        !edge.center ||
        !edge.radius ||
        (edge.hidden && !settings.hiddenLines)
      )
        continue;
      const cx = edge.center[0] * scale,
        cy = -edge.center[1] * scale,
        radius = edge.radius * scale + 3.1;
      union(occupied, {
        minX: cx - radius,
        maxX: cx + radius,
        minY: cy - radius,
        maxY: cy + radius,
      });
    }
  for (const dimension of dimensions)
    if (dimension.viewId === view.id)
      union(
        occupied,
        dimensionGeometry(dimension, { x: 0, y: 0, scale }, settings.precision).bounds,
      );
  const captionText =
    settings.template === 'eskd-uk'
      ? ({ front: 'СПЕРЕДУ', top: 'ЗВЕРХУ', right: 'СПРАВА', iso: 'ІЗОМЕТРІЯ' } as const)[view.id]
      : view.name.toUpperCase();
  const captionOrigin: Point2 = [
    (model.minX + model.maxX) / 2,
    (part?.features?.gear && effectivePartType(part) === 'gear' ? occupied.minY : model.minY) - 5,
  ];
  const captionWidth =
    measureDimensionText(captionText, 2.5) +
    Math.max(0, Array.from(captionText).length - 1) * 0.7 +
    1;
  union(occupied, {
    minX: captionOrigin[0] - captionWidth / 2,
    maxX: captionOrigin[0] + captionWidth / 2,
    minY: captionOrigin[1] - 2.8,
    maxY: captionOrigin[1] + 1,
  });
  return { model, occupied, caption: { text: captionText, origin: captionOrigin } };
}

function calculateAtScale(
  part: Part,
  dimensions: Dimension[],
  settings: DrawingSettings,
  scale: number,
): CalculatedDrawingLayout {
  if (!Number.isFinite(scale) || scale <= 0)
    throw new RangeError('Drawing scale must be a positive finite number.');
  const page = drawingPage(settings, part);
  const metrics = Object.fromEntries(
    part.views.map((view) => [view.id, projectionMetrics(view, dimensions, scale, settings, part)]),
  ) as Record<ViewId, ProjectionMetrics>;
  if (part.views.length === 1 && part.views[0].id === 'front') {
    const bounds = metrics.front.occupied,
      area = page.fittingArea;
    const transform = {
      x: (area.minX + area.maxX - bounds.minX - bounds.maxX) / 2,
      y: (area.minY + area.maxY - bounds.minY - bounds.maxY) / 2,
      scale,
    };
    return {
      arrangement: 'single-view',
      scale,
      page,
      metrics,
      requiredWidth: widthOf(bounds),
      requiredHeight: heightOf(bounds),
      fits: widthOf(bounds) <= widthOf(area) && heightOf(bounds) <= heightOf(area),
      viewTransforms: {
        front: transform,
        top: { ...transform },
        right: { ...transform },
        iso: { ...transform },
      },
    };
  }
  if (!metrics.front || !metrics.top || !metrics.right || !metrics.iso)
    throw new Error('A drawing requires front, top, right and isometric projections.');
  const front = metrics.front.occupied,
    top = metrics.top.occupied,
    right = metrics.right.occupied,
    iso = metrics.iso.occupied;
  const mainColumn = { minX: Math.min(front.minX, top.minX), maxX: Math.max(front.maxX, top.maxX) };
  const upperRow = {
    minY: Math.min(front.minY, right.minY),
    maxY: Math.max(front.maxY, right.maxY),
  };
  const leftWidth = Math.max(widthOf(right), widthOf(iso)),
    rightWidth = mainColumn.maxX - mainColumn.minX;
  const upperHeight = upperRow.maxY - upperRow.minY,
    lowerHeight = Math.max(heightOf(top), heightOf(iso));
  const gap = 12,
    requiredWidth = leftWidth + gap + rightWidth,
    requiredHeight = upperHeight + gap + lowerHeight;
  const area = page.fittingArea,
    x = area.minX + (widthOf(area) - requiredWidth) / 2,
    y = area.minY + (heightOf(area) - requiredHeight) / 2;
  const mainX = x + leftWidth + gap - mainColumn.minX,
    upperY = y - upperRow.minY,
    lowerY = y + upperHeight + gap;
  const viewTransforms: Record<ViewId, ViewTransform> = {
    front: { x: mainX, y: upperY, scale },
    right: { x: x + (leftWidth - widthOf(right)) / 2 - right.minX, y: upperY, scale },
    top: { x: mainX, y: lowerY + (lowerHeight - heightOf(top)) / 2 - top.minY, scale },
    iso: {
      x: x + (leftWidth - widthOf(iso)) / 2 - iso.minX,
      y: lowerY + (lowerHeight - heightOf(iso)) / 2 - iso.minY,
      scale,
    },
  };
  const grid: CalculatedDrawingLayout = {
    arrangement: 'four-view-grid',
    scale,
    viewTransforms,
    fits: requiredWidth <= widthOf(area) + 1e-8 && requiredHeight <= heightOf(area) + 1e-8,
    page,
    metrics,
    requiredWidth,
    requiredHeight,
  };
  const coreWidth = widthOf(right) + gap + rightWidth;
  const coreHeight = upperHeight + gap + heightOf(top);
  const outboardWidth = coreWidth + gap + widthOf(iso);
  const outboardHeight = Math.max(coreHeight, heightOf(iso));
  const outboardX = area.minX + (widthOf(area) - outboardWidth) / 2;
  const outboardY = area.minY + (heightOf(area) - outboardHeight) / 2;
  const coreY = outboardY + (outboardHeight - coreHeight) / 2;
  const alignedX = outboardX + widthOf(right) + gap - mainColumn.minX;
  const alignedY = coreY - upperRow.minY;
  const outboard: CalculatedDrawingLayout = {
    arrangement: 'isometric-outboard',
    scale,
    page,
    metrics,
    requiredWidth: outboardWidth,
    requiredHeight: outboardHeight,
    fits: outboardWidth <= widthOf(area) + 1e-8 && outboardHeight <= heightOf(area) + 1e-8,
    viewTransforms: {
      front: { x: alignedX, y: alignedY, scale },
      right: { x: outboardX - right.minX, y: alignedY, scale },
      top: { x: alignedX, y: coreY + upperHeight + gap - top.minY, scale },
      iso: {
        x: outboardX + coreWidth + gap - iso.minX,
        y: outboardY + (outboardHeight - heightOf(iso)) / 2 - iso.minY,
        scale,
      },
    },
  };
  const overflow = (candidate: CalculatedDrawingLayout) =>
    Math.max(candidate.requiredWidth / widthOf(area), candidate.requiredHeight / heightOf(area));
  return [grid, outboard].sort(
    (a, b) =>
      Number(b.fits) - Number(a.fits) ||
      (!a.fits && !b.fits ? overflow(a) - overflow(b) : 0) ||
      a.requiredWidth * a.requiredHeight - b.requiredWidth * b.requiredHeight,
  )[0];
}

/** Pack variable orthographic rows and columns while preserving model coordinate datums. */
export function calculateDrawingLayout(
  part: Part,
  dimensions: Dimension[],
  settings: DrawingSettings,
): CalculatedDrawingLayout {
  if (settings.scale !== 'auto')
    return calculateAtScale(part, dimensions, settings, settings.scale);
  const candidates = automaticDrawingScales(part);
  for (const scale of candidates) {
    const candidate = calculateAtScale(part, dimensions, settings, scale);
    if (candidate.fits) return candidate;
  }
  return calculateAtScale(part, dimensions, settings, candidates.at(-1)!);
}

/** Frozen projects retain their exact transforms; validation never recentres or rescales them. */
export function drawingLayoutFits(
  part: Part,
  dimensions: Dimension[],
  settings: DrawingSettings,
  layout: DrawingLayout,
): boolean {
  const frame = drawingPage(settings, part).content;
  return (
    Number.isFinite(layout.scale) &&
    layout.scale > 0 &&
    part.views.every((view) => {
      const transform = layout.viewTransforms[view.id];
      if (
        !transform ||
        ![transform.x, transform.y, transform.scale].every(Number.isFinite) ||
        transform.scale <= 0 ||
        Math.abs(transform.scale - layout.scale) > Math.max(1e-10, layout.scale * 1e-10)
      )
        return false;
      const bounds = projectionMetrics(view, dimensions, transform.scale, settings, part).occupied;
      return (
        bounds.minX + transform.x >= frame.minX &&
        bounds.maxX + transform.x <= frame.maxX &&
        bounds.minY + transform.y >= frame.minY &&
        bounds.maxY + transform.y <= frame.maxY
      );
    })
  );
}

export function dimensionLabelsOverlap(
  dimensions: Dimension[],
  layout: DrawingLayout,
  precision: number,
): boolean {
  const labels = dimensions
    .map(
      (dimension) =>
        dimensionGeometry(dimension, layout.viewTransforms[dimension.viewId], precision)
          .labelBounds,
    )
    .sort((a, b) => a.minX - b.minX);
  for (let index = 0; index < labels.length; index++) {
    const current = labels[index];
    for (
      let next = index + 1;
      next < labels.length && labels[next].minX < current.maxX - 1e-5;
      next++
    ) {
      const candidate = labels[next];
      if (candidate.minY < current.maxY - 1e-5 && candidate.maxY > current.minY + 1e-5) return true;
    }
  }
  return false;
}
