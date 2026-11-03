import type { Dimension, DrawingLayout, DrawingSettings, Part } from './model';
import { titleBlockDefaults } from './drawing/title-block-data';

export const defaultSettings: DrawingSettings = {
  ...titleBlockDefaults,
  format: 'A3',
  orientation: 'landscape',
  template: 'eskd',
  scale: 'auto',
  precision: 2,
  hiddenLines: false,
  centerLines: true,
  notes: 'Dimensions in mm.',
};
export interface WorkspaceState {
  parts: Part[];
  selected: Set<string>;
  activeId: string | null;
  dimensions: Record<string, Dimension[]>;
  layouts: Record<string, DrawingLayout>;
  settings: DrawingSettings;
}
export interface DimensionSnapshot {
  dimensions: Dimension[];
  layout?: DrawingLayout;
}

/** Dimensions and their sheet layout form one reversible editing operation. */
export class DimensionHistory {
  private past: DimensionSnapshot[] = [];
  private future: DimensionSnapshot[] = [];
  record(snapshot: DimensionSnapshot): void {
    this.past.push(structuredClone(snapshot));
    if (this.past.length > 60) this.past.shift();
    this.future = [];
  }
  undo(current: DimensionSnapshot): DimensionSnapshot | undefined {
    const previous = this.past.pop();
    if (previous) this.future.push(structuredClone(current));
    return previous ? structuredClone(previous) : undefined;
  }
  redo(current: DimensionSnapshot): DimensionSnapshot | undefined {
    const next = this.future.pop();
    if (next) this.past.push(structuredClone(current));
    return next ? structuredClone(next) : undefined;
  }
  /** Paper changes invalidate stored view positions while annotation edits stay reversible. */
  invalidateLayouts(): void {
    for (const snapshot of [...this.past, ...this.future]) delete snapshot.layout;
  }
  get canUndo(): boolean {
    return this.past.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }
}
