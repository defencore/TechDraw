import type {
  Dimension,
  DimensionKind,
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
import {
  fitViewport,
  getViewportTransform,
  panViewport,
  resizeViewport,
  toSheet,
  zoomAt,
  type ViewportMetrics,
  type ViewportState,
} from './viewport';

export type CanvasTool = 'select' | 'pan' | DimensionKind;
export interface CanvasDocument {
  part: Part;
  dimensions: Dimension[];
  settings: DrawingSettings;
  layout: DrawingLayout;
  selectedDimension?: string;
}
interface CanvasCallbacks {
  select(id?: string): void;
  add(dimension: Dimension): void;
  edit(dimension: Dimension): void;
  zoom(value: number): void;
  hint(message: string): void;
  error(message: string): void;
}
interface PointerGesture {
  pointerId: number;
  startClient: Point2;
  startSheet: Point2;
  moved: boolean;
  dimension?: Dimension;
  preview?: Dimension;
  viewport?: ViewportState;
  click?: boolean;
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
      if (this.enabled && this.document && this.tool === 'select' && !this.dimensionAt(event)) {
        event.preventDefault();
        this.setZoom(this.viewport.zoom * 2, this.local(event));
      }
    });
    element.addEventListener('contextmenu', (event) => {
      if (this.space || this.tool === 'pan') event.preventDefault();
    });
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
      document.selectedDimension,
      document.layout,
    );
    const host = this.element?.querySelector<HTMLElement>('#paper-host');
    if (host) {
      host.className = 'paper-host';
      host.innerHTML = this.sheet.svg;
      this.element!.classList.add('has-sheet');
      this.applyViewport();
      this.feedback();
    }
    this.hint();
    return this.sheet;
  }

  setEnabled(value: boolean): void {
    this.enabled = value;
    if (!value) this.cancel();
  }
  setTool(tool: CanvasTool): void {
    if (this.tool !== tool) this.cancel();
    this.tool = tool;
    this.element?.classList.toggle('measuring', !['select', 'pan'].includes(tool));
    this.element?.classList.toggle('pan-tool', tool === 'pan');
    this.hint();
  }
  setPanKey(value: boolean): void {
    this.space = value;
    this.element?.classList.toggle('pan-key', value);
  }
  get zoom(): number {
    return this.viewport.zoom;
  }
  fit(): void {
    if (this.gesture?.dimension || this.pinch) return;
    this.viewport = fitViewport();
    this.applyViewport(false);
    this.rebasePan();
  }
  zoomBy(factor: number): void {
    this.setZoom(this.viewport.zoom * factor);
  }
  setZoom(value: number, anchor?: Point2): void {
    if (!this.metrics || this.gesture?.dimension || this.pinch) return;
    this.viewport = zoomAt(
      this.viewport,
      this.metrics,
      anchor ?? [this.metrics.width / 2, this.metrics.height / 2],
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
    if (gesture?.dimension) this.patchDimension(gesture.dimension);
    if (gesture && this.element?.hasPointerCapture(gesture.pointerId))
      this.element.releasePointerCapture(gesture.pointerId);
    this.element?.classList.remove('panning', 'dimension-dragging');
    this.feedback();
    this.hint();
  }

  private applyViewport(resizing = true): void {
    if (!this.element || !this.sheet) return;
    const metrics: ViewportMetrics = {
      width: this.element.clientWidth,
      height: this.element.clientHeight,
      paperWidth: this.sheet.width,
      paperHeight: this.sheet.height,
      padding: 24,
    };
    const resized = Boolean(
      resizing &&
      this.metrics &&
      (this.metrics.width !== metrics.width || this.metrics.height !== metrics.height),
    );
    if (resized && this.metrics) {
      if (this.gesture?.dimension || this.pinch) this.cancel();
      this.viewport = resizeViewport(this.viewport, this.metrics, metrics);
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
    this.feedback();
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
    if (!this.enabled || !this.document || !this.metrics || !this.element || event.button > 1)
      return;
    this.pointerClient = [event.clientX, event.clientY];
    this.element.focus({ preventScroll: true });
    if (event.pointerType === 'touch') {
      this.touches.set(event.pointerId, this.local(event));
      if (this.touches.size === 2) {
        if (this.gesture?.dimension) this.patchDimension(this.gesture.dimension);
        this.gesture = undefined;
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
    const id =
      this.tool === 'select' && !this.space && event.button === 0
        ? this.dimensionAt(event)
        : undefined;
    const dimension = id ? this.document.dimensions.find((d) => d.id === id) : undefined;
    const pan =
      this.space ||
      this.tool === 'pan' ||
      event.button === 1 ||
      (this.tool === 'select' && !dimension);
    this.gesture = {
      pointerId: event.pointerId,
      startClient: [event.clientX, event.clientY],
      startSheet: this.sheetPoint(event),
      moved: false,
      ...(dimension
        ? { dimension: structuredClone(dimension) }
        : pan
          ? { viewport: structuredClone(this.viewport) }
          : { click: true }),
    };
    this.element.setPointerCapture(event.pointerId);
    event.preventDefault();
    if (dimension) {
      this.document = { ...this.document, selectedDimension: dimension.id };
      this.callbacks.select(dimension.id);
      this.patchSelections();
      this.element.classList.add('dimension-dragging');
    } else if (pan) this.element.classList.add('panning');
  };

  private pointerMove = (event: PointerEvent): void => {
    if (!this.enabled || !this.document || !this.metrics) return;
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
      if (!gesture.moved && Math.hypot(dx, dy) < 3) return;
      gesture.moved = true;
      if (gesture.viewport) {
        this.viewport = panViewport(gesture.viewport, [dx, dy]);
        this.applyViewport(false);
      } else if (gesture.dimension && this.sheet) {
        gesture.preview = dragDimension(
          gesture.dimension,
          gesture.startSheet,
          this.sheetPoint(event),
          this.sheet.viewTransforms[gesture.dimension.viewId],
        );
        this.patchDimension(gesture.preview);
      }
      return;
    }
    if (this.draft && this.sheet) {
      this.draft = positionDimension(
        this.draft,
        this.sheetPoint(event),
        this.sheet.viewTransforms[this.draft.viewId],
        this.document.settings.precision,
      );
      this.scheduleFeedback();
      return;
    }
    if (!['select', 'pan'].includes(this.tool)) {
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
    this.gesture = undefined;
    if (this.element?.hasPointerCapture(event.pointerId))
      this.element.releasePointerCapture(event.pointerId);
    this.element?.classList.remove('panning', 'dimension-dragging');
    if (gesture.dimension && gesture.moved && gesture.preview) {
      if (this.dimensionFits(gesture.preview)) this.callbacks.edit(gesture.preview);
      else {
        this.patchDimension(gesture.dimension);
        this.callbacks.error(
          'Keep the dimension inside the drawing frame. Pan or use Fit to choose another position.',
        );
      }
    } else if (gesture.click && !gesture.moved) this.chooseGeometry(event);
    else if (
      gesture.viewport &&
      !gesture.moved &&
      this.tool === 'select' &&
      !this.space &&
      event.button === 0
    ) {
      this.document = { ...this.document!, selectedDimension: undefined };
      this.callbacks.select();
      this.patchSelections();
    }
  };
  private pointerCancel = (event: PointerEvent): void => {
    this.touches.delete(event.pointerId);
    if (this.gesture?.pointerId !== event.pointerId && !this.pinch) return;
    if (this.gesture?.dimension) this.patchDimension(this.gesture.dimension);
    this.gesture = undefined;
    this.pinch = undefined;
    this.element?.classList.remove('panning', 'dimension-dragging');
  };
  private wheel = (event: WheelEvent): void => {
    if (!this.enabled || !this.document || !this.metrics || this.gesture?.dimension) return;
    event.preventDefault();
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

  private chooseGeometry(event: PointerEvent): void {
    if (!this.document || !this.sheet) return;
    if (this.draft) {
      const dimension = positionDimension(
        this.draft,
        this.sheetPoint(event),
        this.sheet.viewTransforms[this.draft.viewId],
        this.document.settings.precision,
      );
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
        this.draft = positionDimension(
          dimension,
          this.sheetPoint(event),
          this.sheet.viewTransforms[dimension.viewId],
          this.document.settings.precision,
        );
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
        dimension.id === this.document.selectedDimension,
      );
  }
  private dimensionFits(dimension: Dimension): boolean {
    if (!this.document) return false;
    const sheet = renderDrawing(
      this.document.part,
      [dimension],
      this.document.settings,
      undefined,
      this.document.layout,
    );
    return !sheet.warnings.some(
      (warning) =>
        warning.startsWith('Dimensions exceed') || warning.startsWith('The selected scale'),
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
    overlay.innerHTML =
      (this.hovered?.anchor
        ? marker(this.hovered.anchor.point, this.hovered.viewId, false)
        : this.hovered?.edge
          ? edgeHighlight(this.hovered.edge, this.hovered.viewId)
          : '') +
      (this.pendingPoint ? marker(this.pendingPoint.point, this.pendingPoint.viewId, true) : '') +
      (this.pendingEdge ? edgeHighlight(this.pendingEdge.edge, this.pendingEdge.viewId) : '') +
      (this.draft
        ? `<g opacity=".8">${renderDimension(this.draft, this.sheet.viewTransforms[this.draft.viewId], this.document!.settings.precision, true)}</g>`
        : '');
  }
  private hint(): void {
    this.callbacks.hint(
      this.draft
        ? 'Click to place the dimension · Esc to cancel · Wheel to zoom'
        : this.tool === 'pan'
          ? 'Drag to pan · Wheel to zoom under the cursor · Fit to show the sheet'
          : this.tool === 'select'
            ? 'Drag a dimension to move it · Wheel to zoom · Drag empty space or Space + drag to pan'
            : this.tool === 'angle'
              ? this.pendingEdge
                ? 'Choose the second straight edge in the same view'
                : 'Choose two straight edges, then click to place the angle'
              : this.tool === 'diameter' || this.tool === 'radius'
                ? 'Choose a circular edge, then click to place the dimension'
                : this.pendingPoint
                  ? 'Choose the second snap point in the same view'
                  : 'Choose a straight edge or two snap points, then click to place the dimension',
    );
  }
}
