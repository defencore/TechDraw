import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { DrawingCanvas } from '../src/ui/drawing-canvas';
import { renderDrawing } from '../src/drawing/render';
import { defaultSettings } from '../src/state';
import type { Dimension, Part, Point2, Projection } from '../src/model';

const oldResizeObserver = globalThis.ResizeObserver;
const oldAnimationFrame = globalThis.requestAnimationFrame;
const frames: FrameRequestCallback[] = [];
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
globalThis.requestAnimationFrame = (callback) => frames.push(callback);
after(() => {
  globalThis.ResizeObserver = oldResizeObserver;
  globalThis.requestAnimationFrame = oldAnimationFrame;
});

/** A bounded host exercises registered event handlers without a DOM or CAD kernel. */
class CanvasHost {
  clientWidth = 800;
  clientHeight = 600;
  readonly classes = new Set<string>();
  readonly captured = new Set<number>();
  readonly listeners = new Map<string, EventListenerOrEventListenerObject[]>();
  readonly paper = {
    className: '',
    innerHTML: '',
    style: {} as Record<string, string>,
    replaceChildren() {
      this.innerHTML = '';
    },
  };
  readonly classList = {
    add: (...values: string[]) => values.forEach((value) => this.classes.add(value)),
    remove: (...values: string[]) => values.forEach((value) => this.classes.delete(value)),
    toggle: (value: string, force?: boolean) => {
      const enabled = force ?? !this.classes.has(value);
      if (enabled) this.classes.add(value);
      else this.classes.delete(value);
      return enabled;
    },
  };
  addEventListener(type: string, callback: EventListenerOrEventListenerObject) {
    this.listeners.set(type, [...(this.listeners.get(type) || []), callback]);
  }
  querySelector(selector: string) {
    return selector === '#paper-host' ? this.paper : undefined;
  }
  querySelectorAll() {
    return [];
  }
  getBoundingClientRect() {
    return { left: 100, top: 50 };
  }
  focus() {}
  setPointerCapture(id: number) {
    this.captured.add(id);
  }
  hasPointerCapture(id: number) {
    return this.captured.has(id);
  }
  releasePointerCapture(id: number) {
    if (this.captured.delete(id)) this.dispatch('lostpointercapture', { pointerId: id });
  }
  dispatch(type: string, properties: Record<string, unknown> = {}) {
    const event = Object.assign(new Event(type, { cancelable: true }), {
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
      clientX: 200,
      clientY: 200,
      deltaMode: 0,
      deltaX: 0,
      deltaY: 0,
      ctrlKey: false,
      shiftKey: false,
      ...properties,
    });
    for (const listener of this.listeners.get(type) || []) {
      if (typeof listener === 'function') listener(event);
      else listener.handleEvent(event);
    }
    if (type === 'pointerup' || type === 'pointercancel')
      this.releasePointerCapture(event.pointerId);
    while (frames.length) frames.shift()!(0);
  }
  transform() {
    const match = this.paper.style.transform.match(
      /translate\(([^p]+)px, ([^p]+)px\) scale\(([^)]+)\)/,
    );
    assert.ok(match, 'The controller must publish a viewport transform');
    return { x: Number(match[1]), y: Number(match[2]), scale: Number(match[3]) };
  }
}

function fixture() {
  const projections: Projection[] = (['front', 'top', 'right', 'iso'] as const).map((id) => ({
    id,
    name: id,
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 20 },
    edges: [
      {
        id: `${id}-edge`,
        kind: 'line',
        hidden: false,
        points: [
          [0, 0],
          [100, 0],
        ],
        sourcePoints: [
          [0, 0, 0],
          [100, 0, 0],
        ],
        length: 100,
      },
    ],
    anchors: [
      { id: `${id}-start`, point: [0, 0], source: [0, 0, 0] },
      { id: `${id}-end`, point: [100, 0], source: [100, 0, 0] },
    ],
  }));
  const part: Part = {
    id: 'test',
    name: 'Test',
    sourceName: 'test.step',
    path: ['Test'],
    unit: 'mm',
    bounds: { min: [0, 0, 0], max: [100, 20, 20] },
    views: projections,
    warnings: [],
  };
  const settings = { ...defaultSettings, scale: 1 };
  const initial = renderDrawing(part, [], settings);
  const host = new CanvasHost();
  const added: Dimension[] = [],
    errors: string[] = [],
    hints: string[] = [];
  const canvas = new DrawingCanvas({
    select() {},
    add: (dimension) => added.push(dimension),
    edit() {},
    zoom() {},
    hint: (hint) => hints.push(hint),
    error: (error) => errors.push(error),
  });
  canvas.attach(host as unknown as HTMLElement);
  const sheet = canvas.setDocument({
    part,
    dimensions: [],
    settings,
    layout: { scale: initial.scale, viewTransforms: initial.viewTransforms },
  })!;
  const client = (sheetPoint: Point2): Point2 => {
    const t = host.transform(),
      rect = host.getBoundingClientRect();
    return [rect.left + t.x + sheetPoint[0] * t.scale, rect.top + t.y + sheetPoint[1] * t.scale];
  };
  const click = (point: Point2) => {
    const [clientX, clientY] = point;
    host.dispatch('pointerdown', { clientX, clientY });
    host.dispatch('pointerup', { clientX, clientY });
  };
  return { host, canvas, sheet, client, click, added, errors, hints };
}
const near = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} must equal ${expected}`);

test('wheel zoom and Fit remain active on the next captured pan movement', () => {
  const { host, canvas } = fixture();
  canvas.setTool('pan');
  host.dispatch('pointerdown', { button: 1, clientX: 200, clientY: 200 });
  host.dispatch('pointermove', { clientX: 220, clientY: 200 });
  host.dispatch('wheel', { deltaY: -100, clientX: 220, clientY: 200 });
  const zoom = canvas.zoom,
    afterWheel = host.transform();
  assert.ok(zoom > 1);
  host.dispatch('pointermove', { clientX: 230, clientY: 200 });
  near(canvas.zoom, zoom);
  near(host.transform().x, afterWheel.x + 10);
  canvas.fit();
  const fitted = host.transform();
  near(canvas.zoom, 1);
  host.dispatch('pointermove', { clientX: 240, clientY: 200 });
  near(canvas.zoom, 1);
  near(host.transform().x, fitted.x + 10);
  host.dispatch('pointerup', { clientX: 240, clientY: 200 });
  assert.equal(host.captured.size, 0);
});

test('a remaining touch continues panning after pinch zoom without losing its zoom', () => {
  const { host, canvas } = fixture();
  canvas.setTool('pan');
  host.dispatch('pointerdown', { pointerId: 10, pointerType: 'touch', clientX: 250, clientY: 200 });
  host.dispatch('pointerdown', { pointerId: 11, pointerType: 'touch', clientX: 350, clientY: 200 });
  host.dispatch('pointermove', { pointerId: 11, pointerType: 'touch', clientX: 400, clientY: 200 });
  const zoom = canvas.zoom;
  assert.ok(zoom > 1);
  host.dispatch('pointerup', { pointerId: 11, pointerType: 'touch', clientX: 400, clientY: 200 });
  const afterLift = host.transform();
  host.dispatch('pointermove', { pointerId: 10, pointerType: 'touch', clientX: 270, clientY: 210 });
  near(canvas.zoom, zoom);
  near(host.transform().x, afterLift.x + 20);
  near(host.transform().y, afterLift.y + 10);
  host.dispatch('pointerup', { pointerId: 10, pointerType: 'touch', clientX: 270, clientY: 210 });
  assert.equal(host.captured.size, 0);
});

test('pointer capture release preserves a two-point draft until its placement click', () => {
  const { host, canvas, sheet, client, click, added, errors, hints } = fixture();
  canvas.setTool('horizontal');
  const view = sheet.viewTransforms.front;
  click(client([view.x, view.y]));
  assert.match(hints.at(-1)!, /second snap point/);
  click(client([view.x + 100 * view.scale, view.y]));
  assert.match(hints.at(-1)!, /Click to place/);
  assert.equal(added.length, 0);
  const position = client([view.x + 50 * view.scale, view.y + 25]);
  host.dispatch('pointermove', { clientX: position[0], clientY: position[1] });
  click(position);
  assert.equal(errors.length, 0);
  assert.equal(added.length, 1);
  assert.equal(added[0].value, 100);
  near(added[0].offset, 25);
  assert.deepEqual(added[0].a, [0, 0]);
  assert.deepEqual(added[0].b, [100, 0]);
  assert.equal(host.captured.size, 0);
});

test('cancelled geometry clicks and cancelled drafts cannot accidentally add dimensions', () => {
  const { host, canvas, sheet, client, click, added, hints } = fixture();
  canvas.setTool('horizontal');
  const view = sheet.viewTransforms.front,
    edge = client([view.x + 50 * view.scale, view.y]);
  host.dispatch('pointerdown', { clientX: edge[0], clientY: edge[1] });
  host.dispatch('pointercancel');
  host.dispatch('pointerup', { clientX: edge[0], clientY: edge[1] });
  assert.doesNotMatch(hints.at(-1)!, /Click to place/);
  click(edge);
  assert.match(hints.at(-1)!, /Click to place/);
  canvas.cancel();
  assert.doesNotMatch(hints.at(-1)!, /Click to place/);
  click(client([view.x + 50 * view.scale, view.y + 25]));
  assert.equal(added.length, 0);
  assert.equal(host.captured.size, 0);
});
