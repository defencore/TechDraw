/** Annotation focus and group membership change together in one selection operation. */
export class DimensionSelection {
  private selected = new Set<string>();
  private focused?: string;

  get ids(): ReadonlySet<string> {
    return this.selected;
  }
  get focus(): string | undefined {
    return this.focused;
  }

  select(id?: string, additive = false): void {
    if (id === undefined) {
      if (!additive) this.clear();
      return;
    }
    if (additive) this.set(id, !this.selected.has(id));
    else {
      if (!this.selected.has(id)) this.selected = new Set([id]);
      this.focused = id;
    }
  }

  /** Checkbox changes state explicitly, so repeated change events remain idempotent. */
  set(id: string, selected: boolean): void {
    if (selected) {
      this.selected.add(id);
      this.focused = id;
    } else {
      this.selected.delete(id);
      if (this.focused === id) this.focused = [...this.selected].at(-1);
    }
  }

  clear(): void {
    this.selected.clear();
    this.focused = undefined;
  }

  replace(ids: Iterable<string>, focus?: string): void {
    this.selected = new Set(ids);
    this.focused =
      focus !== undefined && this.selected.has(focus) ? focus : [...this.selected].at(-1);
  }

  retain(existingIds: Iterable<string>): void {
    const existing = new Set(existingIds);
    for (const id of this.selected) if (!existing.has(id)) this.selected.delete(id);
    if (this.focused === undefined || !this.selected.has(this.focused))
      this.focused = [...this.selected].at(-1);
  }
}
