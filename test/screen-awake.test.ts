import test from 'node:test';
import assert from 'node:assert/strict';
import { ScreenAwakeController, type ScreenLock } from '../src/ui/screen-awake';

function fixture() {
  let visible = true,
    supported = true,
    requests = 0;
  const locks: (ScreenLock & { releases: number })[] = [];
  const controller = new ScreenAwakeController(
    {
      supported: () => supported,
      visible: () => visible,
      async request() {
        requests++;
        const lock = {
          released: false,
          releases: 0,
          release: async () => {
            lock.released = true;
            lock.releases++;
          },
          addEventListener() {},
        };
        locks.push(lock);
        return lock;
      },
    },
    () => undefined,
  );
  return {
    controller,
    locks,
    requests: () => requests,
    hide: () => {
      visible = false;
    },
    show: () => {
      visible = true;
    },
    unsupported: () => {
      supported = false;
    },
  };
}
const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));
test('workshop screen lock releases on exit and reopens after visibility returns', async () => {
  const f = fixture();
  f.controller.setActive(true);
  await tick();
  assert.equal(f.controller.status, 'active');
  f.hide();
  f.controller.visibilityChanged();
  assert.equal(f.controller.status, 'paused');
  assert.equal(f.locks[0].releases, 1);
  f.show();
  f.controller.visibilityChanged();
  await tick();
  assert.equal(f.requests(), 2);
  assert.equal(f.controller.status, 'active');
  f.controller.setActive(false);
  assert.equal(f.locks[1].releases, 1);
  assert.equal(f.controller.status, 'off');
});
test('a late request cannot retain a lock after the viewer closes', async () => {
  const f = fixture();
  f.controller.setActive(true);
  f.controller.setActive(false);
  await tick();
  assert.equal(f.locks[0].releases, 1);
  assert.equal(f.controller.status, 'off');
});
test('disabled and unsupported screen locks expose honest states', async () => {
  const f = fixture();
  f.unsupported();
  f.controller.setActive(true);
  assert.equal(f.controller.status, 'unavailable');
  assert.equal(f.requests(), 0);
  f.controller.setEnabled(false);
  f.controller.visibilityChanged();
  assert.equal(f.controller.status, 'off');
});
