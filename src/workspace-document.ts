import type {
  Dimension,
  DrawingAnnotation,
  DrawingLayout,
  GearSpecification,
  ManufacturingData,
  Part,
} from './model';
import { parseGearSpecification } from './gears/specification';
import {
  effectivePartType,
  hasManufacturingData,
  parseManufacturingData,
} from './manufacturing/catalog';
import { autoDimensions } from './drawing/dimensions';
import { mergeDimensionSuggestions } from './drawing/suggestions';
import { initializeDrawing } from './drawing/layout';
import { parsePartInstructions, type ProjectData } from './project';
import { drawingSettingsForInstructions } from './drawing/manufacturing-instructions';
import { DimensionHistory, type WorkspaceState } from './state';

/** Locked document objects keep their source position and data through generic edits. */
function preserveLocked<T extends { id: string; locked?: boolean }>(
  current: readonly T[],
  next: readonly T[],
): T[] {
  const fixed = current.map((item, index) => ({ item, index })).filter(({ item }) => item.locked);
  const fixedIds = new Set(fixed.map(({ item }) => item.id));
  const result = next.filter((item) => !fixedIds.has(item.id));
  for (const { item, index } of fixed) result.splice(Math.min(index, result.length), 0, item);
  return result;
}

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
  getInstructions(partId: string): string {
    return this.state.instructions[partId] ?? '';
  }
  get hasLocks(): boolean {
    return (
      Object.values(this.state.dimensions).some((items) => items.some((item) => item.locked)) ||
      Object.values(this.state.annotations).some((items) => items.some((item) => item.locked))
    );
  }
  private partHasLocks(id: string): boolean {
    return (
      (this.state.dimensions[id] ?? []).some((item) => item.locked) ||
      (this.state.annotations[id] ?? []).some((item) => item.locked)
    );
  }
  get history(): DimensionHistory | undefined {
    const id = this.state.activeId;
    if (!id) return;
    return this.historyFor(id);
  }
  private historyFor(id: string): DimensionHistory {
    if (!this.histories.has(id)) this.histories.set(id, new DimensionHistory());
    return this.histories.get(id)!;
  }

  private settingsKey(): string {
    const { format, orientation, template, scale } = this.state.settings;
    return JSON.stringify([format, orientation, template, scale]);
  }
  private arrangeGeneratedDrawing(part: Part): void {
    if (
      hasManufacturingData(part) &&
      !this.partHasLocks(part.id) &&
      !this.state.annotations[part.id]?.length &&
      (this.state.dimensions[part.id] ?? []).every((dimension) => dimension.automatic)
    )
      this.pendingArrangement.add(part.id);
  }

  layout(part: Part): DrawingLayout {
    const key = this.settingsKey();
    if (key !== this.layoutSettingsKey) {
      if (!this.hasLocks) {
        this.state.layouts = {};
        for (const history of this.histories.values()) history.invalidateLayouts();
        for (const part of this.state.parts) this.arrangeGeneratedDrawing(part);
      }
      this.layoutSettingsKey = key;
    }
    if (!this.state.layouts[part.id]) {
      const initialized = initializeDrawing(
        part,
        this.state.dimensions[part.id] ?? [],
        drawingSettingsForInstructions(this.state.settings, this.getInstructions(part.id)),
        {
          arrange: this.pendingArrangement.has(part.id) && !this.partHasLocks(part.id),
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
    this.state.instructions[part.id] = '';
    this.pendingArrangement.add(part.id);
  }

  checkpoint(): void {
    if (this.state.activeId) this.checkpointFor(this.state.activeId);
  }
  private checkpointFor(id: string): void {
    this.historyFor(id).record({
      dimensions: this.state.dimensions[id] ?? [],
      annotations: this.state.annotations[id] ?? [],
      layout: this.state.layouts[id],
      instructions: this.getInstructions(id),
      gearSpecification: this.state.parts.find((part) => part.id === id)?.gearSpecification ?? null,
      manufacturing: this.state.parts.find((part) => part.id === id)?.manufacturing ?? null,
    });
  }

  setInstructions(partId: string, text: string): boolean {
    const part = this.state.parts.find((part) => part.id === partId);
    if (!part) return false;
    const validated = parsePartInstructions(text);
    if (validated === this.getInstructions(partId)) return false;
    this.checkpointFor(partId);
    this.state.instructions[partId] = validated;
    if (!this.partHasLocks(partId)) delete this.state.layouts[partId];
    this.arrangeGeneratedDrawing(part);
    return true;
  }

  setGearSpecification(partId: string, specification?: GearSpecification): boolean {
    const part = this.state.parts.find((part) => part.id === partId);
    if (!part) return false;
    const validated =
      specification === undefined ? undefined : parseGearSpecification(specification);
    if (JSON.stringify(validated) === JSON.stringify(part.gearSpecification)) return false;
    this.checkpointFor(partId);
    if (validated) part.gearSpecification = validated;
    else delete part.gearSpecification;
    if (!this.partHasLocks(partId)) delete this.state.layouts[partId];
    this.arrangeGeneratedDrawing(part);
    return true;
  }

  /** Switching the active profile retains saved values belonging to every other profile. */
  setManufacturing(partId: string, data?: ManufacturingData): boolean {
    const part = this.state.parts.find((item) => item.id === partId);
    if (!part) return false;
    let validated = data === undefined ? undefined : parseManufacturingData(data);
    if (validated)
      validated = parseManufacturingData({
        ...validated,
        profiles: { ...part.manufacturing?.profiles, ...validated.profiles },
      });
    if (JSON.stringify(validated) === JSON.stringify(part.manufacturing)) return false;
    const oldType = effectivePartType(part);
    this.checkpointFor(partId);
    if (validated) part.manufacturing = validated;
    else delete part.manufacturing;
    const unlocked = !this.partHasLocks(partId);
    if (unlocked) delete this.state.layouts[partId];
    if (
      oldType !== effectivePartType(part) &&
      unlocked &&
      !this.state.annotations[partId]?.length &&
      (this.state.dimensions[partId] ?? []).every((dimension) => dimension.automatic)
    ) {
      this.state.dimensions[partId] = mergeDimensionSuggestions(
        this.state.dimensions[partId] ?? [],
        autoDimensions(part),
      ).dimensions;
      this.pendingArrangement.add(partId);
    }
    this.arrangeGeneratedDrawing(part);
    return true;
  }

  changeAnnotations(next: DrawingAnnotation[]): boolean {
    const id = this.state.activeId;
    if (!id) return false;
    const protectedNext = preserveLocked(this.annotations, next);
    if (JSON.stringify(protectedNext) === JSON.stringify(this.annotations)) return false;
    this.checkpoint();
    this.state.annotations[id] = structuredClone(protectedNext);
    return true;
  }

  changeDimensions(
    next: Dimension[],
    options: { arrange?: boolean; record?: boolean } = {},
  ): boolean {
    const id = this.state.activeId;
    if (!id) return false;
    if (options.arrange && this.partHasLocks(id)) return false;
    const protectedNext = preserveLocked(this.dimensions, next);
    if (!options.arrange && JSON.stringify(protectedNext) === JSON.stringify(this.dimensions))
      return false;
    if (options.record !== false) this.checkpoint();
    if (options.arrange) {
      delete this.state.layouts[id];
      this.pendingArrangement.add(id);
    }
    this.state.dimensions[id] = structuredClone(protectedNext);
    return true;
  }

  setSelectionLocked(
    selection: { dimensions: ReadonlySet<string>; annotations: ReadonlySet<string> },
    locked: boolean,
  ): boolean {
    const id = this.state.activeId;
    if (!id) return false;
    if (typeof locked !== 'boolean') throw new TypeError('Locked state must be a boolean.');
    const dimensions = this.dimensions.map((item) =>
      selection.dimensions.has(item.id) && Boolean(item.locked) !== locked
        ? { ...item, locked }
        : item,
    );
    const annotations = this.annotations.map((item) =>
      selection.annotations.has(item.id) && Boolean(item.locked) !== locked
        ? { ...item, locked }
        : item,
    );
    if (
      JSON.stringify(dimensions) === JSON.stringify(this.dimensions) &&
      JSON.stringify(annotations) === JSON.stringify(this.annotations)
    )
      return false;
    this.checkpoint();
    this.state.dimensions[id] = structuredClone(dimensions);
    this.state.annotations[id] = structuredClone(annotations);
    return true;
  }

  travel(direction: 'undo' | 'redo'): boolean {
    const id = this.state.activeId;
    if (!id) return false;
    const current = {
      dimensions: this.dimensions,
      annotations: this.annotations,
      layout: this.state.layouts[id],
      instructions: this.getInstructions(id),
      gearSpecification: this.active?.gearSpecification ?? null,
      manufacturing: this.active?.manufacturing ?? null,
    };
    const result = this.history?.[direction](current);
    if (!result) return false;
    this.pendingArrangement.delete(id);
    this.state.dimensions[id] = result.dimensions;
    this.state.annotations[id] = result.annotations ?? [];
    if (result.instructions !== undefined) this.state.instructions[id] = result.instructions;
    if (result.gearSpecification !== undefined && this.active) {
      if (result.gearSpecification) this.active.gearSpecification = result.gearSpecification;
      else delete this.active.gearSpecification;
    }
    if (result.manufacturing !== undefined && this.active) {
      if (result.manufacturing) this.active.manufacturing = result.manufacturing;
      else delete this.active.manufacturing;
    }
    if (result.layout) this.state.layouts[id] = result.layout;
    else delete this.state.layouts[id];
    return true;
  }

  removePart(id: string): void {
    this.state.parts = this.state.parts.filter((part) => part.id !== id);
    this.state.selected.delete(id);
    delete this.state.dimensions[id];
    delete this.state.annotations[id];
    delete this.state.instructions[id];
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
    this.state.instructions = project.instructions;
    this.state.layouts = project.layouts;
    this.state.settings = project.settings;
    this.state.selected = new Set(project.selected);
    this.state.activeId = project.parts[0]?.id ?? null;
    this.histories.clear();
    this.pendingArrangement.clear();
    this.layoutSettingsKey = this.settingsKey();
  }
}
