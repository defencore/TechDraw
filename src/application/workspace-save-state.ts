import type { WorkspaceState } from '../state';

/** Track editable data without repeatedly serializing immutable STEP projection geometry. */
function signature(state: WorkspaceState): string {
  return JSON.stringify({
    parts: state.parts.map(({ id, sourceId, gearSpecification, manufacturing }) => ({
      id,
      sourceId,
      gearSpecification,
      manufacturing,
      dimensions: state.dimensions[id] ?? [],
      annotations: state.annotations[id] ?? [],
      instructions: state.instructions[id] ?? '',
      layout: state.layouts[id] ?? null,
    })),
    settings: state.settings,
    description: state.description,
    selected: [...state.selected].sort(),
  });
}

export class WorkspaceSaveState {
  private saved: string;
  constructor(state: WorkspaceState) {
    this.saved = signature(state);
  }
  markSaved(state: WorkspaceState): void {
    this.saved = signature(state);
  }
  hasChanges(state: WorkspaceState): boolean {
    return signature(state) !== this.saved;
  }
}
