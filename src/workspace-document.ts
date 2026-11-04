import type { Dimension, DrawingAnnotation, DrawingLayout, Part } from './model';
import { autoDimensions } from './drawing/dimensions';
import { initializeDrawing } from './drawing/layout';
import type { ProjectData } from './project';
import { DimensionHistory, type WorkspaceState } from './state';

/** Document edits and physical layouts are independent from DOM and viewport state. */
export class WorkspaceDocument {
  private readonly histories = new Map<string, DimensionHistory>();
  private readonly pendingArrangement = new Set<string>();
  private layoutSettingsKey = '';

  constructor(readonly state: WorkspaceState) {}

  get active(): Part | undefined {
    return this.state.parts.find((part) => part.id === this.state.activeId);
  }
  get dimensions(): Dimension[] {
    return this.state.activeId ? (this.state.dimensions[this.state.activeId] ?? []) : [];
  }
  get annotations(): DrawingAnnotation[] {
    return this.state.activeId ? (this.state.annotations[this.state.activeId] ?? []) : [];
  }
  get history(): DimensionHistory | undefined {
    const id = this.state.activeId;
    if (!id) return;
    if (!this.histories.has(id)) this.histories.set(id, new DimensionHistory());
    return this.histories.get(id)!;
  }

  private settingsKey(): string {
    const { format, orientation, template, scale } = this.state.settings;
    return JSON.stringify([format, orientation, template, scale]);
  }

  layout(part: Part): DrawingLayout {
    const key = this.settingsKey();
    if (key !== this.layoutSettingsKey) {
      this.state.layouts = {};
      for (const history of this.histories.values()) history.invalidateLayouts();
      this.layoutSettingsKey = key;
    }
    if (!this.state.layouts[part.id]) {
      const initialized = initializeDrawing(
        part,
        this.state.dimensions[part.id] ?? [],
        this.state.settings,
        {
          arrange: this.pendingArrangement.has(part.id),
        },
      );
      this.state.dimensions[part.id] = initialized.dimensions;
      this.state.layouts[part.id] = initialized.layout;
      this.pendingArrangement.delete(part.id);
    }
    return this.state.layouts[part.id];
  }

  addPart(part: Part): void {
    this.state.parts.push(part);
    this.state.selected.add(part.id);
    this.state.dimensions[part.id] = autoDimensions(part);
    this.state.annotations[part.id] = [];
    this.pendingArrangement.add(part.id);
  }

  checkpoint(): void {
    this.history?.record({
      dimensions: this.dimensions,
      annotations: this.annotations,
      layout: this.state.layouts[this.state.activeId!],
    });
  }

  changeAnnotations(next: DrawingAnnotation[]): boolean {
    const id = this.state.activeId;
    if (!id || JSON.stringify(next) === JSON.stringify(this.annotations)) return false;
    this.checkpoint();
    this.state.annotations[id] = structuredClone(next);
    return true;
  }

  changeDimensions(
    next: Dimension[],
    options: { arrange?: boolean; record?: boolean } = {},
  ): boolean {
    const id = this.state.activeId;
    if (!id) return false;
    if (!options.arrange && JSON.stringify(next) === JSON.stringify(this.dimensions)) return false;
    if (options.record !== false) this.checkpoint();
    if (options.arrange) {
      delete this.state.layouts[id];
      this.pendingArrangement.add(id);
    }
    this.state.dimensions[id] = structuredClone(next);
    return true;
  }

  travel(direction: 'undo' | 'redo'): boolean {
    const id = this.state.activeId;
    if (!id) return false;
    const current = {
      dimensions: this.dimensions,
      annotations: this.annotations,
      layout: this.state.layouts[id],
    };
    const result = this.history?.[direction](current);
    if (!result) return false;
    this.pendingArrangement.delete(id);
    this.state.dimensions[id] = result.dimensions;
    this.state.annotations[id] = result.annotations ?? [];
    if (result.layout) this.state.layouts[id] = result.layout;
    else delete this.state.layouts[id];
    return true;
  }

  removePart(id: string): void {
    this.state.parts = this.state.parts.filter((part) => part.id !== id);
    this.state.selected.delete(id);
    delete this.state.dimensions[id];
    delete this.state.annotations[id];
    delete this.state.layouts[id];
    this.pendingArrangement.delete(id);
    this.histories.delete(id);
    if (this.state.activeId === id) this.state.activeId = this.state.parts[0]?.id ?? null;
  }

  replace(project: ProjectData): void {
    this.state.description = project.description;
    this.state.parts = project.parts;
    this.state.dimensions = project.dimensions;
    this.state.annotations = project.annotations;
    this.state.layouts = project.layouts;
    this.state.settings = project.settings;
    this.state.selected = new Set(project.selected);
    this.state.activeId = project.parts[0]?.id ?? null;
    this.histories.clear();
    this.pendingArrangement.clear();
    this.layoutSettingsKey = this.settingsKey();
  }
}
