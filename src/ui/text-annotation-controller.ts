import type { DrawingAnnotation, Point2 } from '../model';
import {
  createAnnotation,
  validateAnnotationOptions,
  type AnnotationOptions,
} from './annotation-tools';
import { renderTextAnnotationEditor } from './text-annotation-editor';
import { localizeUi, t } from './i18n';

export interface TextAnnotationSession {
  partId: string;
  point: Point2;
  client?: Point2;
  annotation?: DrawingAnnotation;
  options: AnnotationOptions;
}
interface EditorContext {
  commit(session: TextAnnotationSession, annotation: DrawingAnnotation): void;
  cancel(): void;
  closed(): void;
}
interface EditorViewport {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Draft values never modify the selected mark until the form is submitted. */
export function textAnnotationFromDraft(
  session: TextAnnotationSession,
  draft: Pick<AnnotationOptions, 'text' | 'color' | 'fontSize'>,
): DrawingAnnotation {
  if (session.annotation && (session.annotation.kind !== 'text' || session.annotation.locked))
    throw new Error('Unlock the note before editing it.');
  const options = validateAnnotationOptions({
    ...session.options,
    ...draft,
    strokeWidth: session.annotation?.strokeWidth ?? session.options.strokeWidth,
  });
  if (!options.text.trim()) throw new Error('Annotation text cannot be empty.');
  if (session.annotation)
    return {
      ...structuredClone(session.annotation),
      text: options.text,
      color: options.color,
      fontSize: options.fontSize,
    };
  return createAnnotation('text', session.point, options);
}

/** Keep the editor on the visible screen when a touch keyboard reduces its height. */
export function textEditorPosition(
  viewport: EditorViewport,
  size: { width: number; height: number },
  anchor?: Point2,
): { left: number; top: number; maxHeight: number } {
  const gap = 12;
  const width = Math.min(size.width, Math.max(0, viewport.width - gap * 2));
  const maxHeight = Math.max(0, viewport.height - gap * 2);
  const height = Math.min(size.height, maxHeight);
  const clamp = (value: number, start: number, space: number) =>
    Math.max(start + gap, Math.min(start + space - gap, value));
  const mobile = viewport.width <= 650;
  let left = viewport.left + (viewport.width - width) / 2;
  let top = viewport.top + (viewport.height - height) / 2;
  if (mobile) top = viewport.top + viewport.height - height - gap;
  else if (anchor) {
    left = anchor[0] + 16;
    if (left + width > viewport.left + viewport.width - gap) left = anchor[0] - width - 16;
    top = anchor[1] - 48;
  }
  return {
    left: clamp(left, viewport.left, viewport.width - width),
    top: clamp(top, viewport.top, viewport.height - height),
    maxHeight,
  };
}

/** One canvas-local editor owns creation and editing for mouse, keyboard and touch. */
export class TextAnnotationEditorController {
  private dialog?: HTMLDialogElement;
  private session?: TextAnnotationSession;
  constructor(private readonly context: EditorContext) {}

  get isOpen(): boolean {
    return Boolean(this.dialog?.open);
  }

  get hasPendingChanges(): boolean {
    if (!this.dialog || !this.session) return false;
    const draft = this.values();
    if (!this.session.annotation) return Boolean(draft.text.trim());
    const original = this.session.annotation;
    return (
      draft.text !== original.text ||
      draft.color !== (original.color ?? this.session.options.color) ||
      draft.fontSize !== original.fontSize
    );
  }

  open(session: TextAnnotationSession): void {
    if (this.dialog) return;
    if (session.annotation?.locked) return;
    this.session = structuredClone(session);
    const dialog = document.createElement('dialog');
    dialog.className = 'text-annotation-dialog';
    dialog.setAttribute('aria-labelledby', 'text-note-title');
    dialog.innerHTML = renderTextAnnotationEditor(session);
    document.body.append(dialog);
    this.dialog = dialog;
    const form = dialog.querySelector<HTMLFormElement>('#text-note-form')!;
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      try {
        const annotation = textAnnotationFromDraft(this.session!, this.values());
        this.context.commit(this.session!, annotation);
        this.close(true);
      } catch (error) {
        const label = dialog.querySelector<HTMLElement>('#text-note-error')!;
        label.textContent = t(error instanceof Error ? error.message : String(error));
        label.hidden = false;
        this.position();
        label.scrollIntoView({ block: 'nearest' });
      }
    });
    dialog.addEventListener('click', (event) => {
      const target = event.target as Element;
      if (target.closest('[data-text-note-action="cancel"]')) {
        this.close();
        return;
      }
      const color = target.closest<HTMLElement>('[data-text-note-color]')?.dataset.textNoteColor;
      if (color) {
        dialog.querySelector<HTMLInputElement>('#text-note-color')!.value = color;
        this.updatePreview();
      }
    });
    dialog.addEventListener('input', () => this.updatePreview());
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      this.close();
    });
    dialog.addEventListener('close', () => this.close());
    dialog.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        return;
      }
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.isComposing) {
        event.preventDefault();
        form.requestSubmit();
      }
    });
    window.addEventListener('resize', this.position);
    window.visualViewport?.addEventListener('resize', this.position);
    window.visualViewport?.addEventListener('scroll', this.position);
    localizeUi(dialog);
    dialog.showModal();
    this.updatePreview();
    this.position();
    dialog.querySelector<HTMLTextAreaElement>('#text-note-content')!.focus({ preventScroll: true });
  }

  close(saved = false): void {
    const dialog = this.dialog;
    if (!dialog) return;
    this.dialog = undefined;
    this.session = undefined;
    window.removeEventListener('resize', this.position);
    window.visualViewport?.removeEventListener('resize', this.position);
    window.visualViewport?.removeEventListener('scroll', this.position);
    dialog.close();
    dialog.remove();
    if (!saved) this.context.cancel();
    this.context.closed();
  }

  private values(): Pick<AnnotationOptions, 'text' | 'color' | 'fontSize'> {
    return {
      text: this.dialog!.querySelector<HTMLTextAreaElement>('#text-note-content')!.value,
      color: this.dialog!.querySelector<HTMLInputElement>('#text-note-color')!.value,
      fontSize: Number(this.dialog!.querySelector<HTMLInputElement>('#text-note-font-size')!.value),
    };
  }

  private updatePreview(): void {
    const dialog = this.dialog!;
    const values = this.values();
    const preview = dialog.querySelector<HTMLElement>('#text-note-preview')!;
    preview.textContent = values.text || t('Your note preview');
    preview.style.color = values.color;
    preview.style.fontSize = `${Math.max(10, Math.min(32, (values.fontSize * 96) / 25.4 || 13))}px`;
    for (const swatch of dialog.querySelectorAll<HTMLElement>('[data-text-note-color]'))
      swatch.setAttribute('aria-pressed', String(swatch.dataset.textNoteColor === values.color));
    dialog.querySelector<HTMLElement>('#text-note-error')!.hidden = true;
    this.position();
  }

  private position = (): void => {
    const dialog = this.dialog;
    if (!dialog) return;
    const visible = window.visualViewport;
    const viewport = {
      left: visible?.offsetLeft ?? 0,
      top: visible?.offsetTop ?? 0,
      width: visible?.width ?? window.innerWidth,
      height: visible?.height ?? window.innerHeight,
    };
    dialog.style.setProperty('--text-note-available-height', `${viewport.height}px`);
    dialog.style.maxWidth = `${Math.max(0, viewport.width - 24)}px`;
    dialog.style.maxHeight = `${Math.max(0, viewport.height - 24)}px`;
    const size = dialog.getBoundingClientRect();
    const position = textEditorPosition(viewport, size, this.session?.client);
    dialog.style.left = `${position.left}px`;
    dialog.style.top = `${position.top}px`;
  };
}
