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
  return {
    width: positive(metrics.width),
    height: positive(metrics.height),
    paperWidth: positive(metrics.paperWidth),
    paperHeight: positive(metrics.paperHeight),
    padding: Math.max(0, finite(metrics.padding ?? 24)),
  };
}

export function fitViewport(): ViewportState {
  return { zoom: 1, pan: [0, 0] };
}

/** Fit uses both viewport dimensions and preserves the paper's physical aspect ratio. */
export function getViewportTransform(
  state: ViewportState,
  metrics: ViewportMetrics,
): ViewportTransform {
  const { width, height, paperWidth, paperHeight, padding } = normalizedMetrics(metrics);
  const scale =
    Math.min(
      Math.max(1, width - 2 * padding) / paperWidth,
      Math.max(1, height - 2 * padding) / paperHeight,
    ) * clampViewportZoom(state.zoom);
  return {
    x: (width - paperWidth * scale) / 2 + finite(state.pan[0]),
    y: (height - paperHeight * scale) / 2 + finite(state.pan[1]),
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
  const { width, height } = normalizedMetrics(metrics);
  const ratio = zoom / previousZoom;
  return {
    zoom,
    pan: [
      point[0] - width / 2 - (point[0] - width / 2 - pan[0]) * ratio,
      point[1] - height / 2 - (point[1] - height / 2 - pan[1]) * ratio,
    ],
  };
}

export function panViewport(state: ViewportState, delta: Point2): ViewportState {
  return {
    zoom: clampViewportZoom(state.zoom),
    pan: [finite(state.pan[0]) + finite(delta[0]), finite(state.pan[1]) + finite(delta[1])],
  };
}

/** Preserve the centre sheet point and relative fit zoom when viewport dimensions change. */
export function resizeViewport(
  state: ViewportState,
  oldMetrics: ViewportMetrics,
  newMetrics: ViewportMetrics,
): ViewportState {
  const previous = normalizedMetrics(oldMetrics);
  const next = normalizedMetrics(newMetrics);
  const point = toSheet([previous.width / 2, previous.height / 2], state, oldMetrics);
  const centered = { zoom: clampViewportZoom(state.zoom), pan: [0, 0] as Point2 };
  const screen = fromSheet(point, centered, newMetrics);
  return {
    zoom: centered.zoom,
    pan: [next.width / 2 - screen[0], next.height / 2 - screen[1]],
  };
}
