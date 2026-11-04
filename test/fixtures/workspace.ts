import type { Part } from '../../src/model';
import { defaultSettings, type WorkspaceState } from '../../src/state';
import { WorkspaceDocument } from '../../src/workspace-document';

export function publicPart(id = 'part'): Part {
  return {
    id,
    name: id,
    sourceName: 'public.step',
    path: ['public.step', id],
    unit: 'mm',
    warnings: [],
    bounds: { min: [0, 0, 0], max: [40, 20, 10] },
    views: (['front', 'top', 'right', 'iso'] as const).map((id) => ({
      id,
      name: id,
      bounds: { minX: 0, minY: 0, maxX: 40, maxY: 20 },
      edges: [
        {
          id: `${id}-edge`,
          kind: 'line',
          hidden: false,
          points: [
            [0, 0],
            [40, 20],
          ],
        },
      ],
    })),
  };
}
export function publicWorkspace(parts = [publicPart()]): WorkspaceDocument {
  const state: WorkspaceState = {
    parts,
    activeId: parts[0]?.id ?? null,
    selected: new Set(parts.map((part) => part.id)),
    dimensions: Object.fromEntries(parts.map((part) => [part.id, []])),
    annotations: {},
    instructions: {},
    layouts: {},
    description: '',
    settings: { ...defaultSettings },
  };
  return new WorkspaceDocument(state);
}
