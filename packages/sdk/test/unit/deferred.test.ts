import { describe, expect, it } from 'vitest';
import { Deferred } from '../../src/internal/deferred';

describe('Deferred', () => {
  it('resolves once and ignores subsequent calls', async () => {
    const d = new Deferred<number>();
    d.resolve(1);
    d.resolve(2);
    expect(await d.promise).toBe(1);
    expect(d.settled).toBe(true);
  });

  it('rejects once and ignores subsequent calls', async () => {
    const d = new Deferred<number>();
    d.reject(new Error('boom'));
    d.resolve(5);
    await expect(d.promise).rejects.toThrow('boom');
    expect(d.settled).toBe(true);
  });

  it('reports settled=false before resolve', () => {
    const d = new Deferred<number>();
    expect(d.settled).toBe(false);
  });
});
