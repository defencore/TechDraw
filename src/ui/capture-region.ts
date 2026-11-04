import type { Bounds2, Point2 } from '../model';

/** Capture phase prevents a crop gesture from also moving an annotation or panning. */
export class CaptureRegionController {
  private element?: HTMLElement;
  private overlay?: HTMLDivElement;
  private start?: Point2;
  private pointer?: number;
  private enabled = false;
  constructor(
    private readonly done: (region: Bounds2) => void,
    private readonly cancelled: () => void,
  ) {}
  attach(element: HTMLElement): void {
    if (this.element === element) return;
    if (this.element) throw new Error('The capture surface must remain mounted.');
    this.element = element;
    element.addEventListener('pointerdown', this.down, true);
    element.addEventListener('pointermove', this.move, true);
    element.addEventListener('pointerup', this.up, true);
    element.addEventListener('pointercancel', this.cancelPointer, true);
  }
  startCapture(): void {
    this.cancel(false);
    this.enabled = true;
    this.element?.classList.add('capturing-area');
  }
  cancel(notify = true): void {
    const enabled = this.enabled;
    this.enabled = false;
    this.start = undefined;
    this.pointer = undefined;
    this.overlay?.remove();
    this.overlay = undefined;
    this.element?.classList.remove('capturing-area');
    if (enabled && notify) this.cancelled();
  }
  get active(): boolean {
    return this.enabled;
  }
  private stop(event: PointerEvent): void {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
  private point(event: PointerEvent): Point2 {
    const rect = this.element!.getBoundingClientRect();
    return [
      Math.max(0, Math.min(rect.width, event.clientX - rect.left)),
      Math.max(0, Math.min(rect.height, event.clientY - rect.top)),
    ];
  }
  private down = (event: PointerEvent): void => {
    if (!this.enabled) return;
    this.stop(event);
    if (this.pointer !== undefined) return;
    this.pointer = event.pointerId;
    this.start = this.point(event);
    this.element!.setPointerCapture(event.pointerId);
    this.overlay = document.createElement('div');
    this.overlay.className = 'capture-region-overlay';
    this.element!.append(this.overlay);
    this.draw(this.start);
  };
  private move = (event: PointerEvent): void => {
    if (!this.enabled) return;
    this.stop(event);
    if (event.pointerId === this.pointer && this.start) this.draw(this.point(event));
  };
  private draw(end: Point2): void {
    const a = this.start!,
      style = this.overlay!.style;
    style.left = `${Math.min(a[0], end[0])}px`;
    style.top = `${Math.min(a[1], end[1])}px`;
    style.width = `${Math.abs(a[0] - end[0])}px`;
    style.height = `${Math.abs(a[1] - end[1])}px`;
  }
  private up = (event: PointerEvent): void => {
    if (!this.enabled) return;
    this.stop(event);
    if (event.pointerId !== this.pointer || !this.start) return;
    const end = this.point(event),
      start = this.start;
    if (Math.hypot(end[0] - start[0], end[1] - start[1]) < 8) {
      this.cancel();
      return;
    }
    const svg = this.element!.querySelector<SVGSVGElement>('#paper-host > svg');
    const matrix = svg?.getScreenCTM();
    if (!matrix) {
      this.cancel();
      return;
    }
    const rect = this.element!.getBoundingClientRect();
    const first = new DOMPoint(start[0] + rect.left, start[1] + rect.top).matrixTransform(
      matrix.inverse(),
    );
    const last = new DOMPoint(end[0] + rect.left, end[1] + rect.top).matrixTransform(
      matrix.inverse(),
    );
    this.cancel(false);
    this.done({
      minX: Math.min(first.x, last.x),
      minY: Math.min(first.y, last.y),
      maxX: Math.max(first.x, last.x),
      maxY: Math.max(first.y, last.y),
    });
  };
  private cancelPointer = (event: PointerEvent): void => {
    if (this.enabled) {
      this.stop(event);
      this.cancel();
    }
  };
}
