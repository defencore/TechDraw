import type { Dimension, DrawingSettings, Part } from './model';

export const defaultSettings: DrawingSettings = {
  format: 'A3',
  orientation: 'landscape',
  template: 'eskd',
  scale: 'auto',
  precision: 2,
  hiddenLines: false,
  centerLines: true,
  title: '',
  number: '',
  material: '',
  author: '',
  revision: 'A',
  tolerance: '',
  notes: 'Dimensions in mm.',
};
export interface WorkspaceState {
  parts: Part[];
  selected: Set<string>;
  activeId: string | null;
  dimensions: Record<string, Dimension[]>;
  settings: DrawingSettings;
}
export class DimensionHistory {
  private past: Dimension[][] = [];
  private future: Dimension[][] = [];
  record(dimensions: Dimension[]): void {
    this.past.push(structuredClone(dimensions));
    if (this.past.length > 60) this.past.shift();
    this.future = [];
  }
  undo(current: Dimension[]): Dimension[] | undefined {
    const previous = this.past.pop();
    if (previous) this.future.push(structuredClone(current));
    return previous;
  }
  redo(current: Dimension[]): Dimension[] | undefined {
    const next = this.future.pop();
    if (next) this.past.push(structuredClone(current));
    return next;
  }
  get canUndo(): boolean {
    return this.past.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }
}
