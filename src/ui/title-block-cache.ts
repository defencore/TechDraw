import type { DrawingSettings, TemplateId } from '../model';
import {
  titleBlockDefaults,
  titleBlockKeys,
  cleanTitleBlockText,
  type TitleBlockKey,
} from '../drawing/title-block-data';

export const TITLE_BLOCK_STORAGE_KEY = 'techdraw:title-block';
type StorageAccess = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type CachedTitleBlock = Pick<DrawingSettings, TitleBlockKey> & { template?: TemplateId };
const templates: TemplateId[] = ['eskd', 'eskd-uk', 'iso', 'minimal'];

/** Persist only document fields; STEP data and geometry are never written to this cache. */
export function readTitleBlockCache(storage?: StorageAccess): Partial<CachedTitleBlock> {
  try {
    const value = JSON.parse(storage?.getItem(TITLE_BLOCK_STORAGE_KEY) ?? 'null');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const result: Partial<CachedTitleBlock> = {};
    for (const key of titleBlockKeys) {
      if (
        typeof value[key] === 'string' &&
        value[key].length <= (key === 'notes' ? 10000 : 1024) &&
        cleanTitleBlockText(value[key]) === value[key]
      )
        result[key] = value[key];
    }
    if (templates.includes(value.template)) result.template = value.template;
    return result;
  } catch {
    return {};
  }
}

export function saveTitleBlockCache(
  storage: StorageAccess | undefined,
  settings: DrawingSettings,
): boolean {
  try {
    if (!storage) return false;
    const value: CachedTitleBlock = { ...titleBlockDefaults, template: settings.template };
    for (const key of titleBlockKeys)
      value[key] = cleanTitleBlockText(settings[key]).slice(0, key === 'notes' ? 10000 : 1024);
    storage.setItem(TITLE_BLOCK_STORAGE_KEY, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function clearTitleBlockCache(storage?: StorageAccess): boolean {
  try {
    if (!storage) return false;
    storage.removeItem(TITLE_BLOCK_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
