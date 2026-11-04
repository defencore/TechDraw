import type { Point2 } from '../model';

export interface ViewportState {
  /** Zoom relative to a sheet fitted within the viewport. */
  zoom: number;
  /** Translation in viewport pixels, measured from the centred sheet. */
  pan: Point2;
}

export interface ViewportMetrics {
  width: number;
  height: number;
  paperWidth: number;
  paperHeight: number;
  padding?: number;
  /** Floating controls reserve fit space while the paper can pan underneath them. */
  insets?: { top: number; right: number; bottom: number; left: number };
}
export interface ViewportSafeArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ViewportTransform {
  /** Sheet origin in viewport pixels. */
  x: number;
  y: number;
  /** Display pixels per millimetre; independent of the drawing's model scale. */
  scale: number;
}

export const MIN_VIEWPORT_ZOOM = 0.25;
export const MAX_VIEWPORT_ZOOM = 16;

export function clampViewportZoom(zoom: number): number {
  return Number.isNaN(zoom) ? 1 : Math.max(MIN_VIEWPORT_ZOOM, Math.min(MAX_VIEWPORT_ZOOM, zoom));
}

const positive = (value: number) => (Number.isFinite(value) && value > 0 ? value : 1);
const finite = (value: number) => (Number.isFinite(value) ? value : 0);

function normalizedMetrics(metrics: ViewportMetrics) {
  // Hidden or temporarily collapsed containers must not create infinite transforms.
  const width = positive(metrics.width),
    height = positive(metrics.height);
  const pair = (
    start: number | undefined,
    end: number | undefined,
    extent: number,
  ): [number, number] => {
    const a = Math.max(0, finite(start ?? 0)),
      b = Math.max(0, finite(end ?? 0));
    const factor = a + b > extent - 1 ? Math.max(0, extent - 1) / (a + b) : 1;
    return [a * factor, b * factor];
  };
  const [left, right] = pair(metrics.insets?.left, metrics.insets?.right, width);
  const [top, bottom] = pair(metrics.insets?.top, metrics.insets?.bottom, height);
  return {
    width,
    height,
    paperWidth: positive(metrics.paperWidth),
    paperHeight: positive(metrics.paperHeight),
    padding: Math.max(0, finite(metrics.padding ?? 24)),
    area: {
      x: left,
      y: top,
      width: Math.max(1, width - left - right),
      height: Math.max(1, height - top - bottom),
    },
  };
}

export function viewportSafeArea(metrics: ViewportMetrics): ViewportSafeArea {
  return normalizedMetrics(metrics).area;
}

export function fitViewport(): ViewportState {
  return { zoom: 1, pan: [0, 0] };
}

/** Fit uses both viewport dimensions and preserves the paper's physical aspect ratio. */
export function getViewportTransform(
  state: ViewportState,
  metrics: ViewportMetrics,
): ViewportTransform {
  const { area, paperWidth, paperHeight, padding } = normalizedMetrics(metrics);
  const scale =
    Math.min(
      Math.max(1, area.width - 2 * padding) / paperWidth,
      Math.max(1, area.height - 2 * padding) / paperHeight,
    ) * clampViewportZoom(state.zoom);
  return {
    x: area.x + (area.width - paperWidth * scale) / 2 + finite(state.pan[0]),
    y: area.y + (area.height - paperHeight * scale) / 2 + finite(state.pan[1]),
    scale,
  };
}

/** Convert viewport-local pixels to the SVG sheet's millimetres, with Y pointing down. */
export function toSheet(point: Point2, state: ViewportState, metrics: ViewportMetrics): Point2 {
  const transform = getViewportTransform(state, metrics);
  return [(point[0] - transform.x) / transform.scale, (point[1] - transform.y) / transform.scale];
}

export function fromSheet(point: Point2, state: ViewportState, metrics: ViewportMetrics): Point2 {
  const transform = getViewportTransform(state, metrics);
  return [transform.x + point[0] * transform.scale, transform.y + point[1] * transform.scale];
}

/** Keep the same sheet point under the cursor while changing display zoom. */
export function zoomAt(
  state: ViewportState,
  metrics: ViewportMetrics,
  point: Point2,
  newZoom: number,
): ViewportState {
  const previousZoom = clampViewportZoom(state.zoom);
  const zoom = clampViewportZoom(newZoom);
  const pan: Point2 = [finite(state.pan[0]), finite(state.pan[1])];
  if (zoom === previousZoom) return { zoom, pan };
  const area = viewportSafeArea(metrics);
  const cx = area.x + area.width / 2,
    cy = area.y + area.height / 2;
  const ratio = zoom / previousZoom;
  return {
    zoom,
    pan: [
      point[0] - cx - (point[0] - cx - pan[0]) * ratio,
      point[1] - cy - (point[1] - cy - pan[1]) * ratio,
    ],
  };
}

export function panViewport(state: ViewportState, delta: Point2): ViewportState {
  return {
    zoom: clampViewportZoom(state.zoom),
    pan: [finite(state.pan[0]) + finite(delta[0]), finite(state.pan[1]) + finite(delta[1])],
  };
}

/** Floating controls change fit space, not the paper's current physical screen mapping. */
export function preserveViewportTransform(
  state: ViewportState,
  oldMetrics: ViewportMetrics,
  newMetrics: ViewportMetrics,
): ViewportState {
  const previous = getViewportTransform(state, oldMetrics);
  const base = getViewportTransform(fitViewport(), newMetrics);
  const zoom = clampViewportZoom(previous.scale / base.scale);
  const centered = getViewportTransform({ zoom, pan: [0, 0] }, newMetrics);
  return { zoom, pan: [previous.x - centered.x, previous.y - centered.y] };
}

/** Preserve the centre sheet point and relative fit zoom when viewport dimensions change. */
export function resizeViewport(
  state: ViewportState,
  oldMetrics: ViewportMetrics,
  newMetrics: ViewportMetrics,
): ViewportState {
  const previous = viewportSafeArea(oldMetrics);
  const next = viewportSafeArea(newMetrics);
  const point = toSheet(
    [previous.x + previous.width / 2, previous.y + previous.height / 2],
    state,
    oldMetrics,
  );
  const centered = { zoom: clampViewportZoom(state.zoom), pan: [0, 0] as Point2 };
  const screen = fromSheet(point, centered, newMetrics);
  return {
    zoom: centered.zoom,
    pan: [next.x + next.width / 2 - screen[0], next.y + next.height / 2 - screen[1]],
  };
}
