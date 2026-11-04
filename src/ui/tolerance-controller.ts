import type { Dimension, DimensionTolerance } from '../model';
import { formatDimension } from '../drawing/dimensions';
import { normalizeToleranceNumber, parseDimensionTolerance } from '../drawing/tolerances';
import { renderToleranceFields, type ToleranceMode } from './tolerance-editor';
import { localizeUi, t } from './i18n';

export type ToleranceField = 'magnitude' | 'upper' | 'lower' | 'designation';
export interface ToleranceSelection {
  partId: string;
  dimension: Dimension;
}
export interface ToleranceDraft {
  mode: ToleranceMode;
  fields: Record<ToleranceField, string>;
}
interface EditorContext {
  getSelection(): ToleranceSelection | undefined;
  precision(): number;
  commit(selection: ToleranceSelection, tolerance: DimensionTolerance | undefined): void;
  reportError(message: string): void;
}
interface DraftEntry {
  partId: string;
  dimensionId: string;
  committed: string;
  draft: ToleranceDraft;
}

const fields: ToleranceField[] = ['magnitude', 'upper', 'lower', 'designation'];
const modes: ToleranceMode[] = ['none', 'symmetric', 'deviation', 'fit'];
const keyOf = ({ partId, dimension }: ToleranceSelection) => JSON.stringify([partId, dimension.id]);

function initialDraft(dimension: Dimension): ToleranceDraft {
  const tolerance = dimension.tolerance;
  return {
    mode: tolerance?.kind ?? 'none',
    fields: {
      magnitude: tolerance?.kind === 'symmetric' ? tolerance.magnitude : '',
      upper: tolerance?.kind === 'deviation' ? tolerance.upper : '',
      lower: tolerance?.kind === 'deviation' ? tolerance.lower : '',
      designation: tolerance?.kind === 'fit' ? tolerance.designation : '',
    },
  };
}

/** Raw, unapplied input belongs to an annotation, independently of its mounted editor. */
export class ToleranceEditorController {
  private drafts = new Map<string, DraftEntry>();
  private mountedKey?: string;
  private root?: ParentNode;

  constructor(private readonly context: EditorContext) {}

  private entry(selection: ToleranceSelection): ToleranceDraft {
    const key = keyOf(selection);
    const committed = JSON.stringify(selection.dimension.tolerance ?? null);
    if (this.drafts.get(key)?.committed !== committed)
      this.drafts.set(key, {
        partId: selection.partId,
        dimensionId: selection.dimension.id,
        committed,
        draft: initialDraft(selection.dimension),
      });
    return this.drafts.get(key)!.draft;
  }

  draft(selection = this.context.getSelection()): ToleranceDraft | undefined {
    return selection ? structuredClone(this.entry(selection)) : undefined;
  }

  /** Capture the old mounted identity before selection or inspector content changes. */
  capture(root = this.root): void {
    const draft = this.mountedKey ? this.drafts.get(this.mountedKey)?.draft : undefined;
    if (!root || !draft) return;
    const mode = root.querySelector<HTMLButtonElement>('#tolerance-modes [aria-checked="true"]')
      ?.dataset.toleranceMode as ToleranceMode | undefined;
    if (mode && modes.includes(mode)) draft.mode = mode;
    for (const control of root.querySelectorAll<HTMLInputElement>('[data-tolerance-field]')) {
      const field = control.dataset.toleranceField as ToleranceField;
      if (fields.includes(field)) draft.fields[field] = control.value;
    }
  }

  /** Restore only the tolerance controls; the paper and other inspector fields stay mounted. */
  restore(root = this.root): void {
    this.root = root;
    this.mountedKey = undefined;
    const selection = this.context.getSelection();
    const group = root?.querySelector('#tolerance-modes');
    const container = root?.querySelector('#tolerance-fields');
    if (!root || !selection || !group || !container) return;
    const draft = this.entry(selection);
    this.mountedKey = keyOf(selection);
    for (const control of group.querySelectorAll<HTMLButtonElement>('[data-tolerance-mode]')) {
      const selected = control.dataset.toleranceMode === draft.mode;
      control.classList.toggle('active', selected);
      control.setAttribute('aria-checked', String(selected));
      control.tabIndex = selected ? 0 : -1;
    }
    container.innerHTML = renderToleranceFields(draft.mode, selection.dimension);
    for (const control of container.querySelectorAll<HTMLInputElement>('[data-tolerance-field]')) {
      const field = control.dataset.toleranceField as ToleranceField;
      if (fields.includes(field)) control.value = draft.fields[field];
    }
    const apply = root.querySelector<HTMLButtonElement>('[data-action="apply-tolerance"]');
    if (apply) apply.disabled = draft.mode === 'none' && !selection.dimension.tolerance;
    this.updatePreview();
    localizeUi(root);
  }

  setMode(mode: ToleranceMode): void {
    const selection = this.context.getSelection();
    if (!selection || (mode === 'fit' && selection.dimension.kind === 'angle')) return;
    this.capture();
    const draft = this.entry(selection);
    if (draft.mode === mode) return;
    draft.mode = mode;
    this.restore();
  }

  setField(field: ToleranceField, value: string): void {
    const selection = this.context.getSelection();
    if (!selection) return;
    this.entry(selection).fields[field] = value;
    const control = this.root?.querySelector<HTMLInputElement>(`[data-tolerance-field="${field}"]`);
    if (control) control.value = value;
    this.updatePreview();
  }

  private parse(selection: ToleranceSelection): DimensionTolerance | undefined {
    const { mode, fields: raw } = this.entry(selection);
    const decimal = (field: ToleranceField) => {
      const value = normalizeToleranceNumber(raw[field]);
      if (value === undefined)
        throw new Error('Enter decimal deviations, for example 0.05 or -0.02.');
      return value;
    };
    if (mode === 'none') return undefined;
    if (mode === 'fit') {
      if (selection.dimension.kind === 'angle')
        throw new Error('Fit designations apply to linear dimensions.');
      return parseDimensionTolerance({ kind: mode, designation: raw.designation.trim() });
    }
    return parseDimensionTolerance(
      mode === 'symmetric'
        ? { kind: mode, magnitude: decimal('magnitude') }
        : { kind: mode, upper: decimal('upper'), lower: decimal('lower') },
    );
  }

  private updatePreview(): void {
    const error = this.root?.querySelector<HTMLElement>('#tolerance-error');
    if (error) error.hidden = true;
    const selection = this.context.getSelection();
    if (!selection) return;
    const draft = this.entry(selection);
    for (const control of this.root?.querySelectorAll<HTMLButtonElement>('[data-tolerance-sign]') ??
      []) {
      const value = draft.fields[control.dataset.toleranceTarget as 'upper' | 'lower'].trim();
      const sign = value ? (/^[-−]/.test(value) ? '-' : '+') : undefined;
      const selected = control.dataset.toleranceSign === sign;
      control.classList.toggle('active', selected);
      control.setAttribute('aria-pressed', String(selected));
    }
    const preview = this.root?.querySelector('#tolerance-preview');
    if (!preview) return;
    try {
      const tolerance = this.parse(selection);
      preview.textContent = t(
        `Preview: ${formatDimension({ ...selection.dimension, tolerance }, this.context.precision())}`,
      );
    } catch {
      preview.textContent = t('Enter the tolerance values, then choose Apply tolerance.');
    }
  }

  apply(remove = false): void {
    this.capture();
    const selection = this.context.getSelection();
    if (!selection) return;
    try {
      const tolerance = remove ? undefined : this.parse(selection);
      const changed = JSON.stringify(tolerance) !== JSON.stringify(selection.dimension.tolerance);
      // A synchronous commit may render immediately; do not recapture its stale controls.
      this.clearDimension(selection.partId, selection.dimension.id);
      if (changed) this.context.commit(selection, tolerance);
      else this.restore();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const label = this.root?.querySelector<HTMLElement>('#tolerance-error');
      if (label) {
        label.textContent = t(message);
        label.hidden = false;
      } else this.context.reportError(message);
    }
  }

  handleInput(target: HTMLElement): boolean {
    const field = target.dataset.toleranceField as ToleranceField;
    if (!fields.includes(field)) return false;
    this.capture();
    this.updatePreview();
    return true;
  }

  handleClick(target: Element): boolean {
    const mode = target.closest<HTMLButtonElement>('[data-tolerance-mode]');
    if (mode) {
      if (!mode.disabled) this.setMode(mode.dataset.toleranceMode as ToleranceMode);
      return true;
    }
    const sign = target.closest<HTMLButtonElement>('[data-tolerance-sign]');
    if (sign) {
      this.capture();
      const field = sign.dataset.toleranceTarget as 'upper' | 'lower';
      const draft = this.draft();
      if (draft) {
        this.setField(
          field,
          `${sign.dataset.toleranceSign}${draft.fields[field].trim().replace(/^[+−-]/, '')}`,
        );
        this.root
          ?.querySelector<HTMLInputElement>(`[data-tolerance-field="${field}"]`)
          ?.focus({ preventScroll: true });
      }
      return true;
    }
    const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
    if (action !== 'apply-tolerance' && action !== 'remove-tolerance') return false;
    this.apply(action === 'remove-tolerance');
    return true;
  }

  handleKeydown(event: KeyboardEvent): boolean {
    const target = event.target as HTMLElement;
    const mode = target.closest<HTMLButtonElement>('[data-tolerance-mode]');
    if (
      mode &&
      ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)
    ) {
      const controls = [
        ...this.root!.querySelectorAll<HTMLButtonElement>('[data-tolerance-mode]:not(:disabled)'),
      ];
      const current = controls.indexOf(mode);
      const index =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? controls.length - 1
            : (current +
                (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1) +
                controls.length) %
              controls.length;
      event.preventDefault();
      const next = controls[index];
      if (next) {
        this.setMode(next.dataset.toleranceMode as ToleranceMode);
        next.focus();
      }
      return true;
    }
    if (event.key !== 'Enter' || !target.dataset.toleranceField) return false;
    event.preventDefault();
    this.apply();
    return true;
  }

  clearDimension(partId: string, dimensionId: string): void {
    const key = JSON.stringify([partId, dimensionId]);
    this.drafts.delete(key);
    if (this.mountedKey === key) this.mountedKey = undefined;
  }

  reconcilePart(partId: string, dimensions: readonly Dimension[]): void {
    const byId = new Map(dimensions.map((dimension) => [dimension.id, dimension]));
    for (const entry of this.drafts.values()) {
      if (entry.partId !== partId) continue;
      const dimension = byId.get(entry.dimensionId);
      if (!dimension || entry.committed !== JSON.stringify(dimension.tolerance ?? null))
        this.clearDimension(partId, entry.dimensionId);
    }
  }

  hasPendingChanges(dimensions: Readonly<Record<string, Dimension[]>>): boolean {
    this.capture();
    for (const [partId, items] of Object.entries(dimensions)) this.reconcilePart(partId, items);
    for (const entry of this.drafts.values()) {
      const dimension = dimensions[entry.partId]?.find((item) => item.id === entry.dimensionId);
      if (!dimension) continue;
      try {
        if (
          JSON.stringify(this.parse({ partId: entry.partId, dimension })) !==
          JSON.stringify(dimension.tolerance)
        )
          return true;
      } catch {
        return true;
      }
    }
    return false;
  }

  clearPart(partId: string): void {
    for (const [key, entry] of this.drafts) {
      if (entry.partId !== partId) continue;
      this.drafts.delete(key);
      if (this.mountedKey === key) this.mountedKey = undefined;
    }
  }

  reset(): void {
    this.drafts.clear();
    this.mountedKey = undefined;
  }
}
