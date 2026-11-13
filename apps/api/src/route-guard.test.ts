import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guard against a new route file that forgets tenant authorization. Every file under routes/
 * must call requireOrg unless it is on this explicit public list.
 */
const PUBLIC_ROUTE_FILES = new Set(['auth.ts', 'health.ts', 'quick.ts']);
const dir = join(import.meta.dirname, 'routes');
const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));

describe('route authorization guard', () => {
  it('finds route files', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it('public list only names files that exist', () => {
    for (const f of PUBLIC_ROUTE_FILES) expect(files).toContain(f);
  });

  for (const file of files.filter((f) => !PUBLIC_ROUTE_FILES.has(f))) {
    it(`${file} calls requireOrg`, () => {
      expect(readFileSync(join(dir, file), 'utf8')).toMatch(/requireOrg\(/);
    });
  }
});
