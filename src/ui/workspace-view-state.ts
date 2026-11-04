interface PanelState {
  top: number;
  left: number;
  expanded: Map<string, boolean>;
}
const detailsKey = (details: HTMLDetailsElement) =>
  details.id ||
  details.dataset.treePath ||
  details.dataset.manufacturingSection ||
  `${details.className}:${details.querySelector('summary')?.textContent}`;

/** Preserve local panel context while the document UI is rebuilt; never scroll the canvas or page. */
export class WorkspaceViewState {
  private readonly panels = new Map<string, PanelState>();

  capture(root: ParentNode): void {
    for (const panel of root.querySelectorAll<HTMLElement>('[data-panel-view-key]')) {
      this.panels.set(panel.dataset.panelViewKey!, {
        top: panel.scrollTop,
        left: panel.scrollLeft,
        expanded: new Map(
          [...panel.querySelectorAll<HTMLDetailsElement>('details')].map((el) => [
            detailsKey(el),
            el.open,
          ]),
        ),
      });
    }
  }

  restore(root: ParentNode): void {
    for (const panel of root.querySelectorAll<HTMLElement>('[data-panel-view-key]')) {
      const saved = this.panels.get(panel.dataset.panelViewKey!);
      if (saved) {
        for (const details of panel.querySelectorAll<HTMLDetailsElement>('details')) {
          const open = saved.expanded.get(detailsKey(details));
          if (open !== undefined) details.open = open;
        }
      }
      panel.scrollTop = saved?.top ?? 0;
      panel.scrollLeft = saved?.left ?? 0;
    }
  }
}
