export interface StepProduct {
  definitionId: number;
  name: string;
  paths: string[][];
}

interface RecordData {
  type: string;
  body: string;
  refs: number[];
  strings: string[];
}

/** Read semantic names and relationships only; all geometry comes from OCCT. */
export function readStepProducts(text: string): StepProduct[] {
  const records = new Map<number, RecordData>();
  const pattern = /#(\d+)\s*=\s*([A-Z][A-Z0-9_]*)\s*\(((?:'(?:[^']|'')*'|[^';])*)\)\s*;/g;
  for (const match of text.matchAll(pattern)) {
    const body = match[3];
    // Remove strings before looking for references, as a name may contain '#'.
    const withoutStrings = body.replace(/'(?:[^']|'')*'/g, '');
    records.set(Number(match[1]), {
      type: match[2],
      body,
      refs: [...withoutStrings.matchAll(/#(\d+)/g)].map((m) => Number(m[1])),
      strings: [...body.matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'")),
    });
  }
  const definitions = new Map<number, string>();
  for (const [id, record] of records) {
    if (record.type !== 'PRODUCT_DEFINITION') continue;
    const formation = records.get(record.refs[0]);
    const product = formation && records.get(formation.refs[0]);
    if (product?.type !== 'PRODUCT') continue;
    const name = (product.strings[1] || product.strings[0] || `Product ${id}`).trim();
    definitions.set(id, name || `Product ${id}`);
  }
  const parents = new Map<number, number[]>();
  const children = new Map<number, number[]>();
  for (const record of records.values()) {
    if (!['NEXT_ASSEMBLY_USAGE_OCCURRENCE', 'ASSEMBLY_COMPONENT_USAGE'].includes(record.type))
      continue;
    const [parent, child] = record.refs;
    if (!definitions.has(parent) || !definitions.has(child)) continue;
    parents.set(child, [...(parents.get(child) || []), parent]);
    children.set(parent, [...(children.get(parent) || []), child]);
  }
  const pathsTo = (id: number, seen = new Set<number>()): string[][] => {
    if (seen.has(id) || seen.size > 32) return [[definitions.get(id)!]];
    const next = new Set(seen).add(id);
    const upstream = [...new Set(parents.get(id) || [])];
    if (!upstream.length) return [[definitions.get(id)!]];
    return upstream
      .flatMap((parent) => pathsTo(parent, next).map((path) => [...path, definitions.get(id)!]))
      .slice(0, 500);
  };
  // Assemblies are represented by their independently selectable leaf products.
  return [...definitions]
    .filter(([id]) => !children.has(id))
    .map(([definitionId, name]) => ({ definitionId, name, paths: pathsTo(definitionId) }));
}
