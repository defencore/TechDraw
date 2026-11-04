import assert from 'node:assert/strict';
import test from 'node:test';
import { errorMessage } from '../src/ui/error-message';

test('updated application chunks give a recovery path that preserves unsaved work', () => {
  for (const message of [
    'Failed to fetch dynamically imported module: https://example.com/assets/pdf-old.js',
    'Importing a module script failed.',
    'error loading dynamically imported module',
  ]) {
    assert.match(errorMessage(new Error(message)), /Save your project, reload the page/);
    assert.ok(!errorMessage(new Error(message)).includes('assets/pdf-old.js'));
  }
});
test('geometry validation errors retain their actionable explanation', () => {
  const message = 'The STEP file contains no supported solids.';
  assert.equal(errorMessage(new Error(message)), message);
  assert.equal(errorMessage(message), message);
});
