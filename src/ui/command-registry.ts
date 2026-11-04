import type { DimensionKind } from '../model';
import { t } from './i18n';

export interface CommandContext {
  busy: boolean;
  importing?: boolean;
  partCount: number;
  hasActivePart: boolean;
  selectedPartCount: number;
  selectionCount: number;
  dimensionCount: number;
  canUndo: boolean;
  canRedo: boolean;
  tool?: string;
  gridVisible?: boolean;
  gridSnap?: boolean;
  focusMode?: boolean;
  inspectorTab?: string;
  helpOpen?: boolean;
  viewerMode?: boolean;
  nativeFullscreenAvailable?: boolean;
  nativeFullscreen?: boolean;
  annotationSelection?: boolean;
  lockedCount?: number;
  keepAwake?: boolean;
}
interface CommandDefinition {
  id: string;
  label: string;
  group: string;
  icon?: string;
  shortcut?: string;
  alternateShortcuts?: readonly string[];
  keywords?: readonly string[];
  disabledReason?: (context: CommandContext) => string | undefined;
  active?: (context: CommandContext) => boolean;
  destructive?: boolean;
  undoable?: boolean;
  hidden?: boolean;
  allowWhenEditing?: boolean;
}

export const dimensionTools: readonly {
  id: DimensionKind;
  label: string;
  icon: string;
  shortcut: string;
}[] = [
  { id: 'horizontal', label: 'Horizontal', icon: 'dimensionHorizontal', shortcut: 'H' },
  { id: 'vertical', label: 'Vertical', icon: 'dimensionVertical', shortcut: 'V' },
  { id: 'aligned', label: 'Aligned', icon: 'dimensionAligned', shortcut: 'L' },
  { id: 'diameter', label: 'Diameter', icon: 'dimensionDiameter', shortcut: 'D' },
  { id: 'radius', label: 'Radius', icon: 'dimensionRadius', shortcut: 'R' },
  { id: 'angle', label: 'Angle', icon: 'dimensionAngle', shortcut: 'A' },
];

const idle = (context: CommandContext) =>
  context.busy ? 'Wait for the current operation to finish.' : undefined;
const drawing = (context: CommandContext) =>
  idle(context) ?? (!context.hasActivePart ? 'Import or open a part first.' : undefined);
const parts = (context: CommandContext) =>
  idle(context) ?? (!context.partCount ? 'Import or open a part first.' : undefined);
const selection = (context: CommandContext) =>
  drawing(context) ??
  (!context.selectionCount ? 'Select one or more dimensions first.' : undefined);
const dimensions = (context: CommandContext) =>
  drawing(context) ?? (!context.dimensionCount ? 'Add a dimension first.' : undefined);

export const commandDefinitions = [
  {
    id: 'import',
    label: 'Import STEP or DXF files',
    group: 'File',
    icon: 'upload',
    keywords: ['open', 'model', 'step', 'stp', 'dxf', '2d', '3d'],
    disabledReason: idle,
  },
  {
    id: 'open-project',
    label: 'Open drawing project',
    group: 'File',
    icon: 'file',
    shortcut: 'Mod+O',
    keywords: ['load', 'techdraw'],
    disabledReason: idle,
  },
  {
    id: 'save-project',
    label: 'Save drawing project',
    group: 'File',
    icon: 'file',
    shortcut: 'Mod+S',
    keywords: ['download', 'backup', 'techdraw'],
    disabledReason: parts,
    allowWhenEditing: true,
  },
  {
    id: 'prepare-all-drawings',
    label: 'Create drawings for all parts',
    group: 'File',
    icon: 'layers',
    keywords: ['assembly', 'components', 'batch', 'sheets'],
    disabledReason: parts,
  },
  {
    id: 'export-pdf',
    label: 'Export PDF',
    group: 'File',
    icon: 'download',
    keywords: ['print', 'download', 'drawing set'],
    disabledReason: (context: CommandContext) =>
      parts(context) ??
      (!context.selectedPartCount ? 'Select a part to include in the PDF.' : undefined),
  },
  {
    id: 'export-svg',
    label: 'Export SVG',
    group: 'File',
    icon: 'download',
    keywords: ['vector', 'download'],
    disabledReason: drawing,
  },
  {
    id: 'export-options',
    label: 'Export options',
    group: 'File',
    icon: 'download',
    disabledReason: drawing,
  },
  {
    id: 'view-drawing',
    label: 'View drawing',
    group: 'Navigation',
    icon: 'expand',
    disabledReason: drawing,
    active: (context: CommandContext) => !!context.viewerMode,
  },
  { id: 'exit-viewer', label: 'Exit viewer', group: 'Navigation', icon: 'close', hidden: true },
  {
    id: 'toggle-native-fullscreen',
    label: 'Toggle system fullscreen',
    group: 'Navigation',
    icon: 'expand',
    disabledReason: (context: CommandContext) =>
      idle(context) ??
      (!context.viewerMode
        ? 'Open drawing viewer first.'
        : context.nativeFullscreenAvailable === false
          ? 'System fullscreen is unavailable in this browser.'
          : undefined),
    active: (context: CommandContext) => !!context.nativeFullscreen,
  },
  {
    id: 'toggle-wake-lock',
    label: 'Keep screen awake',
    group: 'Workspace',
    icon: 'sun',
    disabledReason: drawing,
    active: (context: CommandContext) => !!context.keepAwake,
  },
  {
    id: 'share-drawing',
    label: 'Share drawing',
    group: 'File',
    icon: 'share',
    disabledReason: drawing,
  },
  {
    id: 'capture-region',
    label: 'Capture region',
    group: 'File',
    icon: 'crop',
    disabledReason: drawing,
  },
  ...(
    [
      ['text', 'Add text', 'text'],
      ['arrow', 'Add arrow', 'arrow'],
      ['rectangle', 'Add rectangle', 'rectangle'],
      ['ellipse', 'Add ellipse', 'ellipse'],
      ['freehand', 'Draw freehand', 'freehand'],
    ] as const
  ).map(([tool, label, icon]) => ({
    id: `tool:${tool}` as const,
    label,
    group: 'Markup',
    icon,
    disabledReason: drawing,
    active: (context: CommandContext) => context.tool === tool,
  })),
  { id: 'demo-dxf', label: 'Load DXF example', group: 'File', icon: 'file', disabledReason: idle },
  {
    id: 'demo',
    label: 'Load example parts',
    group: 'File',
    icon: 'cube',
    keywords: ['sample', 'demo', 'try'],
    disabledReason: idle,
  },
  {
    id: 'select-all',
    label: 'Toggle all parts for PDF',
    group: 'File',
    icon: 'layers',
    keywords: ['include', 'exclude', 'drawing set'],
    disabledReason: parts,
  },
  {
    id: 'tool:select',
    label: 'Select and move dimensions',
    group: 'Navigation',
    icon: 'pointer',
    shortcut: 'Escape',
    keywords: ['pointer', 'drag'],
    disabledReason: drawing,
    active: (context: CommandContext) => context.tool === 'select',
  },
  {
    id: 'tool:pan',
    label: 'Pan drawing',
    group: 'Navigation',
    icon: 'hand',
    shortcut: 'P',
    keywords: ['hand', 'space', 'move viewport'],
    disabledReason: drawing,
    active: (context: CommandContext) => context.tool === 'pan',
  },
  {
    id: 'tool:box-select',
    label: 'Box select dimensions',
    group: 'Navigation',
    icon: 'pointer',
    shortcut: 'B',
    keywords: ['marquee', 'rectangle', 'multiple'],
    disabledReason: drawing,
    active: (context: CommandContext) => context.tool === 'box-select',
  },
  {
    id: 'fit',
    label: 'Fit sheet',
    group: 'Navigation',
    icon: 'fit',
    shortcut: '0',
    keywords: ['zoom', 'page', 'reset view'],
    disabledReason: drawing,
  },
  {
    id: 'fit-selection',
    label: 'Fit selected dimensions',
    group: 'Navigation',
    icon: 'fit',
    shortcut: 'F',
    keywords: ['zoom', 'focus', 'selection'],
    disabledReason: selection,
  },
  {
    id: 'zoom-in',
    label: 'Zoom in',
    group: 'Navigation',
    icon: 'plus',
    shortcut: '+',
    alternateShortcuts: ['='],
    disabledReason: drawing,
  },
  {
    id: 'zoom-out',
    label: 'Zoom out',
    group: 'Navigation',
    icon: 'minus',
    shortcut: '-',
    disabledReason: drawing,
  },
  ...dimensionTools.map((tool) => ({
    id: `tool:${tool.id}` as const,
    label: `Add ${tool.label.toLowerCase()} dimension`,
    group: 'Add dimensions',
    icon: tool.icon,
    shortcut: tool.shortcut,
    keywords: ['measure', 'annotation', tool.id],
    disabledReason: drawing,
    active: (context: CommandContext) => context.tool === tool.id,
  })),
  {
    id: 'edit-dimension',
    label: 'Edit selected dimension',
    group: 'Selection',
    icon: 'dimension',
    shortcut: 'Enter',
    keywords: ['tolerance', 'fit', 'deviation', 'inspector', 'properties'],
    disabledReason: selection,
  },
  {
    id: 'select-all-dimensions',
    label: 'Select all dimensions',
    group: 'Selection',
    icon: 'layers',
    shortcut: 'Mod+A',
    disabledReason: dimensions,
  },
  {
    id: 'select-view-dimensions',
    label: 'Select dimensions in current view',
    group: 'Selection',
    icon: 'layers',
    keywords: ['projection', 'group'],
    disabledReason: dimensions,
  },
  {
    id: 'clear-dimension-selection',
    label: 'Clear dimension selection',
    group: 'Selection',
    icon: 'close',
    keywords: ['deselect', 'none'],
    disabledReason: selection,
  },
  {
    id: 'toggle-selection-lock',
    label: 'Lock selection',
    group: 'Selection',
    icon: 'lock',
    keywords: ['unlock', 'protect', 'fixed', 'annotation'],
    disabledReason: (context: CommandContext) =>
      drawing(context) ??
      (!context.annotationSelection && !context.selectionCount
        ? 'Select dimensions or an annotation first.'
        : undefined),
    undoable: true,
  },
  {
    id: 'delete-selected-dimensions',
    label: 'Delete selected dimensions',
    group: 'Selection',
    icon: 'trash',
    shortcut: 'Delete',
    alternateShortcuts: ['Backspace'],
    keywords: ['remove', 'erase'],
    disabledReason: selection,
    destructive: true,
    undoable: true,
  },
  {
    id: 'delete-dimension',
    label: 'Delete focused dimension',
    group: 'Selection',
    icon: 'trash',
    disabledReason: selection,
    destructive: true,
    undoable: true,
    hidden: true,
  },
  {
    id: 'place-dimensions:left',
    label: 'Place selected dimensions left',
    group: 'Arrange',
    icon: 'sideLeft',
    keywords: ['align', 'cascade', 'baseline', 'side'],
    disabledReason: selection,
    undoable: true,
  },
  {
    id: 'place-dimensions:right',
    label: 'Place selected dimensions right',
    group: 'Arrange',
    icon: 'sideRight',
    keywords: ['align', 'cascade', 'baseline', 'side'],
    disabledReason: selection,
    undoable: true,
  },
  {
    id: 'place-dimensions:top',
    label: 'Place selected dimensions above',
    group: 'Arrange',
    icon: 'sideTop',
    keywords: ['align', 'cascade', 'baseline', 'top', 'side'],
    disabledReason: selection,
    undoable: true,
  },
  {
    id: 'place-dimensions:bottom',
    label: 'Place selected dimensions below',
    group: 'Arrange',
    icon: 'sideBottom',
    keywords: ['align', 'cascade', 'baseline', 'bottom', 'side'],
    disabledReason: selection,
    undoable: true,
  },
  {
    id: 'auto-dimensions',
    label: 'Refresh automatic dimensions',
    group: 'Arrange',
    icon: 'magic',
    keywords: ['suggestions', 'measure', 'regenerate'],
    disabledReason: drawing,
    undoable: true,
  },
  {
    id: 'arrange-dimensions',
    label: 'Auto layout views and dimensions',
    group: 'Arrange',
    icon: 'layers',
    keywords: ['arrange', 'reflow', 'sheet', 'automatic'],
    disabledReason: drawing,
    undoable: true,
  },
  {
    id: 'undo',
    label: 'Undo',
    group: 'History',
    icon: 'undo',
    shortcut: 'Mod+Z',
    disabledReason: (context: CommandContext) =>
      drawing(context) ?? (!context.canUndo ? 'There is nothing to undo.' : undefined),
  },
  {
    id: 'redo',
    label: 'Redo',
    group: 'History',
    icon: 'redo',
    shortcut: 'Mod+Shift+Z',
    alternateShortcuts: ['Mod+Y'],
    disabledReason: (context: CommandContext) =>
      drawing(context) ?? (!context.canRedo ? 'There is nothing to redo.' : undefined),
  },
  {
    id: 'toggle-grid',
    label: 'Toggle drawing grid',
    group: 'Grid',
    icon: 'grid',
    shortcut: 'G',
    keywords: ['show', 'hide', 'paper'],
    disabledReason: drawing,
    active: (context: CommandContext) => !!context.gridVisible,
  },
  {
    id: 'toggle-grid-snap',
    label: 'Toggle snap to grid',
    group: 'Grid',
    icon: 'magnet',
    shortcut: 'S',
    keywords: ['spacing', 'precision', 'paper'],
    disabledReason: drawing,
    active: (context: CommandContext) => !!context.gridSnap,
  },
  {
    id: 'tab:sheet',
    label: 'Open sheet settings',
    group: 'Panels',
    icon: 'file',
    keywords: ['paper', 'scale', 'format', 'orientation'],
    active: (context: CommandContext) => context.inspectorTab === 'sheet',
  },
  {
    id: 'tab:details',
    label: 'Open title block',
    group: 'Panels',
    icon: 'file',
    keywords: ['details', 'metadata', 'material', 'author', 'organization'],
    active: (context: CommandContext) => context.inspectorTab === 'details',
  },
  {
    id: 'tab:dimensions',
    label: 'Open dimension inspector',
    group: 'Panels',
    icon: 'dimension',
    keywords: ['tolerances', 'properties', 'selection'],
    active: (context: CommandContext) => context.inspectorTab === 'dimensions',
  },
  {
    id: 'tab:instructions',
    label: 'Open manufacturing instructions',
    group: 'Panels',
    icon: 'file',
    keywords: ['notes', 'technical requirements', 'production', 'manufacture'],
    active: (context: CommandContext) => context.inspectorTab === 'instructions',
  },
  {
    id: 'tab:gear',
    label: 'Open gear parameters',
    group: 'Panels',
    icon: 'layers',
    keywords: ['gear', 'teeth', 'module', 'pressure angle', 'inspection', 'manufacture'],
    active: (context: CommandContext) => context.inspectorTab === 'gear',
  },
  {
    id: 'tab:annotations',
    label: 'Open markup tools',
    group: 'Panels',
    icon: 'text',
    active: (context: CommandContext) => context.inspectorTab === 'annotations',
  },
  {
    id: 'toggle-focus-mode',
    label: 'Toggle drawing focus mode',
    group: 'Workspace',
    icon: 'fit',
    shortcut: 'Shift+F',
    keywords: ['panels', 'fullscreen', 'distraction'],
    active: (context: CommandContext) => !!context.focusMode,
  },
  {
    id: 'command-palette',
    label: 'Search commands',
    group: 'Workspace',
    icon: 'info',
    shortcut: 'Mod+K',
    keywords: ['palette', 'find', 'actions'],
    allowWhenEditing: true,
  },
  {
    id: 'theme',
    label: 'Switch light or dark theme',
    group: 'Workspace',
    icon: 'sun',
    keywords: ['appearance', 'color', 'mode'],
  },
  {
    id: 'help',
    label: 'Open drawing help',
    group: 'Workspace',
    icon: 'info',
    shortcut: '?',
    keywords: ['shortcuts', 'guide', 'instructions'],
  },
  {
    id: 'clear-title-block',
    label: 'Clear saved title block',
    group: 'Workspace',
    icon: 'trash',
    keywords: ['metadata', 'cache', 'reset'],
    disabledReason: idle,
    destructive: true,
  },
  {
    id: 'close-help',
    label: 'Close drawing help',
    group: 'Workspace',
    icon: 'close',
    hidden: true,
  },
  {
    id: 'cancel',
    label: 'Cancel current import',
    group: 'Workspace',
    icon: 'close',
    disabledReason: (context: CommandContext) =>
      context.importing ? undefined : 'No import is running.',
  },
] as const satisfies readonly CommandDefinition[];

export type CommandId = (typeof commandDefinitions)[number]['id'];
export interface Command {
  id: CommandId;
  label: string;
  group: string;
  icon?: string;
  shortcut?: string;
  alternateShortcuts?: readonly string[];
  keywords?: readonly string[];
  enabled: boolean;
  disabledReason?: string;
  active?: boolean;
  destructive?: boolean;
  undoable?: boolean;
  hidden?: boolean;
  allowWhenEditing?: boolean;
}

const viewerCommands = new Set<string>([
  'exit-viewer',
  'toggle-native-fullscreen',
  'toggle-wake-lock',
  'share-drawing',
  'capture-region',
  'export-options',
  'export-pdf',
  'export-svg',
  'zoom-in',
  'zoom-out',
  'fit',
  'theme',
  'command-palette',
  'tool:pan',
  'tool:select',
]);

export function getCommands(context: CommandContext): Command[] {
  return commandDefinitions.map((definition: CommandDefinition) => {
    const { disabledReason: disabled, active, ...metadata } = definition;
    const annotationLabel = context.annotationSelection
      ? (
          {
            'delete-selected-dimensions': 'Delete annotation',
            'fit-selection': 'Fit selected annotation',
            'edit-dimension': 'Edit annotation',
          } as Record<string, string>
        )[definition.id]
      : undefined;
    const selectionSize = context.annotationSelection ? 1 : context.selectionCount;
    const allLocked = selectionSize > 0 && (context.lockedCount ?? 0) >= selectionSize;
    const changesSelection =
      ['delete-selected-dimensions', 'delete-dimension'].includes(definition.id) ||
      definition.id.startsWith('place-dimensions:');
    const disabledReason =
      context.viewerMode && !viewerCommands.has(definition.id)
        ? 'Exit viewer to edit the drawing.'
        : changesSelection && (context.lockedCount ?? 0) > 0
          ? 'Unlock the selection before editing or deleting it.'
          : definition.id === 'toggle-wake-lock' && !context.viewerMode
            ? 'Open drawing viewer first.'
            : annotationLabel
              ? drawing(context)
              : disabled?.(context);
    return {
      ...metadata,
      label: t(
        definition.id === 'toggle-selection-lock'
          ? allLocked
            ? 'Unlock selection'
            : 'Lock selection'
          : (annotationLabel ?? metadata.label),
      ),
      group: t(metadata.group),
      ...(definition.id === 'toggle-selection-lock'
        ? { icon: allLocked ? 'unlock' : 'lock', active: allLocked }
        : {}),
      ...(definition.id === 'exit-viewer' ? { hidden: !context.viewerMode } : {}),
      id: definition.id as CommandId,
      enabled: !disabledReason,
      ...(disabledReason ? { disabledReason: t(disabledReason) } : {}),
      ...(active ? { active: active(context) } : {}),
    };
  });
}

export function getCommand(id: string, context: CommandContext): Command | undefined {
  return getCommands(context).find((command) => command.id === id);
}

export function isEditingTarget(target: EventTarget | null): boolean {
  const element = target as Element | null;
  return !!element?.closest?.(
    'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="combobox"]',
  );
}

export interface ShortcutEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  target: EventTarget | null;
  isComposing?: boolean;
  defaultPrevented?: boolean;
}
function matchesShortcut(event: ShortcutEvent, shortcut: string): boolean {
  const parts = shortcut.split('+');
  const key = shortcut === '+' ? '+' : parts.at(-1)!;
  const modifiers = shortcut === '+' ? [] : parts.slice(0, -1);
  const mod = modifiers.includes('Mod');
  if (!!(event.ctrlKey || event.metaKey) !== mod || event.altKey !== modifiers.includes('Alt'))
    return false;
  // Printable shifted symbols carry their own Shift state in KeyboardEvent.key.
  const symbol = key.length === 1 && /[^a-z0-9]/i.test(key);
  if (!symbol && event.shiftKey !== modifiers.includes('Shift')) return false;
  return event.key.toLowerCase() === key.toLowerCase();
}

/** Match owned shortcuts even when unavailable, so the browser cannot run a competing action. */
export function findShortcutInCommands(
  event: ShortcutEvent,
  commands: readonly Command[],
): Command | undefined {
  if (event.defaultPrevented || event.isComposing) return;
  const editing = isEditingTarget(event.target);
  if (
    event.key === 'Enter' &&
    (event.target as Element | null)?.closest?.(
      'button,a[href],summary,[role="button"],[role="link"]',
    )
  )
    return;
  return commands.find(
    (command) =>
      (!editing || command.allowWhenEditing) &&
      [command.shortcut, ...(command.alternateShortcuts ?? [])].some(
        (shortcut) => shortcut && matchesShortcut(event, shortcut),
      ),
  );
}

export function findShortcutCommand(
  event: ShortcutEvent,
  context: CommandContext,
): Command | undefined {
  return findShortcutInCommands(event, getCommands(context));
}

export function formatShortcut(shortcut: string, mac = false): string {
  if (shortcut === '+') return '+';
  return shortcut
    .replace(/Mod/g, mac ? '⌘' : 'Ctrl')
    .replace(/Shift/g, mac ? '⇧' : 'Shift')
    .replace(/Alt/g, mac ? '⌥' : 'Alt')
    .replace(/Escape/g, 'Esc')
    .replace(/\+/g, mac ? ' ' : '+');
}
