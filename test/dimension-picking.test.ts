import test from 'node:test';
import assert from 'node:assert/strict';
import type { Dimension, Point2 } from '../src/model';
import { renderDimension } from '../src/drawing/render';
import {
  containsPaddedRectangle,
  distanceToSegment,
  pickDimension,
} from '../src/ui/dimension-picking';

const matrix = (scale = 1, x = 0, y = 0) =>
  ({ a: scale, b: 0, c: 0, d: scale, e: x, f: y }) as DOMMatrix;
function stroke(a: Point2, b: Point2, transform = matrix()): SVGGraphicsElement {
  const coordinate = (value: number) => ({ baseVal: { value } });
  return {
    tagName: 'line',
    x1: coordinate(a[0]),
    y1: coordinate(a[1]),
    x2: coordinate(b[0]),
    y2: coordinate(b[1]),
    getScreenCTM: () => transform,
  } as unknown as SVGGraphicsElement;
}
function label(left: number, top: number, width: number, height: number): SVGGraphicsElement {
  return {
    getBoundingClientRect: () => ({
      left,
      top,
      right: left + width,
      bottom: top + height,
      width,
      height,
    }),
  } as unknown as SVGGraphicsElement;
}
function group(
  id: string,
  lines: SVGGraphicsElement[] = [],
  labels: SVGGraphicsElement[] = [],
): SVGGElement {
  return Object.freeze({
    getAttribute: () => id,
    querySelectorAll: (selector: string) => (selector.includes('"label"') ? labels : lines),
  }) as unknown as SVGGElement;
}
const canvas = (...groups: SVGGElement[]) =>
  Object.freeze({ querySelectorAll: () => groups }) as unknown as SVGSVGElement;

test('stroke tolerance remains eight screen pixels at different zoom levels', () => {
  for (const scale of [0.25, 1, 4]) {
    const svg = canvas(group('dimension', [stroke([0, 0], [100, 0], matrix(scale, 30, 40))]));
    assert.equal(pickDimension(svg, [30 + 50 * scale, 47.9]), 'dimension');
    assert.equal(pickDimension(svg, [30 + 50 * scale, 48.1]), undefined);
  }
});

test('transformed diagonal and rotated strokes use the screen-space geometry', () => {
  const rotated = { a: 0, b: 2, c: -2, d: 0, e: 300, f: 20 } as DOMMatrix;
  const svg = canvas(group('rotated', [stroke([0, 0], [100, 0], rotated)]));
  assert.equal(pickDimension(svg, [307, 100]), 'rotated');
  assert.equal(pickDimension(svg, [309, 100]), undefined);
});

test('labels win over nearby strokes and receive a four-pixel padding', () => {
  const svg = canvas(
    group('line', [stroke([0, 5], [100, 5])]),
    group('label', [], [label(40, 1, 20, 8)]),
  );
  assert.equal(pickDimension(svg, [50, 5]), 'label');
  assert.equal(pickDimension(svg, [36.1, 5]), 'label');
  const onlyLabel = canvas(group('label', [], [label(40, 1, 20, 8)]));
  assert.equal(pickDimension(onlyLabel, [35.9, 5]), undefined);
});

test('nearest strokes win, with topmost drawing order breaking exact ties', () => {
  const svg = canvas(
    group('upper', [stroke([0, 0], [100, 0])]),
    group('lower', [stroke([0, 10], [100, 10])]),
  );
  assert.equal(pickDimension(svg, [50, 7]), 'lower');
  assert.equal(pickDimension(svg, [50, 3]), 'upper');
  assert.equal(pickDimension(svg, [50, 5]), 'lower');
});

test('angular paths are sampled in screen coordinates using at most 64 points', () => {
  let samples = 0;
  const radius = 100,
    scale = 4;
  const arc = {
    tagName: 'path',
    getScreenCTM: () => matrix(scale, 20, 30),
    getTotalLength: () => (radius * Math.PI) / 2,
    getPointAtLength: (length: number) => {
      samples++;
      return { x: radius * Math.cos(length / radius), y: radius * Math.sin(length / radius) };
    },
  } as unknown as SVGGraphicsElement;
  const svg = canvas(group('angle', [arc]));
  const at = Math.SQRT1_2 * radius * scale;
  assert.equal(
    pickDimension(svg, [20 + at + 7 * Math.SQRT1_2, 30 + at + 7 * Math.SQRT1_2]),
    'angle',
  );
  assert.ok(samples <= 64);
  samples = 0;
  assert.equal(
    pickDimension(svg, [20 + at + 9.5 * Math.SQRT1_2, 30 + at + 9.5 * Math.SQRT1_2]),
    undefined,
  );
  assert.ok(samples <= 64);
});

test('hidden or detached browser geometry cannot break selection', () => {
  const hidden = { tagName: 'line', getScreenCTM: () => null } as unknown as SVGGraphicsElement;
  const detached = {
    tagName: 'path',
    getScreenCTM: () => matrix(),
    getTotalLength: () => {
      throw new Error('Detached path');
    },
  } as unknown as SVGGraphicsElement;
  assert.equal(
    pickDimension(canvas(group('hidden', [hidden, detached], [label(0, 0, 0, 0)])), [0, 0]),
    undefined,
  );
  assert.equal(
    pickDimension(canvas(group('valid', [stroke([0, 0], [10, 0])])), [NaN, 0]),
    undefined,
  );
});

test('segment and rectangle helpers handle endpoint caps and degenerate spans', () => {
  assert.equal(distanceToSegment([3, 4], [0, 0], [0, 0]), 5);
  assert.equal(distanceToSegment([15, 0], [0, 0], [10, 0]), 5);
  assert.equal(distanceToSegment([5, 7], [0, 0], [10, 0]), 7);
  assert.equal(
    containsPaddedRectangle([6, 10], { left: 10, top: 10, right: 20, bottom: 20 }, 4),
    true,
  );
  assert.equal(
    containsPaddedRectangle([5.9, 10], { left: 10, top: 10, right: 20, bottom: 20 }, 4),
    false,
  );
});

test('rendered grip tags identify labels and dimension lines while excluding extension lines', () => {
  const dimension: Dimension = {
    id: 'width',
    viewId: 'front',
    kind: 'horizontal',
    a: [0, 0],
    b: [30, 0],
    value: 30,
    offset: 10,
    automatic: false,
  };
  const svg = renderDimension(dimension, { x: 0, y: 50, scale: 1 }, 2, false);
  const lines = [...svg.matchAll(/<line[^>]*\/>/g)].map((match) => match[0]);
  assert.equal(lines.length, 3);
  assert.doesNotMatch(lines[0], /data-dimension-grip/);
  assert.doesNotMatch(lines[1], /data-dimension-grip/);
  assert.match(lines[2], /data-dimension-grip="line"/);
  assert.match(svg, /class="dimension-label" data-dimension-grip="label"/);
  assert.doesNotMatch(svg, /marker-start|marker-end|paint-order/);
});
