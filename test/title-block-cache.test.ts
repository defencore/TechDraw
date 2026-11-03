import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultSettings } from '../src/state';
import { titleBlockDefaults } from '../src/drawing/title-block-data';
import {
  TITLE_BLOCK_STORAGE_KEY,
  readTitleBlockCache,
  saveTitleBlockCache,
  clearTitleBlockCache,
} from '../src/ui/title-block-cache';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

test('title block cache restores Ukrainian document fields and template across a new workspace', () => {
  const storage = memoryStorage();
  const settings = {
    ...defaultSettings,
    template: 'eskd-uk' as const,
    title: 'Гвинт',
    organization: 'DEFENCORE',
    author: 'Іваненко',
    checkedBy: 'Петренко',
    date: '04.11.26',
    number: 'TD-001',
    notes: 'Гострі крайки притупити.',
  };
  assert.equal(saveTitleBlockCache(storage, settings), true);
  const restored = { ...defaultSettings, ...readTitleBlockCache(storage) };
  for (const key of Object.keys(titleBlockDefaults) as (keyof typeof titleBlockDefaults)[])
    assert.equal(restored[key], settings[key]);
  assert.equal(restored.template, 'eskd-uk');
});

test('clearing title block cache removes its data in one operation and preserves other preferences', () => {
  const storage = memoryStorage();
  storage.setItem('techdraw:theme', '"dark"');
  saveTitleBlockCache(storage, { ...defaultSettings, number: 'OLD-PART', material: 'Steel' });
  assert.equal(clearTitleBlockCache(storage), true);
  assert.equal(storage.getItem(TITLE_BLOCK_STORAGE_KEY), null);
  assert.deepEqual(readTitleBlockCache(storage), {});
  assert.equal(storage.getItem('techdraw:theme'), '"dark"');
});

test('cached data never includes model geometry, dimensions, viewport or paper scale', () => {
  const storage = memoryStorage();
  saveTitleBlockCache(storage, { ...defaultSettings, scale: 5, format: 'A1' });
  const saved = JSON.parse(storage.getItem(TITLE_BLOCK_STORAGE_KEY)!);
  assert.deepEqual(
    Object.keys(saved).sort(),
    [...Object.keys(titleBlockDefaults), 'template'].sort(),
  );
  assert.equal('scale' in saved, false);
  assert.equal('format' in saved, false);
});

test('invalid cache values cannot overwrite settings or become oversized drawing text', () => {
  const storage = memoryStorage();
  storage.setItem(
    TITLE_BLOCK_STORAGE_KEY,
    JSON.stringify({
      title: { html: 'x' },
      number: 'TD-002',
      material: 'x'.repeat(1025),
      template: 'unknown',
      precision: -1,
      notes: 'x'.repeat(10001),
      author: '',
    }),
  );
  assert.deepEqual(readTitleBlockCache(storage), { number: 'TD-002', author: '' });
  storage.setItem(TITLE_BLOCK_STORAGE_KEY, '{');
  assert.deepEqual(readTitleBlockCache(storage), {});
});

test('unavailable or denied browser storage cannot prevent drawing or clearing fields', () => {
  const denied = {
    getItem() {
      throw new Error('denied');
    },
    setItem() {
      throw new Error('denied');
    },
    removeItem() {
      throw new Error('denied');
    },
  };
  assert.deepEqual(readTitleBlockCache(denied), {});
  assert.equal(saveTitleBlockCache(denied, defaultSettings), false);
  assert.equal(clearTitleBlockCache(denied), false);
  assert.deepEqual(readTitleBlockCache(), {});
});

test('non-printing control characters cannot enter a restored title block or break project text', () => {
  const storage = memoryStorage();
  storage.setItem(
    TITLE_BLOCK_STORAGE_KEY,
    JSON.stringify({ title: 'Bad\u0000title', author: 'Engineer', notes: 'Bad\u000bnotes' }),
  );
  assert.deepEqual(readTitleBlockCache(storage), { author: 'Engineer' });
  saveTitleBlockCache(storage, {
    ...defaultSettings,
    title: 'Good\u0000title',
    notes: 'Line 1\nLine 2\tOK\u0008',
  });
  const restored = readTitleBlockCache(storage);
  assert.equal(restored.title, 'Goodtitle');
  assert.equal(restored.notes, 'Line 1\nLine 2\tOK');
});
