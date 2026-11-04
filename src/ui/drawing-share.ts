import type { Bounds2 } from '../model';
import { copyDrawingImage, drawingPng, imageRegion } from './drawing-image';
import { downloadBlob } from './utils';
import { localizeUi, t } from './i18n';

export type ShareAppearance = 'paper' | 'blueprint';
export interface ShareDrawing {
  svg: string;
  width: number;
  height: number;
  name: string;
}
export interface DrawingShareOptions {
  drawing(appearance: ShareAppearance): ShareDrawing | undefined;
  visible(): Bounds2 | undefined;
  selection(): Bounds2 | undefined;
  capture(): void;
  report(message: string): void;
}
type ImageSource = 'visible' | 'selection' | 'sheet' | 'area';

/** A prepared PNG gives mobile browsers a fresh user gesture for Copy and native Share. */
export class DrawingShareController {
  private dialog?: HTMLDialogElement;
  private source: ImageSource = 'visible';
  private appearance: ShareAppearance = 'paper';
  private area?: Bounds2;
  private blob?: Blob;
  private file?: File;
  private previewUrl?: string;
  private generation = 0;
  constructor(private readonly options: DrawingShareOptions) {}
  get isOpen(): boolean {
    return !!this.dialog?.open;
  }
  open(appearance: ShareAppearance, area?: Bounds2): void {
    this.close();
    this.appearance = appearance;
    this.area = area;
    this.source = area ? 'area' : this.options.selection() ? 'selection' : 'visible';
    const dialog = document.createElement('dialog');
    dialog.className = 'drawing-share-dialog';
    dialog.innerHTML = `<form method="dialog"><div class="share-heading"><div><span class="eyebrow">DRAWING IMAGE</span><h2>Copy or share</h2></div><button class="icon-button" value="close" aria-label="Close">×</button></div></form>
      <div class="share-options"><label>Area<select id="share-area"><option value="visible">Visible area</option><option value="selection" ${this.options.selection() ? '' : 'disabled'}>Selected items</option><option value="sheet">Whole sheet</option>${area ? '<option value="area">Captured area</option>' : ''}</select></label><label>Appearance<select id="share-appearance"><option value="paper">Paper</option><option value="blueprint">Blueprint</option></select></label><button class="secondary" data-share-action="capture">Select area</button></div>
      <div class="share-preview" aria-busy="true"><img alt="Drawing image preview" hidden/><span class="share-loading">Preparing image…</span></div>
      <p class="share-message" role="status" aria-live="polite">Dimensions and review annotations are included. Workspace controls are excluded.</p>
      <div class="share-actions"><button class="primary" data-share-action="copy" disabled>Copy image</button><button class="secondary" data-share-action="save" disabled>Save PNG</button><button class="secondary" data-share-action="share" hidden disabled>Share…</button></div>`;
    document.body.append(dialog);
    this.dialog = dialog;
    dialog.querySelector<HTMLSelectElement>('#share-area')!.value = this.source;
    dialog.querySelector<HTMLSelectElement>('#share-appearance')!.value = appearance;
    dialog.addEventListener('close', () => this.dispose(dialog));
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) {
        this.close();
        return;
      }
      const action = (event.target as Element).closest<HTMLElement>('[data-share-action]')?.dataset
        .shareAction;
      if (action === 'capture') {
        this.close();
        this.options.capture();
      }
      if (action === 'save' && this.blob) downloadBlob(this.blob, this.file!.name);
      if (action === 'copy' && this.blob) {
        void copyDrawingImage(Promise.resolve(this.blob))
          .then(() => this.message('Image copied to clipboard.'))
          .catch(() => this.message('Image copying was blocked. Save PNG or use Share instead.'));
      }
      if (action === 'share' && this.file) {
        void navigator
          .share({ files: [this.file], title: this.file.name })
          .catch((error: unknown) => {
            if (!(error instanceof DOMException && error.name === 'AbortError'))
              this.message('This image could not be shared. Save PNG instead.');
          });
      }
    });
    dialog.addEventListener('change', () => {
      this.source = dialog.querySelector<HTMLSelectElement>('#share-area')!.value as ImageSource;
      this.appearance = dialog.querySelector<HTMLSelectElement>('#share-appearance')!
        .value as ShareAppearance;
      void this.prepare();
    });
    localizeUi(dialog);
    dialog.showModal();
    void this.prepare();
  }
  close(): void {
    const dialog = this.dialog;
    if (dialog) {
      dialog.close();
      this.dispose(dialog);
    }
  }
  private dispose(dialog: HTMLDialogElement): void {
    if (this.dialog !== dialog) return;
    ++this.generation;
    this.blob = undefined;
    this.file = undefined;
    if (this.previewUrl) URL.revokeObjectURL(this.previewUrl);
    this.previewUrl = undefined;
    this.dialog = undefined;
    dialog.remove();
  }
  private message(message: string): void {
    const node = this.dialog?.querySelector('.share-message');
    if (node) node.textContent = t(message);
    else this.options.report(t(message));
  }
  private async prepare(): Promise<void> {
    const dialog = this.dialog,
      generation = ++this.generation;
    if (!dialog) return;
    this.blob = undefined;
    this.file = undefined;
    for (const button of dialog.querySelectorAll<HTMLButtonElement>('.share-actions button'))
      button.disabled = true;
    const preview = dialog.querySelector<HTMLElement>('.share-preview')!;
    preview.setAttribute('aria-busy', 'true');
    const loading = preview.querySelector<HTMLElement>('.share-loading')!;
    preview.querySelector<HTMLImageElement>('img')!.hidden = true;
    loading.hidden = false;
    loading.textContent = t('Preparing image…');
    try {
      const drawing = this.options.drawing(this.appearance);
      if (!drawing) throw new Error('Open a drawing first.');
      const bounds =
        this.source === 'visible'
          ? this.options.visible()
          : this.source === 'selection'
            ? this.options.selection()
            : this.source === 'area'
              ? this.area
              : undefined;
      const region = imageRegion(bounds, drawing, this.source !== 'sheet');
      const blob = await drawingPng(drawing.svg, region);
      if (generation !== this.generation || this.dialog !== dialog) return;
      this.blob = blob;
      this.file = new File(
        [blob],
        `${drawing.name.replace(/[^a-z0-9_.-]+/gi, '-').slice(0, 100) || 'drawing'}${this.appearance === 'blueprint' ? '-blueprint' : ''}.png`,
        { type: 'image/png' },
      );
      if (this.previewUrl) URL.revokeObjectURL(this.previewUrl);
      this.previewUrl = URL.createObjectURL(blob);
      const img = preview.querySelector<HTMLImageElement>('img')!;
      img.src = this.previewUrl;
      img.hidden = false;
      loading.hidden = true;
      for (const button of dialog.querySelectorAll<HTMLButtonElement>('.share-actions button'))
        button.disabled = false;
      const share = dialog.querySelector<HTMLButtonElement>('[data-share-action="share"]')!;
      share.hidden = !navigator.canShare?.({ files: [this.file] });
      this.message('Ready. Copy, save or share this image.');
    } catch (error) {
      if (generation === this.generation)
        this.message(
          error instanceof Error ? error.message : 'The drawing image could not be rendered.',
        );
      loading.hidden = true;
    } finally {
      if (generation === this.generation) preview.setAttribute('aria-busy', 'false');
    }
  }
}
