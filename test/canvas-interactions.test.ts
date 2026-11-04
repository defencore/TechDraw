import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { DrawingCanvas } from '../src/ui/drawing-canvas';
import { renderDrawing } from '../src/drawing/render';
import { drawingPage } from '../src/drawing/page-layout';
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
      metaKey: false,
      altKey: false,
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

function fixture(dimensions: Dimension[] = [], selectedDimensionIds: string[] = []) {
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
  const initial = renderDrawing(part, dimensions, settings);
  const host = new CanvasHost();
  const added: Dimension[] = [],
    errors: string[] = [],
    hints: string[] = [],
    edited: Dimension[] = [],
    groups: Dimension[][] = [],
    selections: { id?: string; additive?: boolean }[] = [];
  const canvas = new DrawingCanvas({
    select: (id, additive) => selections.push({ id, additive }),
    add: (dimension) => added.push(dimension),
    edit: (dimension) => edited.push(dimension),
    editMany: (dimensions) => groups.push(dimensions),
    zoom() {},
    hint: (hint) => hints.push(hint),
    error: (error) => errors.push(error),
  });
  canvas.attach(host as unknown as HTMLElement);
  const sheet = canvas.setDocument({
    part,
    dimensions,
    settings,
    layout: { scale: initial.scale, viewTransforms: initial.viewTransforms },
    selectedDimension: selectedDimensionIds.at(-1),
    selectedDimensionIds,
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
  return { host, canvas, sheet, client, click, added, errors, hints, edited, groups, selections };
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

const annotation = (id: string, offset: number): Dimension => ({
  id,
  viewId: 'front',
  kind: 'horizontal',
  a: [0, 0],
  b: [100, 0],
  value: 100,
  offset,
  automatic: false,
});

/** The DOM picker is separate from gesture state; these tests select a known annotation. */
function annotationPicker(canvas: DrawingCanvas) {
  let picked: string | undefined;
  const patched: Dimension[] = [];
  const controller = canvas as unknown as {
    dimensionAt(): string | undefined;
    patchDimension(dimension: Dimension): void;
  };
  controller.dimensionAt = () => picked;
  controller.patchDimension = (dimension) => patched.push(dimension);
  return {
    pick: (id?: string) => {
      picked = id;
    },
    patched,
  };
}

test('group selection preserves a plain-clicked member and modifier removal never begins a drag', () => {
  const { canvas, host, selections, edited, groups } = fixture(
    [annotation('one', 10), annotation('two', 16)],
    ['one', 'two'],
  );
  const picker = annotationPicker(canvas);
  picker.pick('one');
  host.dispatch('pointerdown');
  host.dispatch('pointerup');
  assert.deepEqual(selections.at(-1), { id: 'one', additive: false });
  host.dispatch('pointerdown', { shiftKey: true });
  assert.deepEqual(selections.at(-1), { id: 'one', additive: true });
  assert.equal(host.captured.size, 0);
  host.dispatch('pointermove', { clientX: 240, clientY: 220 });
  host.dispatch('pointerup', { clientX: 240, clientY: 220 });
  assert.equal(edited.length + groups.length, 0);
});

test('a snapped group drag commits once, preserves lane spacing and does not jump below the drag threshold', () => {
  const original = [annotation('one', 10), annotation('two', 16)];
  const { canvas, host, sheet, client, groups, edited, errors } = fixture(original, ['one', 'two']);
  canvas.setGrid({ visible: false, snap: true, spacing: 10 });
  const picker = annotationPicker(canvas);
  picker.pick('one');
  const start = client([sheet.viewTransforms.front.x + 50, sheet.viewTransforms.front.y + 10]);
  host.dispatch('pointerdown', { clientX: start[0], clientY: start[1] });
  picker.patched.length = 0;
  host.dispatch('pointermove', { clientX: start[0] + 1, clientY: start[1] + 1 });
  assert.equal(picker.patched.length, 0, 'A click must not snap or mutate any annotation');
  const end = client([sheet.viewTransforms.front.x + 50, sheet.viewTransforms.front.y + 14.2]);
  host.dispatch('pointermove', { clientX: end[0], clientY: end[1] });
  host.dispatch('pointerup', { clientX: end[0], clientY: end[1] });
  assert.equal(errors.length, 0);
  assert.equal(edited.length, 0);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].length, 2);
  near((sheet.viewTransforms.front.y + groups[0][0].offset) % 10, 0);
  near(groups[0][1].offset - groups[0][0].offset, 6);
  assert.deepEqual(original, [annotation('one', 10), annotation('two', 16)]);
  for (const dimension of groups[0]) {
    assert.deepEqual(dimension.a, [0, 0]);
    assert.deepEqual(dimension.b, [100, 0]);
    assert.equal(dimension.value, 100);
  }
});

test('Alt bypasses snap for a complete group and pointer cancellation restores every annotation', () => {
  const original = [annotation('one', 10), annotation('two', 16)];
  const { canvas, host, sheet, client, groups } = fixture(original, ['one', 'two']);
  canvas.setGrid({ visible: true, snap: true, spacing: 10 });
  const picker = annotationPicker(canvas);
  picker.pick('one');
  const start = client([sheet.viewTransforms.front.x + 50, sheet.viewTransforms.front.y + 10]);
  const end = client([sheet.viewTransforms.front.x + 50, sheet.viewTransforms.front.y + 14.2]);
  host.dispatch('pointerdown', { clientX: start[0], clientY: start[1] });
  host.dispatch('pointermove', { clientX: end[0], clientY: end[1], altKey: true });
  host.dispatch('pointerup', { clientX: end[0], clientY: end[1], altKey: true });
  assert.equal(groups.length, 1);
  near(groups[0][0].offset, 14.2);
  near(groups[0][1].offset, 20.2);
  host.dispatch('pointerdown', { clientX: start[0], clientY: start[1] });
  host.dispatch('pointermove', { clientX: end[0], clientY: end[1] });
  host.dispatch('pointercancel');
  assert.equal(groups.length, 1);
  assert.deepEqual(picker.patched.slice(-2), original);
  assert.equal(host.captured.size, 0);
});

test('a group move that puts one member outside the frame restores the entire group', () => {
  const original = [annotation('one', 10), annotation('two', 16)];
  const { canvas, host, sheet, client, groups, edited, errors } = fixture(original, ['one', 'two']);
  const picker = annotationPicker(canvas);
  picker.pick('one');
  const start = client([sheet.viewTransforms.front.x + 50, sheet.viewTransforms.front.y + 10]);
  const end = client([
    sheet.viewTransforms.front.x + 50,
    drawingPage(defaultSettings).content.maxY - 4,
  ]);
  host.dispatch('pointerdown', { clientX: start[0], clientY: start[1] });
  host.dispatch('pointermove', { clientX: end[0], clientY: end[1] });
  host.dispatch('pointerup', { clientX: end[0], clientY: end[1] });
  assert.equal(groups.length + edited.length, 0);
  assert.equal(errors.length, 1);
  assert.deepEqual(picker.patched.slice(-2), original);
});

test('draft placement snaps to paper millimetres and Alt places freely without changing measured points', () => {
  for (const bypass of [false, true]) {
    const { canvas, host, sheet, client, click, added } = fixture();
    canvas.setGrid({ visible: false, snap: true, spacing: 10 });
    canvas.setTool('horizontal');
    const view = sheet.viewTransforms.front;
    click(client([view.x + 50, view.y]));
    const target: Point2 = [view.x + 50, view.y + 24.2],
      position = client(target);
    host.dispatch('pointerdown', { clientX: position[0], clientY: position[1], altKey: bypass });
    host.dispatch('pointerup', { clientX: position[0], clientY: position[1], altKey: bypass });
    assert.equal(added.length, 1);
    if (bypass) near(added[0].offset, 24.2);
    else near((view.y + added[0].offset) % 10, 0);
    assert.deepEqual(added[0].a, [0, 0]);
    assert.deepEqual(added[0].b, [100, 0]);
    assert.equal(added[0].value, 100);
    assert.doesNotMatch(sheet.svg, /workspace-grid/);
  }
});

test('the retained workspace grid follows zoom behind the model and never changes rendered export markup', () => {
  const { canvas, host, sheet } = fixture();
  const source = host.paper.innerHTML;
  type Overlay = {
    dataset: Record<string, string>;
    innerHTML: string;
    attributes: Record<string, string>;
    setAttribute(name: string, value: string): void;
    remove(): void;
  };
  const model = { dataset: { model: '' } } as unknown as Overlay;
  const children: Overlay[] = [model];
  const svg = {
    querySelector(selector: string) {
      if (selector === ':scope > g') return children[0];
      return children.find((child) =>
        selector === '[data-workspace-grid]'
          ? 'workspaceGrid' in child.dataset
          : 'canvasFeedback' in child.dataset,
      );
    },
    insertBefore(node: Overlay, before: Overlay) {
      children.splice(children.indexOf(before), 0, node);
    },
    append(node: Overlay) {
      children.push(node);
    },
  };
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      createElementNS() {
        const node: Overlay = {
          dataset: {},
          innerHTML: '',
          attributes: {},
          setAttribute(name, value) {
            this.attributes[name] = value;
          },
          remove() {
            children.splice(children.indexOf(this), 1);
          },
        };
        return node;
      },
    },
  });
  const query = host.querySelector.bind(host);
  host.querySelector = ((selector: string) =>
    selector === '#paper-host > svg' ? svg : query(selector)) as typeof host.querySelector;
  try {
    canvas.setGrid({ visible: true, snap: true, spacing: 1 });
    const overlay = children[0];
    assert.ok('workspaceGrid' in overlay.dataset);
    assert.equal(children[1], model);
    assert.equal(overlay.attributes['pointer-events'], 'none');
    const beforeZoom = canvas.gridDisplaySpacing!;
    assert.ok(beforeZoom > 1);
    canvas.zoomBy(8);
    assert.equal(children[0], overlay, 'Zoom must retain the grid and model DOM');
    assert.ok(canvas.gridDisplaySpacing! < beforeZoom);
    assert.equal(host.paper.innerHTML, source);
    assert.equal(sheet.svg, source);
    assert.doesNotMatch(sheet.svg, /workspace-grid/);
    canvas.setGrid({ visible: false, snap: true, spacing: 1 });
    assert.equal(canvas.gridDisplaySpacing, undefined);
    assert.ok(!children.includes(overlay));
    assert.equal(children[0], model);
  } finally {
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
    else Reflect.deleteProperty(globalThis, 'document');
  }
});
