import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultGridSettings, type GridSettings } from '../src/ui/drawing-grid';
import {
  GRID_PREFERENCES_STORAGE_KEY,
  readGridPreferences,
  saveGridPreferences,
} from '../src/ui/workspace-preferences';

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

test('missing grid preferences return independent default objects', () => {
  const first = readGridPreferences();
  assert.deepEqual(first, { visible: false, snap: false, spacing: 5 });
  first.spacing = 10;
  assert.deepEqual(readGridPreferences(memoryStorage()), defaultGridSettings);
  assert.equal(defaultGridSettings.spacing, 5);
});

test('grid settings round-trip independently with custom paper-millimetre spacing', () => {
  const storage = memoryStorage();
  for (const spacing of [0.1, 1, 2.5, 5, 10, 100]) {
    const grid = { visible: false, snap: true, spacing };
    assert.equal(saveGridPreferences(grid, storage), true);
    assert.deepEqual(readGridPreferences(storage), grid);
  }
});

test('grid preferences whitelist UI fields and never write geometry or project settings', () => {
  const storage = memoryStorage();
  storage.setItem('techdraw:theme', '"dark"');
  saveGridPreferences(
    { visible: true, snap: false, spacing: 10, parts: ['private STEP'], scale: 2 } as GridSettings,
    storage,
  );
  assert.deepEqual(JSON.parse(storage.getItem(GRID_PREFERENCES_STORAGE_KEY)!), {
    visible: true,
    snap: false,
    spacing: 10,
  });
  assert.equal(storage.getItem('techdraw:theme'), '"dark"');
});

test('malformed data, coerced booleans and invalid spacings cannot enter grid state', () => {
  const storage = memoryStorage();
  for (const value of [
    null,
    [],
    true,
    'grid',
    {},
    { visible: 'false', snap: false, spacing: 5 },
    { visible: false, snap: 1, spacing: 5 },
    { visible: false, snap: false, spacing: '5' },
    ...[0, -1, 0.099, 100.001, null].map((spacing) => ({ visible: true, snap: true, spacing })),
  ]) {
    storage.setItem(GRID_PREFERENCES_STORAGE_KEY, JSON.stringify(value));
    assert.deepEqual(readGridPreferences(storage), defaultGridSettings);
  }
  storage.setItem(GRID_PREFERENCES_STORAGE_KEY, '{');
  assert.deepEqual(readGridPreferences(storage), defaultGridSettings);
});

test('invalid saves and storage failures leave the previous valid preference usable', () => {
  const storage = memoryStorage(),
    valid = { visible: true, snap: true, spacing: 1 };
  saveGridPreferences(valid, storage);
  for (const spacing of [NaN, Infinity, -Infinity, 0, 101])
    assert.equal(saveGridPreferences({ ...valid, spacing }, storage), false);
  assert.deepEqual(readGridPreferences(storage), valid);
  const denied = {
    getItem() {
      throw new Error('denied');
    },
    setItem() {
      throw new Error('denied');
    },
  };
  assert.deepEqual(readGridPreferences(denied), defaultGridSettings);
  assert.equal(saveGridPreferences(valid, denied), false);
  assert.equal(saveGridPreferences(valid), false);
});
