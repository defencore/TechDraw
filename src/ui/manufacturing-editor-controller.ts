import type { GearSpecification, Part } from '../model';
import { effectivePartType } from '../manufacturing/catalog';
import { parsePartInstructions } from '../project';
import type { WorkspaceDocument } from '../workspace-document';
import {
  captureGearEditor,
  handleGearEditorClick,
  parseGearEditorDraft,
  renderGearEditor,
  syncGearEditorType,
  type GearEditorDraft,
} from './gear-editor';
import { renderManufacturingInstructions } from './manufacturing-instructions';
import { PartTypeEditorController } from './part-type-controller';
import { renderPartTypeEditor } from './part-type-editor';

interface EditorContext {
  document: WorkspaceDocument;
  busy(): boolean;
  render(): void;
  refresh(): void;
  report(message: string): void;
}
interface Draft<T> {
  value: T;
  committed: string;
}
const gearBaseline = (part: Part) => JSON.stringify(part.gearSpecification ?? null);

/** One owner coordinates manufacturing forms and validates every draft before boundary commits. */
export class ManufacturingEditorController {
  private readonly instructions = new Map<string, Draft<string>>();
  private readonly gears = new Map<string, Draft<GearEditorDraft>>();
  private readonly profiles: PartTypeEditorController;

  constructor(private readonly context: EditorContext) {
    this.profiles = new PartTypeEditorController({
      active: () => context.document.active,
      busy: context.busy,
      commit: (id, data) => context.document.setManufacturing(id, data),
      render: context.render,
      report: context.report,
    });
  }

  instructionDraft(part: Part): string {
    const committed = this.context.document.getInstructions(part.id);
    const draft = this.instructions.get(part.id);
    if (draft && draft.committed !== committed) this.instructions.delete(part.id);
    return this.instructions.get(part.id)?.value ?? committed;
  }

  gearDraft(part: Part): GearEditorDraft | undefined {
    const draft = this.gears.get(part.id);
    if (draft && draft.committed !== gearBaseline(part)) this.gears.delete(part.id);
    return this.gears.get(part.id)?.value;
  }

  updateInstructions(text: string): void {
    const part = this.context.document.active;
    if (!part || this.context.busy()) return;
    const committed = this.context.document.getInstructions(part.id);
    if (text === committed) this.instructions.delete(part.id);
    else this.instructions.set(part.id, { value: text, committed });
  }

  updateGear(value: GearEditorDraft): void {
    const part = this.context.document.active;
    if (part && !this.context.busy())
      this.gears.set(part.id, { value: structuredClone(value), committed: gearBaseline(part) });
  }

  /** Observe each history step even when the corresponding editor is hidden. */
  reconcileHistory(): void {
    const part = this.context.document.active;
    if (!part) return;
    this.instructionDraft(part);
    this.gearDraft(part);
    this.profiles.reconcile(part);
  }

  hasPendingChanges(): boolean {
    const { document } = this.context;
    if (this.profiles.hasPendingChanges(document.state.parts)) return true;
    for (const part of document.state.parts) {
      if (this.instructionDraft(part) !== document.getInstructions(part.id)) return true;
      const gear = this.gearDraft(part);
      if (!gear) continue;
      try {
        if (JSON.stringify(parseGearEditorDraft(gear)) !== gearBaseline(part)) return true;
      } catch {
        return true;
      }
    }
    return false;
  }

  renderInstructions(): string {
    const { document } = this.context;
    const part = document.active;
    const text = part ? this.instructionDraft(part) : '';
    const locked = Boolean(
      part &&
      ((document.state.dimensions[part.id] ?? []).some((item) => item.locked) ||
        (document.state.annotations[part.id] ?? []).some((item) => item.locked)),
    );
    return renderManufacturingInstructions(text, Boolean(part) && !this.context.busy(), {
      dirty: Boolean(part && text !== document.getInstructions(part.id)),
      locked,
    });
  }

  renderParameters(): string {
    const part = this.context.document.active;
    if (!part)
      return '<p class="field-help">Import a part to choose its type and manufacturing parameters.</p>';
    return renderPartTypeEditor(
      part,
      this.profiles.draft(part),
      !this.context.busy(),
      effectivePartType(part) === 'gear'
        ? renderGearEditor(part, this.gearDraft(part), !this.context.busy())
        : '',
    );
  }

  /** Prepare all branches first: an invalid gear must not partially save instructions or profiles. */
  flush(): void {
    const { document } = this.context;
    const profiles = this.profiles.preparePending(document.state.parts);
    const gears: [string, GearSpecification][] = [];
    const instructions: [string, string][] = [];
    for (const part of document.state.parts) {
      const gear = this.gearDraft(part);
      if (gear && effectivePartType(part) === 'gear')
        gears.push([part.id, parseGearEditorDraft(gear)]);
      const text = this.instructionDraft(part);
      if (this.instructions.has(part.id)) instructions.push([part.id, parsePartInstructions(text)]);
    }
    let changed = false;
    for (const [id, text] of instructions) {
      changed = document.setInstructions(id, text) || changed;
      this.instructions.delete(id);
    }
    for (const [id, specification] of gears) {
      changed = document.setGearSpecification(id, specification) || changed;
      this.gears.delete(id);
    }
    changed = this.profiles.commitPending(profiles) || changed;
    if (changed) this.context.render();
  }

  handleInput(root: ParentNode, target: HTMLElement): boolean {
    if (this.profiles.handleInput(root, target)) return true;
    if (target.dataset.gearField) {
      this.updateGear(captureGearEditor(root));
      return true;
    }
    if (target.id !== 'manufacturing-instructions') return false;
    this.updateInstructions((target as HTMLTextAreaElement).value);
    const part = this.context.document.active;
    const dirty = Boolean(
      part && this.instructionDraft(part) !== this.context.document.getInstructions(part.id),
    );
    for (const button of root.querySelectorAll<HTMLButtonElement>('[data-instructions-action]'))
      button.disabled = !dirty || this.context.busy();
    return true;
  }

  handleChange(root: ParentNode, target: HTMLInputElement): boolean {
    if (target.matches('[data-manufacturing-type]')) {
      this.profiles.handleTypeChange(root, target.value);
      return true;
    }
    if (!target.dataset.gearField) return false;
    this.updateGear(captureGearEditor(root));
    if (target.dataset.gearField === 'type') syncGearEditorType(root);
    return true;
  }

  handleSubmit(root: ParentNode, id: string): boolean {
    if (id === 'manufacturing-profile-form') this.profiles.apply(root);
    else if (id === 'gear-editor-form') this.applyGear(root);
    else return false;
    return true;
  }

  handleClick(root: ParentNode, target: Element): boolean {
    if (this.profiles.handleClick(root, target) || handleGearEditorClick(root, target)) return true;
    const gear = target.closest<HTMLElement>('[data-gear-action]')?.dataset.gearAction;
    const instruction = target.closest<HTMLElement>('[data-instructions-action]')?.dataset
      .instructionsAction;
    if (!gear && !instruction) return false;
    const { document } = this.context;
    const part = document.active;
    if (!part || this.context.busy()) return true;
    if (gear === 'apply') this.applyGear(root);
    else if (gear) {
      this.gears.delete(part.id);
      if (gear === 'remove') {
        document.setGearSpecification(part.id);
        this.context.render();
        this.context.report('Gear data removed. Measured geometry remains available.');
      } else this.context.refresh();
    } else if (instruction === 'reset') {
      this.instructions.delete(part.id);
      this.context.refresh();
    } else if (instruction === 'apply') {
      try {
        const text = root.querySelector<HTMLTextAreaElement>('#manufacturing-instructions')?.value;
        document.setInstructions(part.id, text ?? this.instructionDraft(part));
        this.instructions.delete(part.id);
        this.context.render();
        this.context.report('Manufacturing instructions saved on this part drawing.');
      } catch (error) {
        this.context.report(error instanceof Error ? error.message : String(error));
      }
    }
    return true;
  }

  private applyGear(root: ParentNode): void {
    const part = this.context.document.active;
    if (!part || this.context.busy()) return;
    try {
      const specification = parseGearEditorDraft(captureGearEditor(root));
      this.context.document.setGearSpecification(part.id, specification);
      this.gears.delete(part.id);
      this.context.render();
      this.context.report('Gear data applied to this part.');
    } catch (error) {
      this.context.report(error instanceof Error ? error.message : String(error));
    }
  }

  clearPart(id: string): void {
    this.instructions.delete(id);
    this.gears.delete(id);
    this.profiles.clearPart(id);
  }

  clear(): void {
    this.instructions.clear();
    this.gears.clear();
    this.profiles.clear();
  }
}
