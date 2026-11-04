import assert from 'node:assert/strict';
import test from 'node:test';
import { readStepProducts } from '../src/cad/step-metadata';

function product(id: number, name: string) {
  const base = id * 10;
  return `#${base}=PRODUCT('${name}','${name}','',());\n#${base + 1}=PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE('','',#${base},.NOT_KNOWN.);\n#${base + 2}=PRODUCT_DEFINITION('design','',#${base + 1},#999999);\n`;
}

test('shared STEP assembly ancestry is bounded during traversal rather than after branch expansion', () => {
  const records: string[] = [];
  let relation = 100000;
  for (let level = 0; level < 22; level++) {
    for (let side = 0; side < 2; side++) {
      const id = level * 2 + side + 1;
      records.push(product(id, `Level ${level} item ${side}`));
      if (level > 0)
        for (let parent = 0; parent < 2; parent++)
          records.push(
            `#${relation++}=NEXT_ASSEMBLY_USAGE_OCCURRENCE('','','',#${((level - 1) * 2 + parent + 1) * 10 + 2},#${id * 10 + 2},$);`,
          );
    }
  }
  const leaves = readStepProducts(records.join('\n'));
  assert.equal(leaves.length, 2);
  for (const leaf of leaves) {
    assert.equal(leaf.paths.length, 500);
    assert.ok(leaf.paths.every((path) => path.length === 22 && path.at(-1) === leaf.name));
    assert.equal(new Set(leaf.paths.map((path) => JSON.stringify(path))).size, 500);
  }
});

test('metadata-only extraction keeps quoted product references and ignores unrelated geometric records', () => {
  const records = [product(1, 'Mounting #123'), product(2, "Gear''s carrier")];
  records.push("#100=NEXT_ASSEMBLY_USAGE_OCCURRENCE('','ignored #123','',#12,#22,$);");
  for (let i = 1000; i < 6000; i++) records.push(`#${i}=CARTESIAN_POINT('',(1.,2.,3.));`);
  const leaves = readStepProducts(records.join('\n'));
  assert.deepEqual(leaves, [
    { definitionId: 22, name: "Gear's carrier", paths: [['Mounting #123', "Gear's carrier"]] },
  ]);
});
