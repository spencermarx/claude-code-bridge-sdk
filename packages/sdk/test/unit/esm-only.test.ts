import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const pkgPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json');

/**
 * Pins the public package shape to ESM-only. If a future change re-adds CJS
 * artifacts or `exports.require`, these tests fail loudly so the decision is
 * deliberate.
 */
describe('ESM-only invariants', () => {
  it('package.json declares type:module', async () => {
    const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as { type?: string };
    expect(pkg.type).toBe('module');
  });

  it('package.json exports has no require condition', async () => {
    const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as {
      exports?: { '.'?: Record<string, unknown> };
    };
    const root = pkg.exports?.['.'];
    expect(root).toBeDefined();
    expect(root).not.toHaveProperty('require');
  });

  it('package.json main points at the .js (ESM) artifact, not .cjs', async () => {
    const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as { main?: string };
    expect(pkg.main).toBe('./dist/index.js');
    expect(pkg.main?.endsWith('.cjs')).toBe(false);
  });

  it('package.json has no module field (single ESM entry, not a dual build)', async () => {
    const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as { module?: string };
    expect(pkg.module).toBeUndefined();
  });
});
