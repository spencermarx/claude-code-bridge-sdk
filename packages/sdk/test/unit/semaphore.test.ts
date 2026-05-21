import { describe, expect, it } from 'vitest';
import { Semaphore } from '../../src/internal/semaphore';

describe('Semaphore', () => {
  it('caps concurrency at the configured limit', async () => {
    const sem = new Semaphore(2);
    let inFlight = 0;
    let max = 0;
    await Promise.all(
      Array.from({ length: 6 }).map(() =>
        sem.run(async () => {
          inFlight++;
          max = Math.max(max, inFlight);
          await new Promise((r) => setTimeout(r, 5));
          inFlight--;
        }),
      ),
    );
    expect(max).toBe(2);
  });

  it('treats Infinity as unbounded', async () => {
    const sem = new Semaphore(Number.POSITIVE_INFINITY);
    let inFlight = 0;
    let max = 0;
    await Promise.all(
      Array.from({ length: 10 }).map(() =>
        sem.run(async () => {
          inFlight++;
          max = Math.max(max, inFlight);
          await Promise.resolve();
          inFlight--;
        }),
      ),
    );
    expect(max).toBe(10);
  });

  it('releases even if the task throws', async () => {
    const sem = new Semaphore(1);
    await expect(
      sem.run(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    // If release wasn't called, this acquire would hang.
    await sem.acquire();
    sem.release();
  });
});
