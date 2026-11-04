import { isGridSpacing, snapCoordinate } from '../drawing/grid-coordinates';
import type {
  Dimension,
  DimensionKind,
  DrawingAnnotation,
  Bounds2,
  DrawingLayout,
  DrawingSettings,
  Part,
  Point2,
  ProjectedEdge,
  ViewId,
} from '../model';
import { renderDimension, renderDrawing, paperSize, type RenderedDrawing } from '../drawing/render';
import { createLinearDimension, measureAngle } from '../measurements';
import { dragDimension, positionDimension } from './dimension-drag';
import { pickDimension } from './dimension-picking';
import { nearestPointOnEdge, pickGeometry, type GeometryPick } from './geometry-picking';
import { drawingPage } from '../drawing/page-layout';
import { drawingSettingsForInstructions } from '../drawing/manufacturing-instructions';
import { dimensionGeometry } from '../drawing/dimension-geometry';
import { annotationBounds, renderAnnotation, translateAnnotation } from '../drawing/annotations';
import { applyDrawingAppearance, type DrawingAppearance } from '../drawing/appearance';
import {
  createAnnotation,
  defaultAnnotationOptions,
  extendAnnotation,
  isAnnotationTool,
  pickAnnotation,
  validateAnnotationOptions,
  type AnnotationOptions,
  type AnnotationTool,
} from './annotation-tools';
import { marqueeRegion, selectMarquee } from './marquee-selection';
import { DimensionSelection } from './dimension-selection';
import {
  defaultGridSettings,
  renderWorkspaceGrid,
  snapDimensionToGrid,
  snappedDragPoint,
  visibleGridSpacing,
  type GridSettings,
} from './drawing-grid';
import {
  fitViewport,
  clampViewportZoom,
  getViewportTransform,
  panViewport,
  preserveViewportTransform,
  resizeViewport,
  viewportSafeArea,
  toSheet,
  zoomAt,
  type ViewportMetrics,
  type ViewportState,
} from './viewport';

export type CanvasTool = 'select' | 'box-select' | 'pan' | DimensionKind | AnnotationTool;
export interface CanvasDocument {
  part: Part;
  dimensions: Dimension[];
  settings: DrawingSettings;
  layout: DrawingLayout;
  selectedDimension?: string;
  selectedDimensionIds?: readonly string[];
  annotations?: DrawingAnnotation[];
  selectedAnnotation?: string;
  appearance?: DrawingAppearance;
  instructions?: string;
}
interface CanvasCallbacks {
  select(id?: string, additive?: boolean): void;
  selectMany(ids: string[], additive: boolean): void;
  contextMenu(position: { clientX: number; clientY: number; dimensionId?: string }): void;
  add(dimension: Dimension): void;
  edit(dimension: Dimension): void;
  editMany(dimensions: Dimension[]): void;
  selectAnnotation(id?: string): void;
  addAnnotation(annotation: DrawingAnnotation): void;
  editAnnotation(annotation: DrawingAnnotation): void;
  zoom(value: number): void;
  hint(message: string): void;
  error(message: string): void;
}
interface PointerGesture {
  pointerId: number;
  pointerType: string;
  startClient: Point2;
  startSheet: Point2;
  moved: boolean;
  dimension?: Dimension;
  dimensions?: Dimension[];
  preview?: Dimension;
  previews?: Dimension[];
  viewport?: ViewportState;
  click?: boolean;
  marquee?: { endSheet: Point2; endClient: Point2; additive: boolean };
  annotation?: DrawingAnnotation;
  annotationPreview?: DrawingAnnotation;
  creatingAnnotation?: boolean;
}

/** Owns only screen interaction. Model measurements and paper layout never depend on zoom. */
export class DrawingCanvas {
  private element?: HTMLElement;
  private document?: CanvasDocument;
  private sheet?: RenderedDrawing;
  private metrics?: ViewportMetrics;
  private viewport = fitViewport();
  private tool: CanvasTool = 'select';
  private gesture?: PointerGesture;
  private pendingPoint?: { viewId: ViewId; point: Point2; source?: [number, number, number] };
  private pendingEdge?: { viewId: ViewId; edge: ProjectedEdge };
  private draft?: Dimension;
  private hovered?: GeometryPick;
  private hoverDimension?: string;
  private frame?: number;
  private space = false;
  private pointerClient?: Point2;
  private enabled = true;
  private readOnly = false;
  private annotationOptions = { ...defaultAnnotationOptions };
  private grid = { ...defaultGridSettings };
  private touches = new Map<number, Point2>();
  private pinch?: { distance: number; midpoint: Point2; viewport: ViewportState };
  private readonly resize = new ResizeObserver(() => this.applyViewport());

  constructor(private readonly callbacks: CanvasCallbacks) {}

  attach(element: HTMLElement): void {
    if (this.element === element) return;
    if (this.element) throw new Error('The drawing canvas must remain mounted during editing.');
    this.element = element;
    element.addEventListener('pointerdown', this.pointerDown);
    element.addEventListener('pointermove', this.pointerMove);
    element.addEventListener('pointerup', this.pointerUp);
    element.addEventListener('pointercancel', this.pointerCancel);
    element.addEventListener('lostpointercapture', this.pointerCancel);
    element.addEventListener('pointerleave', () => {
      if (!this.gesture && !this.pinch) {
        this.hovered = undefined;
        this.highlightDimension();
        this.feedback();
      }
    });
    element.addEventListener('wheel', this.wheel, { passive: false });
    element.addEventListener('dblclick', (event) => {
      if (
        this.enabled &&
        this.document &&
        (this.readOnly ||
          (this.tool === 'select' && !this.dimensionAt(event) && !this.annotationAt(event)))
      ) {
        event.preventDefault();
        this.setZoom(this.viewport.zoom * 2, this.local(event));
      }
    });
    element.addEventListener('contextmenu', this.contextMenu);
    this.resize.observe(element);
  }

  setDocument(document?: CanvasDocument): RenderedDrawing | undefined {
    const old = this.document;
    if (old?.part.id !== document?.part.id) {
      this.cancel();
      this.viewport = fitViewport();
      this.metrics = undefined;
    } else if (old?.layout !== document?.layout) this.cancel();
    this.document = document;
    if (!document) {
      this.sheet = undefined;
      this.element?.querySelector('#paper-host')?.replaceChildren();
      this.element?.classList.remove('has-sheet');
      this.metrics = undefined;
      return;
    }
    const [width, height] = paperSize(document.settings);
    if (this.sheet && (this.sheet.width !== width || this.sheet.height !== height)) {
      this.viewport = fitViewport();
      this.metrics = undefined;
    }
    this.sheet = renderDrawing(
      document.part,
      document.dimensions,
      document.settings,
      this.readOnly ? undefined : document.selectedDimension,
      document.layout,
      {
        annotations: document.annotations,
        appearance: document.appearance,
        instructions: document.instructions,
      },
    );
    const host = this.element?.querySelector<HTMLElement>('#paper-host');
    if (host) {
      host.className = 'paper-host';
      host.innerHTML = this.sheet.svg;
      this.element!.classList.add('has-sheet');
      this.applyViewport();
      this.patchSelections();
      this.patchAnnotations();
      this.feedback();
    }
    this.hint();
    return this.sheet;
  }

  setEnabled(value: boolean): void {
    this.enabled = value;
    if (!value) this.cancel();
  }
  setReadOnly(value: boolean): void {
    if (this.readOnly !== value) this.cancel();
    this.readOnly = value;
    this.element?.classList.toggle('viewer-mode', value);
    this.patchSelections();
    this.patchAnnotations();
    this.hint();
  }
  setAnnotationOptions(options: AnnotationOptions): void {
    this.annotationOptions = validateAnnotationOptions(options);
  }
  setGrid(settings: GridSettings): void {
    if (
      typeof settings.visible !== 'boolean' ||
      typeof settings.snap !== 'boolean' ||
      !isGridSpacing(settings.spacing)
    )
      throw new RangeError(
        'Grid settings need boolean visibility/snapping and spacing 0.1–100 mm.',
      );
    this.grid = { ...settings };
    this.patchGrid();
    this.hint();
  }
  setTool(tool: CanvasTool): void {
    if (this.tool !== tool) this.cancel();
    this.tool = tool;
    this.element?.classList.toggle('measuring', !['select', 'box-select', 'pan'].includes(tool));
    this.element?.classList.toggle('pan-tool', tool === 'pan');
    this.element?.classList.toggle('box-select-tool', tool === 'box-select');
    this.hint();
  }
  setPanKey(value: boolean): void {
    this.space = value;
    this.element?.classList.toggle('pan-key', value);
  }
  get zoom(): number {
    return this.viewport.zoom;
  }
  get gridDisplaySpacing(): number | undefined {
    return this.grid.visible && this.metrics
      ? visibleGridSpacing(
          this.grid.spacing,
          getViewportTransform(this.viewport, this.metrics).scale,
        )
      : undefined;
  }
  refreshViewport(): void {
    this.applyViewport();
  }
  fit(): void {
    if (this.gesture?.dimension || this.gesture?.annotation || this.gesture?.marquee || this.pinch)
      return;
    this.viewport = fitViewport();
    this.applyViewport(false);
    this.rebasePan();
  }
  fitSelection(): boolean {
    if (
      !this.document ||
      !this.sheet ||
      !this.metrics ||
      this.gesture?.dimension ||
      this.gesture?.annotation ||
      this.gesture?.marquee ||
      this.pinch
    )
      return false;
    const bounds = this.getSelectionPaperBounds();
    if (!bounds) return false;
    const baseScale = getViewportTransform(fitViewport(), this.metrics).scale;
    const area = viewportSafeArea(this.metrics);
    const pixelsPerMillimetre = Math.min(
      Math.max(1, area.width - 80) / Math.max(1, bounds.maxX - bounds.minX),
      Math.max(1, area.height - 80) / Math.max(1, bounds.maxY - bounds.minY),
    );
    const zoom = clampViewportZoom(pixelsPerMillimetre / baseScale);
    const centered = getViewportTransform({ zoom, pan: [0, 0] }, this.metrics);
    this.viewport = {
      zoom,
      pan: [
        area.x + area.width / 2 - centered.x - ((bounds.minX + bounds.maxX) / 2) * centered.scale,
        area.y + area.height / 2 - centered.y - ((bounds.minY + bounds.maxY) / 2) * centered.scale,
      ],
    };
    this.applyViewport(false);
    this.rebasePan();
    return true;
  }
  getSelectionPaperBounds(): Bounds2 | undefined {
    if (!this.document || !this.sheet) return;
    const selected = this.selectedIds();
    const bounds = this.document.dimensions
      .filter((d) => selected.has(d.id))
      .map(
        (d) =>
          dimensionGeometry(
            d,
            this.sheet!.viewTransforms[d.viewId],
            this.document!.settings.precision,
          ).bounds,
      );
    const annotation = this.document.annotations?.find(
      (item) => item.id === this.document!.selectedAnnotation,
    );
    if (annotation) bounds.push(annotationBounds(annotation));
    if (!bounds.length) return;
    return {
      minX: Math.min(...bounds.map((b) => b.minX)),
      minY: Math.min(...bounds.map((b) => b.minY)),
      maxX: Math.max(...bounds.map((b) => b.maxX)),
      maxY: Math.max(...bounds.map((b) => b.maxY)),
    };
  }
  getVisiblePaperBounds(): Bounds2 | undefined {
    if (!this.sheet || !this.metrics) return;
    const a = toSheet([0, 0], this.viewport, this.metrics);
    const b = toSheet([this.metrics.width, this.metrics.height], this.viewport, this.metrics);
    const bounds = {
      minX: Math.max(0, a[0]),
      minY: Math.max(0, a[1]),
      maxX: Math.min(this.sheet.width, b[0]),
      maxY: Math.min(this.sheet.height, b[1]),
    };
    return bounds.maxX > bounds.minX && bounds.maxY > bounds.minY ? bounds : undefined;
  }
  zoomBy(factor: number): void {
    this.setZoom(this.viewport.zoom * factor);
  }
  setZoom(value: number, anchor?: Point2): void {
    if (
      !this.metrics ||
      this.gesture?.dimension ||
      this.gesture?.annotation ||
      this.gesture?.marquee ||
      this.pinch
    )
      return;
    const area = viewportSafeArea(this.metrics);
    this.viewport = zoomAt(
      this.viewport,
      this.metrics,
      anchor ?? [area.x + area.width / 2, area.y + area.height / 2],
      value,
    );
    this.applyViewport(false);
    this.rebasePan();
  }
  private rebasePan(): void {
    if (this.gesture?.viewport && this.pointerClient) {
      this.gesture.viewport = structuredClone(this.viewport);
      this.gesture.startClient = [...this.pointerClient];
    }
  }
  cancel(): void {
    const gesture = this.gesture;
    this.gesture = undefined;
    this.pinch = undefined;
    this.touches.clear();
    this.pendingPoint = undefined;
    this.pendingEdge = undefined;
    this.draft = undefined;
    this.hovered = undefined;
    this.highlightDimension();
    this.restoreGesture(gesture);
    this.marqueeFeedback();
    if (gesture && this.element?.hasPointerCapture(gesture.pointerId))
      this.element.releasePointerCapture(gesture.pointerId);
    this.element?.classList.remove('panning', 'dimension-dragging');
    this.feedback();
    this.hint();
  }

  private applyViewport(resizing = true): void {
    if (!this.element || !this.sheet) return;
    const parent = this.element.parentElement;
    const style = parent ? getComputedStyle(parent) : undefined;
    const inset = (property: string): number => {
      const value = parseFloat(style?.getPropertyValue(property) ?? '0');
      return Number.isFinite(value) && value > 0 ? value : 0;
    };
    const metrics: ViewportMetrics = {
      width: this.element.clientWidth,
      height: this.element.clientHeight,
      paperWidth: this.sheet.width,
      paperHeight: this.sheet.height,
      padding: 24,
      insets: { top: inset('--canvas-top'), right: 0, bottom: inset('--canvas-bottom'), left: 0 },
    };
    const sameDimensions =
      this.metrics &&
      this.metrics.width === metrics.width &&
      this.metrics.height === metrics.height &&
      this.metrics.paperWidth === metrics.paperWidth &&
      this.metrics.paperHeight === metrics.paperHeight;
    const insetsChanged =
      this.metrics &&
      (['top', 'right', 'bottom', 'left'] as const).some(
        (side) => (this.metrics!.insets?.[side] ?? 0) !== (metrics.insets?.[side] ?? 0),
      );
    const resized = Boolean(this.metrics && ((resizing && !sameDimensions) || insetsChanged));
    if (resized && this.metrics) {
      const before = getViewportTransform(this.viewport, this.metrics);
      const next = sameDimensions
        ? preserveViewportTransform(this.viewport, this.metrics, metrics)
        : resizeViewport(this.viewport, this.metrics, metrics);
      const after = getViewportTransform(next, metrics);
      const mappingChanged = !sameDimensions || Math.abs(before.scale - after.scale) > 1e-10;
      if (
        this.pinch ||
        (mappingChanged &&
          (this.gesture?.dimension || this.gesture?.annotation || this.gesture?.marquee))
      )
        this.cancel();
      this.viewport = next;
    }
    this.metrics = metrics;
    if (resized) this.rebasePan();
    const transform = getViewportTransform(this.viewport, metrics);
    const host = this.element.querySelector<HTMLElement>('#paper-host');
    if (host) {
      host.style.width = `${this.sheet.width}px`;
      host.style.height = `${this.sheet.height}px`;
      host.style.transform = `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`;
    }
    this.callbacks.zoom(this.viewport.zoom);
    this.patchGrid();
    this.feedback();
  }
  private patchGrid(): void {
    const svg = this.element?.querySelector<SVGSVGElement>('#paper-host > svg');
    if (!svg || !this.document || !this.metrics) return;
    let overlay = svg.querySelector<SVGGElement>('[data-workspace-grid]');
    if (!this.grid.visible) {
      overlay?.remove();
      return;
    }
    if (!overlay) {
      overlay = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      overlay.dataset.workspaceGrid = '';
      overlay.setAttribute('pointer-events', 'none');
      overlay.setAttribute('aria-hidden', 'true');
      // The page background stays opaque; the grid sits behind all drawing primitives.
      svg.insertBefore(overlay, svg.querySelector(':scope > g'));
    }
    overlay.innerHTML = applyDrawingAppearance(
      renderWorkspaceGrid(
        drawingPage(
          drawingSettingsForInstructions(this.document.settings, this.document.instructions),
        ).content,
        this.grid,
        getViewportTransform(this.viewport, this.metrics).scale,
      ),
      this.document.appearance,
    );
  }
  private local(event: { clientX: number; clientY: number }): Point2 {
    const rect = this.element!.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  }
  private sheetPoint(event: { clientX: number; clientY: number }): Point2 {
    return toSheet(this.local(event), this.viewport, this.metrics!);
  }
  private dimensionAt(event: { clientX: number; clientY: number }): string | undefined {
    const svg = this.element?.querySelector<SVGSVGElement>('#paper-host > svg');
    return svg ? pickDimension(svg, [event.clientX, event.clientY]) : undefined;
  }
  private annotationAt(event: { clientX: number; clientY: number }): DrawingAnnotation | undefined {
    if (!this.document || !this.metrics) return;
    const id = pickAnnotation(
      this.document.annotations ?? [],
      this.sheetPoint(event),
      getViewportTransform(this.viewport, this.metrics).scale,
    );
    return this.document.annotations?.find((annotation) => annotation.id === id);
  }
  private geometryAt(event: { clientX: number; clientY: number }): GeometryPick | undefined {
    if (!this.document || !this.sheet || !this.metrics) return;
    const mode = this.pendingPoint
      ? 'point'
      : this.tool === 'diameter' || this.tool === 'radius'
        ? 'circle'
        : this.tool === 'angle'
          ? 'line'
          : 'point';
    return pickGeometry(
      this.document.part,
      this.sheet,
      this.sheetPoint(event),
      getViewportTransform(this.viewport, this.metrics).scale,
      mode,
      this.pendingPoint?.viewId ?? this.pendingEdge?.viewId,
      { includeHidden: this.document.settings.hiddenLines },
    );
  }

  private pointerDown = (event: PointerEvent): void => {
    if (
      !this.enabled ||
      !this.document ||
      !this.metrics ||
      !this.element ||
      event.button > 1 ||
      (event.pointerType === 'pen' && event.button !== 0)
    )
      return;
    if (this.gesture?.pointerType === 'pen' && this.gesture.pointerId !== event.pointerId) {
      event.preventDefault();
      return;
    }
    // Palm contact can precede the pen tip. The pen owns the stroke from this point onward.
    if (event.pointerType === 'pen' && (this.gesture || this.pinch)) this.cancel();
    this.pointerClient = [event.clientX, event.clientY];
    this.element.focus({ preventScroll: true });
    if (event.pointerType === 'touch') {
      this.touches.set(event.pointerId, this.local(event));
      if (this.touches.size === 2) {
        this.restoreGesture(this.gesture);
        this.gesture = undefined;
        this.marqueeFeedback();
        this.element.classList.remove('dimension-dragging');
        const [a, b] = [...this.touches.values()];
        this.pinch = {
          distance: Math.max(1, Math.hypot(b[0] - a[0], b[1] - a[1])),
          midpoint: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
          viewport: structuredClone(this.viewport),
        };
        this.element.setPointerCapture(event.pointerId);
        event.preventDefault();
        return;
      }
    }
    const annotation =
      !this.readOnly && this.tool === 'select' && !this.space && event.button === 0
        ? this.annotationAt(event)
        : undefined;
    const id =
      !this.readOnly && !annotation && this.tool === 'select' && !this.space && event.button === 0
        ? this.dimensionAt(event)
        : undefined;
    const dimension = id ? this.document.dimensions.find((d) => d.id === id) : undefined;
    let selected = this.selectedIds();
    if (dimension) {
      const additive = event.ctrlKey || event.metaKey || event.shiftKey;
      if (!this.selectDimension(dimension.id, additive)) {
        event.preventDefault();
        return;
      }
      selected = this.selectedIds();
      if (this.document.dimensions.some((item) => selected.has(item.id) && item.locked)) {
        event.preventDefault();
        return;
      }
    }
    const pan =
      this.readOnly ||
      this.space ||
      this.tool === 'pan' ||
      event.button === 1 ||
      (this.tool === 'select' && !dimension && !annotation);
    const box = this.tool === 'box-select' && !pan;
    let created: DrawingAnnotation | undefined;
    if (!pan && isAnnotationTool(this.tool)) {
      try {
        created = createAnnotation(
          this.tool,
          this.annotationPoint(event, this.tool === 'freehand'),
          this.annotationOptions,
        );
      } catch (error) {
        this.callbacks.error(error instanceof Error ? error.message : String(error));
        event.preventDefault();
        return;
      }
    }
    if (annotation) {
      this.selectAnnotation(annotation.id);
      if (annotation.locked) {
        event.preventDefault();
        return;
      }
    }
    // Selection can change floating controls and refresh the screen viewport synchronously.
    const sheetPoint = this.sheetPoint(event);
    this.gesture = {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      startClient: [event.clientX, event.clientY],
      startSheet: sheetPoint,
      moved: false,
      ...(annotation || created
        ? {
            annotation: structuredClone(annotation ?? created!),
            annotationPreview: structuredClone(annotation ?? created!),
            creatingAnnotation: Boolean(created),
          }
        : dimension
          ? {
              dimension: structuredClone(dimension),
              dimensions: structuredClone(
                this.document.dimensions.filter((item) => selected.has(item.id) && !item.locked),
              ),
            }
          : box
            ? {
                marquee: {
                  endSheet: sheetPoint,
                  endClient: [event.clientX, event.clientY],
                  additive: event.ctrlKey || event.metaKey || event.shiftKey,
                },
              }
            : pan
              ? { viewport: structuredClone(this.viewport) }
              : { click: true }),
    };
    this.element.setPointerCapture(event.pointerId);
    event.preventDefault();
    if (created) this.patchAnnotation(created, true);
    if (dimension) {
      this.element.classList.add('dimension-dragging');
    } else if (pan) this.element.classList.add('panning');
  };

  private pointerMove = (event: PointerEvent): void => {
    if (!this.enabled || !this.document || !this.metrics) return;
    if (this.gesture?.pointerType === 'pen' && this.gesture.pointerId !== event.pointerId) return;
    this.pointerClient = [event.clientX, event.clientY];
    if (event.pointerType === 'touch' && this.touches.has(event.pointerId))
      this.touches.set(event.pointerId, this.local(event));
    if (this.pinch && this.touches.size >= 2) {
      const [a, b] = [...this.touches.values()];
      const distance = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const midpoint: Point2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      this.viewport = panViewport(
        zoomAt(
          this.pinch.viewport,
          this.metrics,
          this.pinch.midpoint,
          (this.pinch.viewport.zoom * distance) / this.pinch.distance,
        ),
        [midpoint[0] - this.pinch.midpoint[0], midpoint[1] - this.pinch.midpoint[1]],
      );
      this.applyViewport(false);
      return;
    }
    if (this.gesture?.pointerId === event.pointerId) {
      const gesture = this.gesture;
      const dx = event.clientX - gesture.startClient[0],
        dy = event.clientY - gesture.startClient[1];
      const coalescedMovement =
        !gesture.moved &&
        gesture.pointerType === 'pen' &&
        gesture.creatingAnnotation &&
        gesture.annotation?.kind === 'freehand' &&
        typeof event.getCoalescedEvents === 'function' &&
        event
          .getCoalescedEvents()
          .some(
            (sample) =>
              Math.hypot(
                sample.clientX - gesture.startClient[0],
                sample.clientY - gesture.startClient[1],
              ) >= 3,
          );
      if (!gesture.moved && Math.hypot(dx, dy) < 3 && !coalescedMovement) return;
      gesture.moved = true;
      if (gesture.viewport) {
        this.viewport = panViewport(gesture.viewport, [dx, dy]);
        this.applyViewport(false);
      } else if (gesture.marquee) {
        gesture.marquee.endSheet = this.sheetPoint(event);
        gesture.marquee.endClient = [event.clientX, event.clientY];
        this.marqueeFeedback();
      } else if (gesture.annotation) {
        this.previewAnnotation(gesture, event);
      } else if (gesture.dimension && this.sheet) {
        this.previewDrag(gesture, event);
      }
      return;
    }
    if (this.readOnly || isAnnotationTool(this.tool)) return;
    if (this.draft && this.sheet) {
      this.draft = this.positionDraft(this.draft, event);
      this.scheduleFeedback();
      return;
    }
    if (!['select', 'box-select', 'pan'].includes(this.tool)) {
      this.hovered = this.geometryAt(event);
      this.scheduleFeedback();
    } else if (this.tool === 'select') this.highlightDimension(this.dimensionAt(event));
  };

  private pointerUp = (event: PointerEvent): void => {
    if (this.touches.has(event.pointerId)) this.touches.delete(event.pointerId);
    if (this.pinch) {
      this.pinch = undefined;
      const remaining = [...this.touches.entries()][0];
      if (remaining && this.element && this.metrics) {
        const rect = this.element.getBoundingClientRect(),
          [id, point] = remaining;
        this.gesture = {
          pointerId: id,
          pointerType: 'touch',
          startClient: [point[0] + rect.left, point[1] + rect.top],
          startSheet: toSheet(point, this.viewport, this.metrics),
          moved: true,
          viewport: structuredClone(this.viewport),
        };
        this.element.classList.add('panning');
      } else {
        this.gesture = undefined;
        this.element?.classList.remove('panning');
      }
      this.element?.classList.remove('dimension-dragging');
      return;
    }
    const gesture = this.gesture;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (
      gesture.pointerType === 'pen' &&
      gesture.creatingAnnotation &&
      gesture.annotation?.kind === 'freehand' &&
      Math.hypot(event.clientX - gesture.startClient[0], event.clientY - gesture.startClient[1]) >=
        3
    )
      gesture.moved = true;
    this.gesture = undefined;
    if (this.element?.hasPointerCapture(event.pointerId))
      this.element.releasePointerCapture(event.pointerId);
    this.element?.classList.remove('panning', 'dimension-dragging');
    this.marqueeFeedback();
    if (gesture.annotation && this.document) {
      if (
        gesture.annotation.locked ||
        this.document.annotations?.some((item) => item.id === gesture.annotation!.id && item.locked)
      ) {
        this.restoreGesture(gesture);
        return;
      }
      if (gesture.moved) this.previewAnnotation(gesture, event);
      const next = gesture.annotationPreview ?? gesture.annotation;
      if (
        (!gesture.creatingAnnotation && !gesture.moved) ||
        (gesture.creatingAnnotation && next.kind !== 'text' && !gesture.moved)
      ) {
        this.restoreGesture(gesture);
        return;
      }
      if (this.annotationFits(next) && this.annotationVisible(next)) {
        if (gesture.creatingAnnotation) this.callbacks.addAnnotation(next);
        else this.callbacks.editAnnotation(next);
      } else {
        this.restoreGesture(gesture);
        this.callbacks.error(
          'Keep the annotation inside the sheet and give graphics a visible size.',
        );
      }
    } else if (gesture.marquee && gesture.moved && this.document && this.sheet) {
      const ids = selectMarquee(
        this.document.dimensions.map((dimension) => ({
          id: dimension.id,
          geometry: dimensionGeometry(
            dimension,
            this.sheet!.viewTransforms[dimension.viewId],
            this.document!.settings.precision,
          ),
        })),
        gesture.startSheet,
        this.sheetPoint(event),
      );
      const selected = gesture.marquee.additive ? this.selectedIds() : new Set<string>();
      for (const id of ids) selected.add(id);
      this.document = {
        ...this.document,
        selectedDimensionIds: [...selected],
        selectedAnnotation: undefined,
        selectedDimension:
          ids.at(-1) ??
          (selected.has(this.document.selectedDimension ?? '')
            ? this.document.selectedDimension
            : [...selected].at(-1)),
      };
      this.callbacks.selectMany(ids, gesture.marquee.additive);
      this.patchSelections();
      this.patchAnnotations();
    } else if (gesture.dimension && gesture.moved && gesture.preview) {
      this.previewDrag(gesture, event);
      if (!gesture.preview || !gesture.previews?.length) {
        this.restoreGesture(gesture);
        return;
      }
      const previews = gesture.previews ?? [gesture.preview];
      if (previews.every((dimension) => this.dimensionFits(dimension))) {
        if (previews.length > 1) this.callbacks.editMany(previews);
        else this.callbacks.edit(gesture.preview);
      } else {
        this.restoreGesture(gesture);
        this.callbacks.error(
          'Keep the dimension inside the drawing frame. Pan or use Fit to choose another position.',
        );
      }
    } else if (gesture.click && !gesture.moved) this.chooseGeometry(event);
    else if (
      gesture.viewport &&
      !gesture.moved &&
      !this.readOnly &&
      this.tool === 'select' &&
      !this.space &&
      event.button === 0
    ) {
      const additive = event.ctrlKey || event.metaKey || event.shiftKey;
      if (additive) return;
      this.document = {
        ...this.document!,
        selectedDimension: undefined,
        selectedDimensionIds: [],
        selectedAnnotation: undefined,
      };
      this.callbacks.select(undefined, false);
      this.patchSelections();
      this.patchAnnotations();
    }
  };
  private pointerCancel = (event: PointerEvent): void => {
    this.touches.delete(event.pointerId);
    if (this.gesture?.pointerId !== event.pointerId && !this.pinch) return;
    this.restoreGesture(this.gesture);
    this.gesture = undefined;
    this.pinch = undefined;
    this.marqueeFeedback();
    this.element?.classList.remove('panning', 'dimension-dragging');
  };
  private wheel = (event: WheelEvent): void => {
    if (!this.enabled || !this.document || !this.metrics) return;
    event.preventDefault();
    if (this.gesture?.dimension || this.gesture?.annotation || this.gesture?.marquee) return;
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.metrics.height : 1;
    if (event.shiftKey && !event.ctrlKey) {
      this.viewport = panViewport(this.viewport, [-(event.deltaX || event.deltaY) * unit, 0]);
      this.applyViewport(false);
      this.rebasePan();
    } else
      this.setZoom(
        this.viewport.zoom * Math.exp(-event.deltaY * unit * (event.ctrlKey ? 0.008 : 0.0015)),
        this.local(event),
      );
  };

  private contextMenu = (event: MouseEvent): void => {
    if (!this.enabled || !this.document) return;
    event.preventDefault();
    if ('pointerType' in event && event.pointerType === 'pen') return;
    if (this.readOnly || this.space || this.tool === 'pan' || this.gesture || this.pinch) return;
    const annotation = this.annotationAt(event);
    if (annotation) {
      this.selectAnnotation(annotation.id);
      this.callbacks.contextMenu({ clientX: event.clientX, clientY: event.clientY });
      return;
    }
    const id = this.dimensionAt(event);
    if (id && this.document.dimensions.some((dimension) => dimension.id === id))
      this.selectDimension(id);
    this.callbacks.contextMenu({ clientX: event.clientX, clientY: event.clientY, dimensionId: id });
  };

  private chooseGeometry(event: PointerEvent): void {
    if (!this.document || !this.sheet) return;
    if (this.draft) {
      const dimension = this.positionDraft(this.draft, event);
      if (!this.dimensionFits(dimension)) {
        this.callbacks.error(
          'Place the dimension inside the drawing frame. Pan or use Fit to find the page.',
        );
        return;
      }
      this.draft = undefined;
      this.pendingPoint = undefined;
      this.pendingEdge = undefined;
      this.hovered = undefined;
      this.callbacks.add(dimension);
      return;
    }
    const hit = this.geometryAt(event);
    if (!hit) {
      this.callbacks.error('Move closer to an edge or a snap point in an orthographic view.');
      return;
    }
    try {
      let dimension: Dimension | undefined;
      if (this.tool === 'diameter' || this.tool === 'radius') {
        const edge = hit.edge;
        if (!edge?.center || !edge.radius) return;
        const cursor = this.sheetPoint(event),
          transform = this.sheet.viewTransforms[hit.viewId];
        const modelPoint: Point2 = [
          (cursor[0] - transform.x) / transform.scale,
          (transform.y - cursor[1]) / transform.scale,
        ];
        dimension = {
          id: crypto.randomUUID(),
          viewId: hit.viewId,
          kind: this.tool,
          a: [...edge.center],
          b:
            this.tool === 'radius'
              ? nearestPointOnEdge(edge, modelPoint)
              : [edge.center[0] + edge.radius, edge.center[1]],
          value: edge.radius * (this.tool === 'diameter' ? 2 : 1),
          offset: 10,
          automatic: false,
        };
      } else if (this.tool === 'angle' && hit.edge) {
        if (this.pendingEdge) dimension = measureAngle(hit.viewId, this.pendingEdge.edge, hit.edge);
        else this.pendingEdge = { viewId: hit.viewId, edge: hit.edge };
      } else if (hit.anchor && ['horizontal', 'vertical', 'aligned'].includes(this.tool)) {
        if (this.pendingPoint)
          dimension = createLinearDimension(
            hit.viewId,
            this.pendingPoint.point,
            hit.anchor.point,
            this.tool as DimensionKind,
            this.pendingPoint.source,
            hit.anchor.source,
          );
        else
          this.pendingPoint = {
            viewId: hit.viewId,
            point: hit.anchor.point,
            source: hit.anchor.source,
          };
      } else if (hit.edge && ['horizontal', 'vertical', 'aligned'].includes(this.tool)) {
        const edge = hit.edge;
        if (edge.kind !== 'line') {
          this.callbacks.error('Choose a straight edge or two snap points for a linear dimension.');
          return;
        }
        if (this.pendingPoint) this.callbacks.error('Choose a second snap point in the same view.');
        else
          dimension = createLinearDimension(
            hit.viewId,
            edge.points[0],
            edge.points.at(-1)!,
            this.tool as DimensionKind,
            edge.sourcePoints?.[0],
            edge.sourcePoints?.at(-1),
            edge.length,
          );
      }
      if (dimension) {
        this.draft = this.positionDraft(dimension, event);
        this.hovered = undefined;
      }
    } catch (error) {
      this.pendingPoint = undefined;
      this.pendingEdge = undefined;
      this.callbacks.error(error instanceof Error ? error.message : String(error));
    }
    this.feedback();
    this.hint();
  }

  private positionDraft(dimension: Dimension, event: PointerEvent): Dimension {
    const transform = this.sheet!.viewTransforms[dimension.viewId];
    const placed = positionDimension(
      dimension,
      this.sheetPoint(event),
      transform,
      this.document!.settings.precision,
    );
    return event.altKey
      ? placed
      : snapDimensionToGrid(placed, transform, this.document!.settings.precision, this.grid);
  }

  private previewDrag(gesture: PointerGesture, event: PointerEvent): void {
    if (!gesture.dimension || !this.sheet || !this.document) return;
    if (
      (gesture.dimensions ?? [gesture.dimension]).some(
        (dimension) =>
          dimension.locked ||
          this.document!.dimensions.some((item) => item.id === dimension.id && item.locked),
      )
    ) {
      gesture.preview = undefined;
      gesture.previews = [];
      this.restoreGesture(gesture);
      return;
    }
    let current = this.sheetPoint(event);
    if (!event.altKey)
      current = snappedDragPoint(
        gesture.dimension,
        gesture.startSheet,
        current,
        this.sheet.viewTransforms[gesture.dimension.viewId],
        this.document.settings.precision,
        this.grid,
      );
    gesture.previews = (gesture.dimensions ?? [gesture.dimension])
      .filter(
        (dimension) =>
          !dimension.locked &&
          !this.document!.dimensions.some((item) => item.id === dimension.id && item.locked),
      )
      .map((dimension) =>
        dragDimension(
          dimension,
          gesture.startSheet,
          current,
          this.sheet!.viewTransforms[dimension.viewId],
        ),
      );
    gesture.preview = gesture.previews.find((dimension) => dimension.id === gesture.dimension!.id);
    for (const dimension of gesture.previews) this.patchDimension(dimension);
  }

  private restoreGesture(gesture?: PointerGesture): void {
    for (const dimension of gesture?.dimensions ?? (gesture?.dimension ? [gesture.dimension] : []))
      this.patchDimension(dimension);
    if (gesture?.annotation) {
      if (gesture.creatingAnnotation) this.removeAnnotationPreview(gesture.annotation.id);
      else this.patchAnnotation(gesture.annotation);
    }
  }

  private annotationPoint(event: PointerEvent, freehand = false): Point2 {
    const point = this.sheetPoint(event);
    return !freehand && this.grid.snap && !event.altKey
      ? [snapCoordinate(point[0], this.grid.spacing), snapCoordinate(point[1], this.grid.spacing)]
      : point;
  }
  private previewAnnotation(gesture: PointerGesture, event: PointerEvent): void {
    const original = gesture.annotation!;
    if (gesture.creatingAnnotation) {
      if (original.kind === 'freehand') {
        const samples =
          gesture.pointerType === 'pen' && typeof event.getCoalescedEvents === 'function'
            ? event.getCoalescedEvents()
            : [];
        let preview = gesture.annotationPreview ?? original;
        const minimumDistance = 0.5 / getViewportTransform(this.viewport, this.metrics!).scale;
        for (const sample of [...samples, event]) {
          if (!Number.isFinite(sample.clientX) || !Number.isFinite(sample.clientY)) continue;
          preview = extendAnnotation(preview, this.annotationPoint(sample, true), minimumDistance);
        }
        gesture.annotationPreview = preview;
      } else {
        const point = this.annotationPoint(event);
        gesture.annotationPreview =
          original.kind === 'text'
            ? { ...original, points: [point] }
            : extendAnnotation(gesture.annotationPreview ?? original, point);
      }
    } else {
      const point = this.sheetPoint(event);
      let delta: Point2 = [point[0] - gesture.startSheet[0], point[1] - gesture.startSheet[1]];
      if (this.grid.snap && !event.altKey)
        delta = [
          snapCoordinate(original.points[0][0] + delta[0], this.grid.spacing) -
            original.points[0][0],
          snapCoordinate(original.points[0][1] + delta[1], this.grid.spacing) -
            original.points[0][1],
        ];
      gesture.annotationPreview = translateAnnotation(original, delta);
    }
    this.patchAnnotation(gesture.annotationPreview, true);
  }
  private annotationFits(annotation: DrawingAnnotation): boolean {
    if (!this.sheet) return false;
    const b = annotationBounds(annotation);
    return b.minX >= 0 && b.minY >= 0 && b.maxX <= this.sheet.width && b.maxY <= this.sheet.height;
  }
  private annotationVisible(annotation: DrawingAnnotation): boolean {
    if (annotation.kind === 'text') return Boolean(annotation.text?.trim());
    if (annotation.kind === 'rectangle' || annotation.kind === 'ellipse') {
      const a = annotation.points[0],
        b = annotation.points.at(-1)!;
      return Math.abs(b[0] - a[0]) >= 0.1 && Math.abs(b[1] - a[1]) >= 0.1;
    }
    return annotation.points.some(
      (point) =>
        Math.hypot(point[0] - annotation.points[0][0], point[1] - annotation.points[0][1]) >= 0.1,
    );
  }
  private selectAnnotation(id: string): void {
    if (!this.document) return;
    this.document = {
      ...this.document,
      selectedAnnotation: id,
      selectedDimension: undefined,
      selectedDimensionIds: [],
    };
    this.callbacks.selectAnnotation(id);
    this.patchSelections();
    this.patchAnnotations();
  }
  private annotationElement(id: string): SVGGElement | undefined {
    return [...(this.element?.querySelectorAll<SVGGElement>('[data-annotation-id]') ?? [])].find(
      (group) => group.dataset.annotationId === id,
    );
  }
  private removeAnnotationPreview(id: string): void {
    this.annotationElement(id)?.remove();
  }
  private patchAnnotation(annotation: DrawingAnnotation, preview = false): void {
    if (!this.document) return;
    const markup = renderAnnotation(
      annotation,
      !this.readOnly && (preview || annotation.id === this.document.selectedAnnotation),
      this.document.appearance,
    );
    const existing = this.annotationElement(annotation.id);
    if (existing) existing.outerHTML = markup;
    else
      this.element
        ?.querySelector<SVGGElement>('[data-review-annotations]')
        ?.insertAdjacentHTML('beforeend', markup);
  }
  private patchAnnotations(): void {
    for (const annotation of this.document?.annotations ?? []) this.patchAnnotation(annotation);
  }

  private selectedIds(): Set<string> {
    return new Set(
      this.document?.selectedDimensionIds ??
        (this.document?.selectedDimension ? [this.document.selectedDimension] : []),
    );
  }
  private selectDimension(id: string, additive = false): boolean {
    if (!this.document) return false;
    const selection = new DimensionSelection();
    selection.replace(this.selectedIds(), this.document.selectedDimension);
    selection.select(id, additive);
    this.document = {
      ...this.document,
      selectedDimension: selection.focus,
      selectedDimensionIds: [...selection.ids],
      selectedAnnotation: undefined,
    };
    this.callbacks.select(id, additive);
    this.patchSelections();
    this.patchAnnotations();
    return selection.ids.has(id);
  }

  private marqueeFeedback(): void {
    if (!this.element) return;
    let overlay = this.element.querySelector<SVGSVGElement>('[data-canvas-marquee]');
    const gesture = this.gesture;
    if (!gesture?.marquee || !gesture.moved) {
      overlay?.remove();
      return;
    }
    if (!overlay) {
      overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      overlay.dataset.canvasMarquee = '';
      overlay.setAttribute('aria-hidden', 'true');
      overlay.setAttribute(
        'style',
        'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:4',
      );
      this.element.append(overlay);
    }
    const rect = this.element.getBoundingClientRect();
    const { bounds, crossing } = marqueeRegion(
      [gesture.startClient[0] - rect.left, gesture.startClient[1] - rect.top],
      [gesture.marquee.endClient[0] - rect.left, gesture.marquee.endClient[1] - rect.top],
    );
    const color = crossing ? '#16745e' : '#2860b3';
    overlay.setAttribute('viewBox', `0 0 ${this.element.clientWidth} ${this.element.clientHeight}`);
    overlay.innerHTML = `<rect x="${bounds.minX}" y="${bounds.minY}" width="${bounds.maxX - bounds.minX}" height="${bounds.maxY - bounds.minY}" fill="${color}" fill-opacity=".09" stroke="${color}" stroke-width="1.2"${crossing ? ' stroke-dasharray="6 4"' : ''}/>`;
  }

  private patchDimension(dimension: Dimension): void {
    if (!this.document || !this.sheet) return;
    const group = [
      ...(this.element?.querySelectorAll<SVGGElement>('[data-dimension-id]') ?? []),
    ].find((el) => el.dataset.dimensionId === dimension.id);
    if (group)
      group.outerHTML = renderDimension(
        dimension,
        this.sheet.viewTransforms[dimension.viewId],
        this.document.settings.precision,
        !this.readOnly && this.selectedIds().has(dimension.id),
        this.document.appearance,
      );
  }
  private dimensionFits(dimension: Dimension): boolean {
    if (!this.document || !this.sheet) return false;
    const frame = drawingPage(
      drawingSettingsForInstructions(this.document.settings, this.document.instructions),
    ).content;
    const bounds = dimensionGeometry(
      dimension,
      this.sheet.viewTransforms[dimension.viewId],
      this.document.settings.precision,
    ).bounds;
    return (
      bounds.minX >= frame.minX &&
      bounds.maxX <= frame.maxX &&
      bounds.minY >= frame.minY &&
      bounds.maxY <= frame.maxY
    );
  }
  private patchSelections(): void {
    for (const d of this.document?.dimensions ?? []) this.patchDimension(d);
  }
  private highlightDimension(id?: string): void {
    if (this.hoverDimension === id) return;
    this.hoverDimension = id;
    for (const group of this.element?.querySelectorAll<SVGGElement>('[data-dimension-id]') ?? [])
      group.classList.toggle('dimension-hover', group.dataset.dimensionId === id);
    this.element?.classList.toggle('over-dimension', Boolean(id));
  }
  private scheduleFeedback(): void {
    if (this.frame !== undefined) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = undefined;
      this.feedback();
    });
  }
  private feedback(): void {
    const svg = this.element?.querySelector<SVGSVGElement>('#paper-host > svg');
    if (!svg || !this.sheet || !this.metrics) return;
    let overlay = svg.querySelector<SVGGElement>('[data-canvas-feedback]');
    if (!overlay) {
      overlay = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      overlay.dataset.canvasFeedback = '';
      overlay.setAttribute('pointer-events', 'none');
      svg.append(overlay);
    }
    const px = getViewportTransform(this.viewport, this.metrics).scale;
    const toPaper = (point: Point2, viewId: ViewId): Point2 => {
      const t = this.sheet!.viewTransforms[viewId];
      return [t.x + point[0] * t.scale, t.y - point[1] * t.scale];
    };
    const marker = (point: Point2, viewId: ViewId, persistent: boolean) => {
      const p = toPaper(point, viewId);
      return `<circle cx="${p[0]}" cy="${p[1]}" r="${(persistent ? 5 : 6) / px}" fill="${persistent ? '#16745e' : '#fff'}" fill-opacity=".9" stroke="#16745e" stroke-width="${2 / px}"/>`;
    };
    const edgeHighlight = (edge: ProjectedEdge, viewId: ViewId) =>
      `<path d="${edge.points
        .map((point, i) => {
          const p = toPaper(point, viewId);
          return `${i ? 'L' : 'M'}${p[0]},${p[1]}`;
        })
        .join(' ')}" fill="none" stroke="#16745e" stroke-width="${2.5 / px}"/>`;
    overlay.innerHTML = applyDrawingAppearance(
      (this.hovered?.anchor
        ? marker(this.hovered.anchor.point, this.hovered.viewId, false)
        : this.hovered?.edge
          ? edgeHighlight(this.hovered.edge, this.hovered.viewId)
          : '') +
        (this.pendingPoint ? marker(this.pendingPoint.point, this.pendingPoint.viewId, true) : '') +
        (this.pendingEdge ? edgeHighlight(this.pendingEdge.edge, this.pendingEdge.viewId) : '') +
        (this.draft
          ? `<g opacity=".8">${renderDimension(this.draft, this.sheet.viewTransforms[this.draft.viewId], this.document!.settings.precision, true)}</g>`
          : ''),
      this.document!.appearance,
    );
  }
  private hint(): void {
    const message = this.readOnly
      ? 'Drag to pan · Pinch or wheel to zoom · Fit to show the sheet'
      : isAnnotationTool(this.tool)
        ? this.tool === 'text'
          ? 'Enter text in the annotation panel, then click the sheet to place it'
          : 'Drag on the sheet to draw · Select an annotation to move or edit it · Esc to cancel'
        : this.draft
          ? 'Click to place the dimension · Esc to cancel · Wheel to zoom'
          : this.tool === 'pan'
            ? 'Drag to pan · Wheel to zoom under the cursor · Fit to show the sheet'
            : this.tool === 'box-select'
              ? 'Drag right to contain dimensions · Drag left to cross dimensions · Shift / Ctrl adds to selection'
              : this.tool === 'select'
                ? 'Drag dimensions to move them · Shift / Ctrl-click to select a group · Wheel to zoom · Space + drag to pan'
                : this.tool === 'angle'
                  ? this.pendingEdge
                    ? 'Choose the second straight edge in the same view'
                    : 'Choose two straight edges, then click to place the angle'
                  : this.tool === 'diameter' || this.tool === 'radius'
                    ? 'Choose a circular edge, then click to place the dimension'
                    : this.pendingPoint
                      ? 'Choose the second snap point in the same view'
                      : 'Choose a straight edge or two snap points, then click to place the dimension';
    this.callbacks.hint(
      message +
        (this.grid.snap && this.tool !== 'pan' && this.tool !== 'box-select'
          ? ' · Alt to bypass grid'
          : ''),
    );
  }
}
