import assert from 'node:assert/strict';
import { setImmediate as flush } from 'node:timers/promises';
import type { RpcScheduler } from '../src/rpc';

export class FakeClock implements RpcScheduler {
  private time = 0;
  private timers = new Map<() => void, number>();

  now() { return this.time; }

  schedule(callback: () => void, delayMs: number) {
    this.timers.set(callback, this.time + delayMs);
    return () => { this.timers.delete(callback); };
  }

  private next() {
    return [...this.timers].sort((a, b) => a[1] - b[1])[0];
  }

  async advance(ms: number) {
    const target = this.time + ms;
    // Let fetch/Response and viem finish their promise chains before moving virtual time.
    // This yields an event-loop turn; it never waits for a wall-clock interval.
    await flush();
    for (let steps = 0; ; steps++) {
      const timer = this.next();
      if (!timer || timer[1] > target) break;
      assert.ok(steps < 1000, 'fake clock did not become idle');
      const [callback, at] = timer;
      this.time = at;
      this.timers.delete(callback);
      callback();
      await flush();
    }
    this.time = target;
    await flush();
  }

  async run<T>(request: Promise<T>): Promise<T> {
    let settled = false;
    void request.then(() => { settled = true; }, () => { settled = true; });
    for (let steps = 0; ; steps++) {
      await flush();
      if (settled) return request;
      assert.ok(steps < 1000, 'request did not settle');
      const timer = this.next();
      assert.ok(timer, 'request is pending without a scheduled wakeup');
      await this.advance(timer[1] - this.time);
    }
  }
}
