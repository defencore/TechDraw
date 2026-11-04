import type {
  ManufacturingData,
  ManufacturingProfile,
  ManufacturingProfileType,
  Part,
  PartType,
} from '../model';
import { effectivePartType, PART_TYPES, parseManufacturingProfile } from '../manufacturing/catalog';
import { captureManufacturingProfile } from './part-type-editor';

interface EditorContext {
  active(): Part | undefined;
  busy(): boolean;
  commit(partId: string, data: ManufacturingData): boolean;
  render(): void;
  report(message: string): void;
}
interface ProfileDraft {
  partId: string;
  type: ManufacturingProfileType;
  profile: ManufacturingProfile;
  committed: string;
}
export interface PendingManufacturingProfile extends ProfileDraft {
  data: ManufacturingData;
}
const key = (partId: string, type: ManufacturingProfileType) => JSON.stringify([partId, type]);
const baseline = (part: Part, type: ManufacturingProfileType): string => {
  const profile = part.manufacturing?.profiles[type];
  return JSON.stringify([
    Object.entries(profile?.fields ?? {}).sort(([a], [b]) => a.localeCompare(b)),
    profile?.customName ?? '',
    (profile?.parameters ?? []).map((row) => [row.id, row.label, row.symbol ?? '', row.value]),
  ]);
};

/** Unapplied fields belong to a part and profile, independently of the visible form. */
export class PartTypeEditorController {
  private drafts = new Map<string, ProfileDraft>();
  constructor(private readonly context: EditorContext) {}

  draft(part: Part): ManufacturingProfile | undefined {
    this.reconcile(part);
    const type = effectivePartType(part);
    return this.drafts.get(key(part.id, type))?.profile;
  }

  /** History may replace committed values without changing the selected profile type. */
  reconcile(part: Part): void {
    for (const [id, entry] of this.drafts)
      if (entry.partId === part.id && entry.committed !== baseline(part, entry.type))
        this.drafts.delete(id);
  }

  private capture(root: ParentNode): ProfileDraft | undefined {
    const part = this.context.active();
    if (!part) return;
    const type = effectivePartType(part);
    if (!root.querySelector('#manufacturing-profile-form')) return;
    const entry = {
      partId: part.id,
      type,
      profile: captureManufacturingProfile(root),
      committed: baseline(part, type),
    };
    this.drafts.set(key(part.id, type), entry);
    return entry;
  }

  handleInput(root: ParentNode, target: HTMLElement): boolean {
    if (!target.closest('#manufacturing-profile-form')) return false;
    this.capture(root);
    return true;
  }

  handleTypeChange(root: ParentNode, value: string): void {
    const part = this.context.active();
    if (!part || this.context.busy() || !PART_TYPES.some((type) => type.id === value)) return;
    this.capture(root);
    this.context.commit(part.id, {
      type: value as PartType,
      profiles: structuredClone(part.manufacturing?.profiles ?? {}),
    });
    this.context.render();
  }

  handleClick(root: ParentNode, target: Element): boolean {
    const action = target.closest<HTMLElement>('[data-profile-action]')?.dataset.profileAction;
    if (!action) return false;
    const part = this.context.active();
    if (!part || this.context.busy()) return true;
    const type = effectivePartType(part);
    if (action === 'apply') this.apply(root);
    else if (action === 'reset') {
      this.drafts.delete(key(part.id, type));
      this.context.render();
    } else {
      const entry = this.capture(root);
      if (!entry) return true;
      if (action === 'add-row') {
        if (entry.profile.parameters.length >= 20) {
          this.context.report('Use at most 20 additional parameters.');
          return true;
        }
        entry.profile.parameters.push({ id: crypto.randomUUID(), label: '', value: '' });
      } else if (action === 'remove-row') {
        const id = target.closest<HTMLElement>('[data-profile-action]')?.dataset.parameterId;
        entry.profile.parameters = entry.profile.parameters.filter((row) => row.id !== id);
      } else return false;
      this.context.render();
      if (action === 'add-row')
        [
          ...root.querySelectorAll<HTMLInputElement>(
            '.manufacturing-parameter-row [data-parameter-field="label"]',
          ),
        ]
          .at(-1)
          ?.focus();
    }
    return true;
  }

  apply(root: ParentNode): void {
    if (this.context.busy()) return;
    const entry = this.capture(root),
      part = this.context.active();
    if (!entry || !part) return;
    try {
      const profile = parseManufacturingProfile(entry.type, entry.profile);
      this.context.commit(part.id, {
        type: part.manufacturing?.type ?? 'auto',
        profiles: { ...structuredClone(part.manufacturing?.profiles ?? {}), [entry.type]: profile },
      });
      this.drafts.delete(key(part.id, entry.type));
      this.context.render();
      this.context.report('Part parameters applied to this drawing.');
    } catch (error) {
      this.context.report(error instanceof Error ? error.message : String(error));
    }
  }

  /** Validate every active profile before any save/export boundary mutates document data. */
  preparePending(parts: readonly Part[]): PendingManufacturingProfile[] {
    const output: PendingManufacturingProfile[] = [];
    for (const part of parts) {
      this.reconcile(part);
      const type = effectivePartType(part);
      const entry = this.drafts.get(key(part.id, type));
      if (!entry) continue;
      const profile = parseManufacturingProfile(type, entry.profile);
      output.push({
        ...entry,
        profile,
        data: {
          type: part.manufacturing?.type ?? 'auto',
          profiles: { ...structuredClone(part.manufacturing?.profiles ?? {}), [type]: profile },
        },
      });
    }
    return output;
  }

  commitPending(pending: PendingManufacturingProfile[]): boolean {
    let changed = false;
    for (const entry of pending) {
      changed = this.context.commit(entry.partId, entry.data) || changed;
      this.drafts.delete(key(entry.partId, entry.type));
    }
    return changed;
  }

  hasPendingChanges(parts: readonly Part[]): boolean {
    for (const part of parts) this.reconcile(part);
    for (const entry of this.drafts.values()) {
      const part = parts.find((part) => part.id === entry.partId);
      if (!part) continue;
      try {
        const profile = parseManufacturingProfile(entry.type, entry.profile);
        const candidate = {
          ...part,
          manufacturing: {
            type: part.manufacturing?.type ?? 'auto',
            profiles: { ...part.manufacturing?.profiles, [entry.type]: profile },
          },
        };
        if (baseline(candidate, entry.type) !== baseline(part, entry.type)) return true;
      } catch {
        return true;
      }
    }
    return false;
  }

  clearPart(partId: string): void {
    for (const [id, entry] of this.drafts) if (entry.partId === partId) this.drafts.delete(id);
  }
  clear(): void {
    this.drafts.clear();
  }
}
