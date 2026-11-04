import { defaultGridSettings, type GridSettings } from './drawing-grid';
import { isGridSpacing } from '../drawing/grid-coordinates';

export const GRID_PREFERENCES_STORAGE_KEY = 'techdraw:grid';

function validatedGrid(value: unknown): GridSettings | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const grid = value as Record<string, unknown>;
  if (
    typeof grid.visible !== 'boolean' ||
    typeof grid.snap !== 'boolean' ||
    !isGridSpacing(grid.spacing)
  )
    return;
  return { visible: grid.visible, snap: grid.snap, spacing: grid.spacing };
}

/** Grid preferences are independent UI aids, never drawing or STEP data. */
export function readGridPreferences(storage?: Pick<Storage, 'getItem'>): GridSettings {
  try {
    const value = JSON.parse(storage?.getItem(GRID_PREFERENCES_STORAGE_KEY) ?? 'null');
    return validatedGrid(value) ?? { ...defaultGridSettings };
  } catch {
    return { ...defaultGridSettings };
  }
}

export function saveGridPreferences(
  grid: GridSettings,
  storage?: Pick<Storage, 'setItem'>,
): boolean {
  try {
    const value = validatedGrid(grid);
    if (!storage || !value) return false;
    storage.setItem(GRID_PREFERENCES_STORAGE_KEY, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
