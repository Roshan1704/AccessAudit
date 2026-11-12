/* eslint-disable no-console -- CLI entry point */
import { sql } from 'drizzle-orm';
import { accessibilityRules, createDb } from '@accessaudit/db';
import { allRules } from '@accessaudit/a11y-engine';

/**
 * Upserts the engine's rule catalogue into accessibility_rules. Runs as the migrator role
 * (MIGRATION_DATABASE_URL) because the worker only has SELECT on this table.
 */
export async function seedRules(url: string): Promise<number> {
  const handle = createDb(url, { max: 1 });
  const { db } = handle;
  try {
    const rules = allRules();
    for (const r of rules) {
      const row = {
        id: r.id,
        source: r.source,
        title: r.title,
        description: r.description,
        wcagCriteria: r.wcagCriteria,
        wcagLevel: r.wcagLevel,
        defaultSeverity: r.defaultSeverity,
        helpUrl: r.helpUrl,
        engineVersion: r.engineVersion,
      };
      await db
        .insert(accessibilityRules)
        .values(row)
        .onConflictDoUpdate({
          target: accessibilityRules.id,
          set: { ...row, updatedAt: sql`now()` },
        });
    }
    return rules.length;
  } finally {
    await handle.close();
  }
}

if (process.argv[1]?.endsWith('seed-rules.ts') === true) {
  const url = process.env['MIGRATION_DATABASE_URL'];
  if (url === undefined) {
    console.error('MIGRATION_DATABASE_URL is required');
    process.exit(1);
  }
  const n = await seedRules(url);
  console.log(`seeded ${String(n)} rules`);
}
