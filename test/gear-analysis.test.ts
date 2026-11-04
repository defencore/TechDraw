import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { before, test } from 'node:test';
import initOpenCascade from 'replicad-opencascadejs';
import { exportSTEP, makeBaseBox, makeCylinder, setOC, Sketcher, type Shape3D } from 'replicad';
import { analyzeGearShape } from '../src/cad/gear-analysis';
import { importStep } from '../src/cad/engine';
import type { Point2, Point3 } from '../src/model';

before(async () => {
  const wasm = await fs.readFile(
    new URL('../node_modules/replicad-opencascadejs/dist/replicad_single.wasm', import.meta.url),
  );
  setOC(await initOpenCascade({ wasmBinary: wasm, print: () => {}, printErr: () => {} }));
});

const near = (actual: number, expected: number, tolerance = 1e-6) =>
  assert.ok(
    Math.abs(actual - expected) < tolerance,
    `${actual} must be ${expected} within ${tolerance}`,
  );
const pointNear = (actual: Point3, expected: Point3) =>
  actual.forEach((v, i) => near(v, expected[i]));

/** Original synthetic radial profile: exact circular tips/roots, without a claimed involute. */
function gearShape(
  teeth = 12,
  { hub = true, bore = true, pin = true, irregular = false } = {},
): Shape3D {
  const polar = (radius: number, angle: number): Point2 => [
    radius * Math.cos(angle),
    radius * Math.sin(angle),
  ];
  const step = (2 * Math.PI) / teeth;
  const sketcher = new Sketcher('XY').movePointerTo(polar(8, -step * 0.4));
  for (let i = 0; i < teeth; i++) {
    const phi = i * step;
    const radius = irregular && i === 0 ? 10.2 : 10;
    sketcher.lineTo(polar(radius, phi - step * 0.2));
    sketcher.threePointsArcTo(polar(radius, phi + step * 0.2), polar(radius, phi));
    sketcher.lineTo(polar(8, phi + step * 0.4));
    sketcher.threePointsArcTo(polar(8, phi + step * 0.6), polar(8, phi + step * 0.5));
  }
  let shape: Shape3D = sketcher.close().extrude(5);
  const apply = (tool: Shape3D, operation: 'fuse' | 'cut') => {
    const old = shape;
    try {
      shape = old[operation](tool);
    } finally {
      old.delete();
      tool.delete();
    }
  };
  if (hub) apply(makeCylinder(4, 3, [0, 0, -3]), 'fuse');
  if (bore) apply(makeCylinder(1.5, 10, [0, 0, -4]), 'cut');
  if (pin && hub) apply(makeCylinder(0.4, 12, [-6, 0, -1.5], [1, 0, 0]), 'cut');
  return shape;
}

test('BRep repetition measures teeth, tip/root radii, centered face width, hub, bore and radial pin hole', () => {
  const shape = gearShape();
  try {
    const g = analyzeGearShape(shape);
    assert.ok(g);
    assert.equal(g.toothCount, 12);
    near(g.outsideDiameter, 20);
    near(g.rootDiameter, 16);
    near(g.faceWidth, 5);
    near(g.overallLength, 8);
    near(g.hubDiameter!, 8);
    near(g.boreDiameter!, 3);
    pointNear(g.axis.origin, [0, 0, 2.5]);
    pointNear(g.axis.direction, [0, 0, 1]);
    pointNear(g.toothDatumDirection!, [1, 0, 0]);
    assert.equal(g.pinHoles?.length, 1);
    near(g.pinHoles![0].diameter, 0.8);
    pointNear(g.pinHoles![0].axis.origin, [0, 0, -1.5]);
    pointNear(g.pinHoles![0].axis.direction, [1, 0, 0]);
    assert.equal(g.profile, 'unverified');
    assert.equal(g.evidence, 'repeated-tip-root-arcs');
    assert.ok(!Object.hasOwn(g, 'module') && !Object.hasOwn(g, 'pressureAngle'));
    const box = shape.boundingBox;
    try {
      near(box.bounds[0][2], -3);
      near(box.bounds[1][2], 5);
    } finally {
      box.delete();
    }
  } finally {
    shape.delete();
  }
});

test('detection preserves assembly placement and does not confuse the radial hole axis with the gear axis', () => {
  const shape = gearShape(16)
    .rotate(90, [0, 0, 0], [0, 1, 0])
    .rotate(27, [0, 0, 0], [0, 0, 1])
    .translate([31, -12, 7]);
  try {
    const g = analyzeGearShape(shape);
    assert.ok(g);
    const angle = (27 * Math.PI) / 180;
    pointNear(g.axis.direction, [Math.cos(angle), Math.sin(angle), 0]);
    pointNear(g.axis.origin, [31 + 2.5 * Math.cos(angle), -12 + 2.5 * Math.sin(angle), 7]);
    near(g.faceWidth, 5);
    near(g.overallLength, 8);
    near(g.outsideDiameter, 20);
    assert.equal(g.toothCount, 16);
    assert.equal(g.pinHoles?.length, 1);
    near(
      g.pinHoles![0].axis.direction.reduce((sum, v, i) => sum + v * g.axis.direction[i], 0),
      0,
    );
  } finally {
    shape.delete();
  }
});

test('solid radial profiles do not receive an invented bore, hub or pin hole', () => {
  const shape = gearShape(10, { hub: false, bore: false, pin: false });
  try {
    const g = analyzeGearShape(shape);
    assert.ok(g);
    assert.equal(g.toothCount, 10);
    near(g.overallLength, 5);
    assert.equal(g.boreDiameter, undefined);
    assert.equal(g.hubDiameter, undefined);
    assert.equal(g.pinHoles, undefined);
  } finally {
    shape.delete();
  }
});

test('the tooth datum names a real rotated tip center and resolves symmetric choices deterministically', () => {
  const shape = gearShape(24).rotate(7.5, [0, 0, 0], [0, 0, 1]);
  try {
    const g = analyzeGearShape(shape);
    assert.ok(g);
    const angle = (7.5 * Math.PI) / 180;
    pointNear(g.toothDatumDirection!, [Math.cos(angle), Math.sin(angle), 0]);
    near(Math.hypot(...g.toothDatumDirection!), 1);
    near(
      g.toothDatumDirection!.reduce((sum, value, i) => sum + value * g.axis.direction[i], 0),
      0,
    );
  } finally {
    shape.delete();
  }
});

test('a stepped bore and a blind radial drilling are not mislabeled as through shaft/pin holes', () => {
  const original = gearShape(12, { pin: false });
  const counterbore = makeCylinder(2.5, 2, [0, 0, 3]);
  const blind = makeCylinder(0.4, 2, [-5, 0, -1.5], [1, 0, 0]);
  const stepped = original.cut(counterbore);
  const shape = stepped.cut(blind);
  try {
    const g = analyzeGearShape(shape);
    assert.ok(g);
    assert.equal(g.boreDiameter, undefined);
    assert.equal(g.pinHoles, undefined);
  } finally {
    original.delete();
    counterbore.delete();
    blind.delete();
    stepped.delete();
    shape.delete();
  }
});

test('cylinders, boxes and irregular radial patterns are not identified as verified repeated gear geometry', () => {
  const cylinder = makeCylinder(10, 5),
    box = makeBaseBox(20, 20, 5),
    irregular = gearShape(12, { irregular: true });
  try {
    for (const shape of [cylinder, box, irregular])
      assert.equal(analyzeGearShape(shape), undefined);
  } finally {
    cylinder.delete();
    box.delete();
    irregular.delete();
  }
});

test('real inch-unit STEP import attaches millimetre gear measurements to the actual imported part', async () => {
  const shape = gearShape(8);
  try {
    const source = exportSTEP([{ shape, name: 'Synthetic radial test profile' }], {
      unit: 'INCH',
      modelUnit: 'MM',
    });
    const result = await importStep(await source.arrayBuffer(), 'synthetic-gear-inch.step');
    assert.equal(result.parts.length, 1);
    const g = result.parts[0].features?.gear;
    assert.ok(g);
    assert.equal(result.parts[0].unit, 'mm');
    assert.equal(g.toothCount, 8);
    near(g.outsideDiameter, 20);
    near(g.rootDiameter, 16);
    near(g.faceWidth, 5);
    near(g.boreDiameter!, 3);
    assert.equal(result.parts[0].views.length, 4);
  } finally {
    shape.delete();
  }
});
