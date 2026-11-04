export type ScreenAwakeStatus = 'off' | 'requesting' | 'active' | 'paused' | 'unavailable';
export interface ScreenLock {
  released: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void, options?: { once: boolean }): void;
}
export interface ScreenAwakeEnvironment {
  supported(): boolean;
  visible(): boolean;
  request(): Promise<ScreenLock>;
}

/** A lock is held only while the workshop viewer is active and visible. */
export class ScreenAwakeController {
  private lock?: ScreenLock;
  private generation = 0;
  private running = false;
  private wanted = true;
  private current: ScreenAwakeStatus = 'off';
  constructor(
    private readonly environment: ScreenAwakeEnvironment,
    private readonly changed: (status: ScreenAwakeStatus) => void,
  ) {}
  get status(): ScreenAwakeStatus {
    return this.current;
  }
  get enabled(): boolean {
    return this.wanted;
  }
  private setStatus(status: ScreenAwakeStatus): void {
    this.current = status;
    this.changed(status);
  }
  setActive(active: boolean): void {
    this.running = active;
    if (active) void this.acquire();
    else this.release();
  }
  setEnabled(enabled: boolean): void {
    this.wanted = enabled;
    if (enabled && this.running) void this.acquire();
    else this.release();
  }
  visibilityChanged(): void {
    if (!this.running || !this.wanted) return;
    if (this.environment.visible()) void this.acquire();
    else {
      this.release();
      this.setStatus('paused');
    }
  }
  retry(): void {
    if (this.running && this.wanted) void this.acquire();
  }
  private async acquire(): Promise<void> {
    if (!this.running || !this.wanted) return;
    if (!this.environment.supported()) return this.setStatus('unavailable');
    if (!this.environment.visible()) return this.setStatus('paused');
    if (this.lock && !this.lock.released) return this.setStatus('active');
    const generation = ++this.generation;
    this.setStatus('requesting');
    try {
      const lock = await this.environment.request();
      if (
        generation !== this.generation ||
        !this.running ||
        !this.wanted ||
        !this.environment.visible()
      ) {
        await lock.release();
        return;
      }
      this.lock = lock;
      lock.addEventListener(
        'release',
        () => {
          if (this.lock !== lock) return;
          this.lock = undefined;
          this.setStatus(this.running && this.wanted ? 'paused' : 'off');
        },
        { once: true },
      );
      this.setStatus('active');
    } catch {
      if (generation === this.generation) this.setStatus('unavailable');
    }
  }
  private release(): void {
    ++this.generation;
    const lock = this.lock;
    this.lock = undefined;
    if (lock && !lock.released) void lock.release().catch(() => undefined);
    this.setStatus('off');
  }
}

export function browserScreenAwake(
  changed: (status: ScreenAwakeStatus) => void,
): ScreenAwakeController {
  return new ScreenAwakeController(
    {
      supported: () => 'wakeLock' in navigator,
      visible: () => document.visibilityState === 'visible',
      request: () => navigator.wakeLock.request('screen'),
    },
    changed,
  );
}
